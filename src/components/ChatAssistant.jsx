import { useState, useRef, useEffect, useCallback } from 'react'
import { streamChatCompletion } from '../services/chatService'
import { getOrCreateSession, getSessionMessages, saveMessage, startNewSession, updateSessionTitle } from '../services/chatSessions'
import { bookAppointment } from '../services/appointments'
import { getDoctorById, getAvailableSlots } from '../services/doctors'
import { createComplaint, getComplaintTargets, ALLOWED_TARGETS, COMPLAINT_CATEGORIES } from '../services/complaints'
import { submitContactMessage } from '../services/support'
import { sanitizeInput } from '../security/sanitize'
import { useAuth } from '../context/AuthContext'
import './ChatAssistant.css'

/**
 * Lightweight markdown-to-HTML renderer for chat bubbles.
 */
function parseMarkdown(text) {
  if (!text) return ''
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code class="chat-inline-code">$1</code>')
    .replace(/^(\d+)\.\s+(.+)$/gm, '<li class="chat-list-item numbered"><span class="chat-list-num">$1.</span> $2</li>')
    .replace(/^[-•]\s+(.+)$/gm, '<li class="chat-list-item bullet">$1</li>')
    .replace(/\n/g, '<br/>')
  return html
}

/**
 * Parse action blocks from AI response.
 * Returns { cleanText, action } where action is the parsed JSON or null.
 */
function parseActionBlock(text) {
  const actionMatch = text.match(/```action\s*\n?([\s\S]*?)```/)
  if (!actionMatch) return { cleanText: text, action: null }

  try {
    const action = JSON.parse(actionMatch[1].trim())
    const cleanText = text.replace(/```action\s*\n?[\s\S]*?```/, '').trim()
    return { cleanText, action }
  } catch {
    return { cleanText: text, action: null }
  }
}

const SEND_COOLDOWN_MS = 3000
const MAX_INPUT_LENGTH = 2000
const WELCOME_MSG = { id: 'welcome', role: 'assistant', content: 'Hi there! I am MediBook AI Assistant. How can I help you today?' }
const ACTION_TYPES = ['BOOK_APPOINTMENT', 'FILE_COMPLAINT', 'MESSAGE_MANAGEMENT']
const CATEGORY_LABELS = Object.fromEntries(COMPLAINT_CATEGORIES.map(c => [c.value, c.label]))

