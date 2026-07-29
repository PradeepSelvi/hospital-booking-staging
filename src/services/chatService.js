// chatService.js
// Calls the Supabase Edge Function (chat-assistant) which proxies to NVIDIA NIM.
// Patient/doctor context is built SERVER-SIDE inside the edge function from the
// authenticated user's JWT — the browser no longer builds or sends it.

import { supabase } from '../lib/supabase'

/**
 * Sends messages to the chat-assistant Edge Function with streaming.
 *
 * @param {Array} messages - Array of { role, content }
 * @param {Function} onChunk - Callback({ text, reasoning })
 * @param {AbortSignal} [signal] - Optional AbortController signal
 * @param {boolean} [writeMode] - If true, use writing assistant system prompt
 */
export async function streamChatCompletion(messages, onChunk, signal, writeMode = false) {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Supabase configuration is missing. Check your .env file.')
  }

  // The edge function requires an authenticated user (Verify JWT is enabled).
  // Send the user's access token — NOT the public anon key — so the request
  // is tied to a real user and can be rate-limited server-side.
  const { data: { session } } = await supabase.auth.getSession()
  const accessToken = session?.access_token
  if (!accessToken) {
    throw new Error('Please log in to use the assistant.')
  }

  const edgeFunctionUrl = `${supabaseUrl}/functions/v1/chat-assistant`

  // Only send role + content to the backend
  const cleanMessages = messages.map(({ role, content }) => ({ role, content }))

  let response
  try {
    response = await fetch(edgeFunctionUrl, {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
        'apikey': supabaseAnonKey,
      },
      body: JSON.stringify({
        messages: cleanMessages,
        ...(writeMode && { writeMode: true }),
      }),
    })
  } catch (err) {
    if (err.name === 'AbortError') throw err
    throw new Error('Unable to reach the AI service. Please check your connection.')
  }

  if (!response.ok) {
    let errorMessage = `AI service error (${response.status}).`
    try {
      const errBody = await response.json()
      if (errBody.error) errorMessage = errBody.error
    } catch { /* not JSON */ }

    if (import.meta.env.DEV) console.error('Chat Edge Function error:', response.status, errorMessage)

    if (response.status === 401) throw new Error('Your session has expired. Please log in again.')
    if (response.status === 429) throw new Error('You are sending messages too quickly. Please wait a moment and try again.')
    if (response.status === 503) throw new Error('AI service is not configured yet. Please contact the administrator.')
    if (response.status === 504) throw new Error('The AI is taking too long to respond. Please try a shorter message.')
    throw new Error(errorMessage)
  }

  // Parse SSE streaming response
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let currentText = ''
  let currentReasoning = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data: ') || trimmed === 'data: [DONE]') continue
        try {
          const data = JSON.parse(trimmed.slice(6))
          const delta = data.choices?.[0]?.delta || {}
          if (delta.reasoning_content) {
            currentReasoning += delta.reasoning_content
            onChunk({ text: currentText, reasoning: currentReasoning })
          }
          if (delta.content) {
            currentText += delta.content
            onChunk({ text: currentText, reasoning: currentReasoning })
          }
        } catch { /* ignore malformed */ }
      }
    }

    const remaining = decoder.decode()
    if (remaining) {
      buffer += remaining
      const trimmed = buffer.trim()
      if (trimmed.startsWith('data: ') && trimmed !== 'data: [DONE]') {
        try {
          const data = JSON.parse(trimmed.slice(6))
          const delta = data.choices?.[0]?.delta || {}
          if (delta.reasoning_content) {
            currentReasoning += delta.reasoning_content
            onChunk({ text: currentText, reasoning: currentReasoning })
          }
          if (delta.content) {
            currentText += delta.content
            onChunk({ text: currentText, reasoning: currentReasoning })
          }
        } catch { /* ignore */ }
      }
    }

    if (!currentText && !currentReasoning) {
      throw new Error('The AI returned an empty response. Please try again.')
    }
  } finally {
    reader.releaseLock()
  }
}