export default function ChatAssistant() {
  const { user, profile } = useAuth()
  const [isOpen, setIsOpen] = useState(false)
  const [messages, setMessages] = useState([WELCOME_MSG])
  const [inputMessage, setInputMessage] = useState('')
  const [isTyping, setIsTyping] = useState(false)
  const [thinkingContent, setThinkingContent] = useState('')
  const [sessionId, setSessionId] = useState(null)
  const [pendingAction, setPendingAction] = useState(null)
  const [bookingInProgress, setBookingInProgress] = useState(false)
  const [actionInProgress, setActionInProgress] = useState(false)
  const messagesEndRef = useRef(null)
  const abortRef = useRef(null)
  const lastSentRef = useRef(0)
  const contextLoadedRef = useRef(false)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages, isTyping, thinkingContent])

  useEffect(() => {
    return () => { abortRef.current?.abort() }
  }, [])

  // Load session when chat opens and user is authenticated
  useEffect(() => {
    if (isOpen && user && !contextLoadedRef.current) {
      contextLoadedRef.current = true
      loadSession()
    }
  }, [isOpen, user])

  async function loadSession() {
    try {
      // Load or create chat session
      const session = await getOrCreateSession(user.id)
      setSessionId(session.id)

      // Load existing messages
      const savedMessages = await getSessionMessages(session.id)
      if (savedMessages.length > 0) {
        const formattedMessages = savedMessages.map(m => ({
          id: m.id.toString(),
          role: m.role,
          content: m.content,
        }))
        setMessages([WELCOME_MSG, ...formattedMessages])
      }
    } catch (err) {
      if (import.meta.env.DEV) console.error('Failed to load chat session:', err)
    }
  }

  const handleToggle = useCallback(() => {
    setIsOpen((prev) => {
      if (prev) {
        abortRef.current?.abort()
      }
      return !prev
    })
  }, [])

  async function handleNewChat() {
    if (!user) return
    try {
      abortRef.current?.abort()
      const session = await startNewSession(user.id)
      setSessionId(session.id)
      setMessages([WELCOME_MSG])
      setPendingAction(null)
      setThinkingContent('')
      setIsTyping(false)
    } catch (err) {
      if (import.meta.env.DEV) console.error('Failed to create new session:', err)
    }
  }

  async function handleBookingConfirm() {
    if (!pendingAction || bookingInProgress) return
    setBookingInProgress(true)

    try {
      const action = pendingAction
      setPendingAction(null)

      // ── Validate the AI-proposed booking against real data ──
      // The action block comes from the LLM, so never trust it blindly.
      if (!action.doctor_id || !action.date || !action.slot) {
        throw new Error('Incomplete booking details. Please specify a doctor, date, and time.')
      }

      // 1. The doctor must exist and be active
      let doctor
      try {
        doctor = await getDoctorById(action.doctor_id)
      } catch {
        doctor = null
      }
      if (!doctor || doctor.is_active === false) {
        throw new Error('That doctor is no longer available. Please pick another from the list.')
      }

      // 2. The chosen slot must be genuinely available on that date
      const slots = await getAvailableSlots(action.doctor_id, action.date)
      const slotOk = slots.some(s => s.start === action.slot && !s.booked)
      if (!slotOk) {
        throw new Error(`The ${action.slot} slot on ${action.date} isn't available. Please choose a different time.`)
      }

      // 3. Book using AUTHORITATIVE values from the DB (not the AI's claims)
      const doctorName = doctor.profiles?.name || action.doctor_name || 'Doctor'
      const specialization = doctor.specialization || action.specialization || 'General'
      const fee = doctor.consultation_fee ?? action.fee

      await bookAppointment({
        patient_id: user.id,
        doctor_id: doctor.id,
        appointment_date: action.date,
        slot_start_time: action.slot,
        reason: `Booked via AI Assistant — ${specialization}`,
      })

      const successMsg = `✅ Appointment booked successfully!\n\n**Doctor:** Dr. ${doctorName}\n**Specialization:** ${specialization}\n**Date:** ${action.date}\n**Time:** ${action.slot}\n**Fee:** ₹${fee ?? 'N/A'}\n\nYou'll receive a confirmation notification shortly.`

      const msgObj = { id: crypto.randomUUID(), role: 'assistant', content: successMsg }
      setMessages(prev => [...prev, msgObj])

      if (sessionId) await saveMessage(sessionId, 'assistant', successMsg)
    } catch (err) {
      const errorMsg = `❌ Booking failed: ${err.message}`
      const msgObj = { id: crypto.randomUUID(), role: 'assistant', content: errorMsg, isError: true }
      setMessages(prev => [...prev, msgObj])
      if (sessionId) await saveMessage(sessionId, 'assistant', errorMsg)
    } finally {
      setBookingInProgress(false)
    }
  }

  function handleBookingCancel() {
    setPendingAction(null)
    const cancelMsg = 'No problem! Booking cancelled. Is there anything else I can help with?'
    const msgObj = { id: crypto.randomUUID(), role: 'assistant', content: cancelMsg }
    setMessages(prev => [...prev, msgObj])
    if (sessionId) saveMessage(sessionId, 'assistant', cancelMsg)
  }

  // Generic cancel for complaint / management-message confirmation cards
  function handleActionCancel() {
    setPendingAction(null)
    const cancelMsg = 'Okay, cancelled. Is there anything else I can help with?'
    const msgObj = { id: crypto.randomUUID(), role: 'assistant', content: cancelMsg }
    setMessages(prev => [...prev, msgObj])
    if (sessionId) saveMessage(sessionId, 'assistant', cancelMsg)
  }

  function pushAssistant(content, isError = false) {
    const msgObj = { id: crypto.randomUUID(), role: 'assistant', content, isError }
    setMessages(prev => [...prev, msgObj])
    if (sessionId) saveMessage(sessionId, 'assistant', content)
  }

  async function handleComplaintConfirm() {
    if (!pendingAction || actionInProgress) return
    setActionInProgress(true)
    try {
      const a = pendingAction
      setPendingAction(null)

      const role = profile?.role
      // Role-based authorization — same gate the Complaints page enforces.
      if (!ALLOWED_TARGETS[role]?.includes(a.target_type)) {
        throw new Error('Your account is not allowed to file this type of complaint.')
      }

      // Re-validate the target against what THIS user is actually allowed to
      // file against (patients → active doctors/hospitals; doctors → their
      // hospitals/patients; hospitals → their doctors). Never trust the AI's id.
      let target = null
      if (a.target_type !== 'MANAGEMENT') {
        const opts = await getComplaintTargets(a.target_type, role, user.id)
        target = opts.find(o => [o.doctorId, o.hospitalId, o.patientUserId].includes(a.target_id)) || null
        if (!target) {
          throw new Error('I could not verify who this complaint is against. Please file it from the Complaints page.')
        }
      }

      const created = await createComplaint({
        target_type: a.target_type,
        target,
        category: a.category || 'OTHER',
        subject: a.subject,
        description: a.description,
      }, profile)

      const ref = `#CMP-${String(created.id).padStart(5, '0')}`
      pushAssistant(
        `✅ Complaint filed (${ref}).\n\n**Against:** ${target?.label || 'Website Management'}\n**Category:** ${CATEGORY_LABELS[created.category] || created.category}\n**Subject:** ${created.subject}\n\nOur team will review it. You can track its status anytime on the Complaints page.`
      )
    } catch (err) {
      pushAssistant(`❌ Could not file the complaint: ${err.message}`, true)
    } finally {
      setActionInProgress(false)
    }
  }

  async function handleManagementConfirm() {
    if (!pendingAction || actionInProgress) return
    setActionInProgress(true)
    try {
      const a = pendingAction
      setPendingAction(null)

      // Identity is taken from the authenticated profile, never the AI.
      await submitContactMessage({
        name: profile?.name || 'User',
        email: profile?.email || user.email,
        type: 'CONTACT',
        subject: a.subject || '',
        message: a.message,
      }, user.id)

      pushAssistant(
        `✅ Your message has been sent to the management team.\n\n**Subject:** ${a.subject || '(none)'}\n\nThey'll follow up by email if a response is needed.`
      )
    } catch (err) {
      pushAssistant(`❌ Could not send your message: ${err.message}`, true)
    } finally {
      setActionInProgress(false)
    }
  }

  const handleSendMessage = async (e) => {
    e?.preventDefault()
    const trimmed = inputMessage.trim()
    if (!trimmed || isTyping) return

    const now = Date.now()
    if (now - lastSentRef.current < SEND_COOLDOWN_MS) return
    lastSentRef.current = now

    const sanitizedContent = sanitizeInput(trimmed).slice(0, MAX_INPUT_LENGTH)
    if (!sanitizedContent) return

    const userMessage = { id: crypto.randomUUID(), role: 'user', content: sanitizedContent }
    const updatedMessages = [...messages, userMessage]

    setMessages(updatedMessages)
    setInputMessage('')
    setIsTyping(true)
    setThinkingContent('')
    setPendingAction(null)

    // Persist user message
    if (sessionId) {
      saveMessage(sessionId, 'user', sanitizedContent)
      // Auto-title session from first user message
      if (messages.length <= 1) {
        updateSessionTitle(sessionId, sanitizedContent.slice(0, 80))
      }
    }

    abortRef.current = new AbortController()

    try {
      const assistantId = crypto.randomUUID()
      setMessages(prev => [...prev, { id: assistantId, role: 'assistant', content: '', isStreaming: true }])

      const apiMessages = updatedMessages
        .filter(m => m.id !== 'welcome')
        .map(({ role, content }) => ({ role, content }))

      let fullText = ''
      let lastReasoning = ''

      await streamChatCompletion(apiMessages, ({ text, reasoning }) => {
        fullText = text
        if (reasoning) lastReasoning = reasoning
        setThinkingContent(reasoning)
        setMessages(prev => {
          const newMessages = [...prev]
          newMessages[newMessages.length - 1] = {
            id: assistantId,
            role: 'assistant',
            content: text,
            isStreaming: true,
          }
          return newMessages
        })
      }, abortRef.current.signal)

      // Parse for action blocks
      const { cleanText, action } = parseActionBlock(fullText)

      // Decide what to render. Guard against silent empties:
      //  • reasoning-only responses (content channel empty) → show the reasoning
      //  • action-only responses (no prose) → show a friendly prompt, not raw JSON
      //  • truly empty → a clear, non-silent fallback (flagged as error)
      let finalText = (cleanText || '').trim()
      let finalIsError = false
      if (!finalText) {
        if (action) {
          finalText = "Here are the details below — please review and confirm."
        } else if (lastReasoning.trim()) {
          finalText = lastReasoning.trim()
        } else {
          finalText = "⚠️ I couldn't generate a response. Please rephrase your question or try again."
          finalIsError = true
        }
      }

      // Finalize message
      setMessages(prev => {
        const newMessages = [...prev]
        newMessages[newMessages.length - 1] = {
          id: assistantId,
          role: 'assistant',
          content: finalText,
          isError: finalIsError,
          isStreaming: false,
        }
        return newMessages
      })
      setThinkingContent('')

      // Persist assistant message
      if (sessionId) saveMessage(sessionId, 'assistant', finalText)

      // Show confirmation card if a recognized action was detected
      if (action?.type && ACTION_TYPES.includes(action.type)) {
        setPendingAction(action)
      }
    } catch (error) {
      if (error.name === 'AbortError') {
        setMessages(prev => {
          const newMessages = [...prev]
          if (newMessages[newMessages.length - 1]?.isStreaming) {
            newMessages[newMessages.length - 1].isStreaming = false
          }
          return newMessages
        })
        setThinkingContent('')
        return
      }

      if (import.meta.env.DEV) console.error('Chat error:', error)
      const errorMsg = error?.message || 'Sorry, I encountered an error.'
      setMessages(prev => {
        const newMessages = [...prev]
        newMessages[newMessages.length - 1] = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: errorMsg,
          isError: true,
          isStreaming: false,
        }
        return newMessages
      })
      setThinkingContent('')
    } finally {
      setIsTyping(false)
    }
  }

  return (
    <div className={`chat-assistant-container ${isOpen ? 'open' : ''}`}>
      {/* Floating Toggle — only when closed */}
      {!isOpen && (
        <button className="chat-toggle-btn" onClick={handleToggle} aria-label="Open AI Assistant">
          <i className="bi bi-robot"></i>
        </button>
      )}

      {/* Chat Window */}
      {isOpen && (
        <div className="chat-window">
          <div className="chat-header">
            <div className="chat-header-info">
              <div className="chat-avatar">
                <i className="bi bi-robot"></i>
              </div>
              <div>
                <h3 className="chat-title">MediBook AI</h3>
                <span className="chat-status">Powered by NVIDIA Nemotron</span>
              </div>
              <button className="chat-header-btn" onClick={handleNewChat} aria-label="New chat" title="New Chat">
                <i className="bi bi-plus-lg"></i>
              </button>
              <button className="chat-minimize-btn" onClick={handleToggle} aria-label="Minimize chat" title="Minimize">
                <i className="bi bi-chevron-down"></i>
              </button>
            </div>
          </div>

          <div className="chat-messages" role="log" aria-live="polite" aria-label="Chat messages">
            {messages.map((msg) => (
              <div key={msg.id} className={`chat-bubble-wrapper ${msg.role}`}>
                {msg.role === 'assistant' && (
                  <div className="chat-bubble-avatar">
                    <i className="bi bi-robot"></i>
                  </div>
                )}
                <div
                  className={`chat-bubble ${msg.isError ? 'error' : ''}`}
                  dangerouslySetInnerHTML={{
                    __html: parseMarkdown(msg.content) || (msg.isStreaming && !thinkingContent ? '...' : '')
                  }}
                />
              </div>
            ))}

            {/* Booking Confirmation Card */}
            {pendingAction?.type === 'BOOK_APPOINTMENT' && (
              <div className="chat-bubble-wrapper assistant">
                <div className="chat-bubble-avatar">
                  <i className="bi bi-robot"></i>
                </div>
                <div className="chat-booking-card">
                  <div className="booking-card-header">
                    <i className="bi bi-calendar-check"></i> Confirm Appointment
                  </div>
                  <div className="booking-card-body">
                    <div className="booking-detail">
                      <span className="booking-label">Doctor</span>
                      <span className="booking-value">Dr. {pendingAction.doctor_name}</span>
                    </div>
                    <div className="booking-detail">
                      <span className="booking-label">Specialization</span>
                      <span className="booking-value">{pendingAction.specialization}</span>
                    </div>
                    <div className="booking-detail">
                      <span className="booking-label">Date</span>
                      <span className="booking-value">{pendingAction.date}</span>
                    </div>
                    <div className="booking-detail">
                      <span className="booking-label">Time</span>
                      <span className="booking-value">{pendingAction.slot}</span>
                    </div>
                    {pendingAction.fee && (
                      <div className="booking-detail">
                        <span className="booking-label">Fee</span>
                        <span className="booking-value">₹{pendingAction.fee}</span>
                      </div>
                    )}
                  </div>
                  <div className="booking-card-actions">
                    <button
                      className="booking-btn confirm"
                      onClick={handleBookingConfirm}
                      disabled={bookingInProgress}
                    >
                      {bookingInProgress ? (
                        <><div className="spinner-custom" style={{ width: 14, height: 14, borderWidth: 2 }} /> Booking...</>
                      ) : (
                        <><i className="bi bi-check-lg"></i> Confirm</>
                      )}
                    </button>
                    <button className="booking-btn cancel" onClick={handleBookingCancel} disabled={bookingInProgress}>
                      <i className="bi bi-x-lg"></i> Cancel
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Complaint Confirmation Card */}
            {pendingAction?.type === 'FILE_COMPLAINT' && (
              <div className="chat-bubble-wrapper assistant">
                <div className="chat-bubble-avatar">
                  <i className="bi bi-robot"></i>
                </div>
                <div className="chat-booking-card">
                  <div className="booking-card-header">
                    <i className="bi bi-megaphone"></i> Confirm Complaint
                  </div>
                  <div className="booking-card-body">
                    <div className="booking-detail">
                      <span className="booking-label">Against</span>
                      <span className="booking-value">
                        {pendingAction.target_type === 'MANAGEMENT' ? 'Website Management' : (pendingAction.target_name || pendingAction.target_type)}
                      </span>
                    </div>
                    <div className="booking-detail">
                      <span className="booking-label">Category</span>
                      <span className="booking-value">{CATEGORY_LABELS[pendingAction.category] || pendingAction.category || 'Other'}</span>
                    </div>
                    <div className="booking-detail">
                      <span className="booking-label">Subject</span>
                      <span className="booking-value">{pendingAction.subject}</span>
                    </div>
                    {pendingAction.description && (
                      <div className="booking-detail">
                        <span className="booking-label">Details</span>
                        <span className="booking-value">{pendingAction.description.slice(0, 160)}{pendingAction.description.length > 160 ? '…' : ''}</span>
                      </div>
                    )}
                  </div>
                  <div className="booking-card-actions">
                    <button className="booking-btn confirm" onClick={handleComplaintConfirm} disabled={actionInProgress}>
                      {actionInProgress ? (
                        <><div className="spinner-custom" style={{ width: 14, height: 14, borderWidth: 2 }} /> Filing...</>
                      ) : (
                        <><i className="bi bi-check-lg"></i> File Complaint</>
                      )}
                    </button>
                    <button className="booking-btn cancel" onClick={handleActionCancel} disabled={actionInProgress}>
                      <i className="bi bi-x-lg"></i> Cancel
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Message-to-Management Confirmation Card */}
            {pendingAction?.type === 'MESSAGE_MANAGEMENT' && (
              <div className="chat-bubble-wrapper assistant">
                <div className="chat-bubble-avatar">
                  <i className="bi bi-robot"></i>
                </div>
                <div className="chat-booking-card">
                  <div className="booking-card-header">
                    <i className="bi bi-envelope-paper"></i> Send Message to Management
                  </div>
                  <div className="booking-card-body">
                    <div className="booking-detail">
                      <span className="booking-label">Subject</span>
                      <span className="booking-value">{pendingAction.subject || '(none)'}</span>
                    </div>
                    {pendingAction.message && (
                      <div className="booking-detail">
                        <span className="booking-label">Message</span>
                        <span className="booking-value">{pendingAction.message.slice(0, 200)}{pendingAction.message.length > 200 ? '…' : ''}</span>
                      </div>
                    )}
                  </div>
                  <div className="booking-card-actions">
                    <button className="booking-btn confirm" onClick={handleManagementConfirm} disabled={actionInProgress}>
                      {actionInProgress ? (
                        <><div className="spinner-custom" style={{ width: 14, height: 14, borderWidth: 2 }} /> Sending...</>
                      ) : (
                        <><i className="bi bi-send"></i> Send</>
                      )}
                    </button>
                    <button className="booking-btn cancel" onClick={handleActionCancel} disabled={actionInProgress}>
                      <i className="bi bi-x-lg"></i> Cancel
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Thinking indicator */}
            {thinkingContent && (
              <div className="chat-bubble-wrapper assistant thinking-wrapper">
                <div className="chat-bubble-avatar">
                  <i className="bi bi-robot"></i>
                </div>
                <div className="chat-bubble thinking">
                  <div className="thinking-header">
                    <i className="bi bi-gear-wide-connected spin"></i> Thinking...
                  </div>
                  <div className="thinking-content">{thinkingContent}</div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <form className="chat-input-area" onSubmit={handleSendMessage}>
            <input
              type="text"
              value={inputMessage}
              onChange={(e) => setInputMessage(e.target.value)}
              placeholder={user ? 'Ask me anything...' : 'Please log in to chat...'}
              disabled={isTyping || !user}
              maxLength={MAX_INPUT_LENGTH}
              aria-label="Type your message"
            />
            <button type="submit" disabled={!inputMessage.trim() || isTyping || !user} aria-label="Send message">
              <i className="bi bi-send-fill"></i>
            </button>
          </form>
        </div>
      )}
    </div>
  )
}
