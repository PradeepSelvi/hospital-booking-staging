import { useState, useEffect, useCallback } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useDevice } from '../context/DeviceContext'
import { getConversations, getOrCreateConversation, setAcceptNewPatientMessages } from '../services/chat'
import { getDoctorByUserId } from '../services/doctors'
import ChatThread from '../components/ChatThread'
import NewConversationModal from '../components/NewConversationModal'
import { toast } from 'react-toastify'

/**
 * Shared messages screen for patients and doctors. Conversation list on the
 * left, the selected thread on the right. RLS scopes conversations to the
 * caller, so the same component serves both roles.
 *
 * Props:
 * - role: 'PATIENT' | 'DOCTOR' — controls which party's name is shown.
 */
export default function Messages({ role }) {
  const { user } = useAuth()
  const location = useLocation()
  const { isMobile } = useDevice()
  const [conversations, setConversations] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeId, setActiveId] = useState(location.state?.conversationId ?? null)
  const [showNew, setShowNew] = useState(false)
  const [mobileThreadOpen, setMobileThreadOpen] = useState(Boolean(location.state?.conversationId))
  const [doctorId, setDoctorId] = useState(null)
  const [acceptNew, setAcceptNew] = useState(true)
  const [savingPref, setSavingPref] = useState(false)

  const load = useCallback(async () => {
    try {
      const list = await getConversations(user.id)
      setConversations(list)
      setActiveId(prev => prev ?? list[0]?.id ?? null)
    } catch (err) {
      toast.error(err.message || 'Could not load conversations.')
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => {
    if (user) load()
  }, [user, load])

  // Doctors: load their "accept new patient messages" preference.
  useEffect(() => {
    let alive = true
    async function loadPref() {
      try {
        const doc = await getDoctorByUserId(user.id)
        if (!alive || !doc) return
        setDoctorId(doc.id)
        setAcceptNew(doc.accept_new_patient_messages ?? true)
      } catch { /* ignore */ }
    }
    if (user && role === 'DOCTOR') loadPref()
    return () => { alive = false }
  }, [user, role])

  async function toggleAcceptNew() {
    if (!doctorId || savingPref) return
    const next = !acceptNew
    setAcceptNew(next)
    try {
      setSavingPref(true)
      await setAcceptNewPatientMessages(doctorId, next)
      toast.success(next ? 'New patients can now message you.' : 'New patients can no longer start a chat.')
    } catch (err) {
      setAcceptNew(!next) // revert on failure
      toast.error(err.message || 'Could not update setting.')
    } finally {
      setSavingPref(false)
    }
  }

  async function handlePickDoctor(doctorId) {
    try {
      const conv = await getOrCreateConversation(user.id, doctorId)
      setShowNew(false)
      await load()
      setActiveId(conv.id)
      setMobileThreadOpen(true)
    } catch (err) {
      toast.error(err.message || 'Could not start the conversation.')
    }
  }

  function openConversation(id) {
    setActiveId(id)
    setMobileThreadOpen(true)
  }

  function otherParty(c) {
    if (role === 'DOCTOR') {
      return { title: c.patient?.name || 'Patient', subtitle: 'Patient' }
    }
    return {
      title: c.doctor?.profiles?.name ? `Dr. ${c.doctor.profiles.name}` : 'Doctor',
      subtitle: c.doctor?.specialization || '',
    }
  }

  const active = conversations.find(c => c.id === activeId)

  // On mobile, show one pane at a time: the list, or the open thread.
  const listVisible = !isMobile || !mobileThreadOpen
  const threadVisible = !isMobile || mobileThreadOpen

  return (
    <div className="card-custom" style={{ overflow: 'hidden', height: 'calc(100vh - 200px)', minHeight: 420, display: 'flex' }}>
      {/* Conversation list */}
      <div style={{
        width: isMobile ? '100%' : 300,
        borderRight: isMobile ? 'none' : '1px solid var(--gray-200)',
        display: listVisible ? 'flex' : 'none',
        flexDirection: 'column', minHeight: 0,
      }}>
        <div style={{ padding: '16px 18px', borderBottom: '1px solid var(--gray-200)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h5 style={{ margin: 0, fontWeight: 700 }}><i className="bi bi-chat-dots me-2" />Messages</h5>
            {role === 'PATIENT' && (
              <button
                className="btn-primary-custom"
                style={{ padding: '6px 12px', fontSize: 13 }}
                onClick={() => setShowNew(true)}
              >
                <i className="bi bi-pencil-square me-1" />New
              </button>
            )}
          </div>
          {role === 'DOCTOR' && (
            <label
              style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, fontSize: 12, color: 'var(--gray-600)', cursor: 'pointer' }}
              title="When off, only patients you've had an appointment with can start a chat."
            >
              <input
                type="checkbox"
                checked={acceptNew}
                onChange={toggleAcceptNew}
                disabled={savingPref || !doctorId}
              />
              Accept messages from new patients
            </label>
          )}
        </div>
        <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
          {loading ? (
            <div className="text-center py-4"><div className="spinner-custom" /></div>
          ) : conversations.length === 0 ? (
            <div style={{ padding: 18 }}>
              <p style={{ fontSize: 13, color: 'var(--gray-400)', margin: 0 }}>
                No conversations yet.
              </p>
              {role === 'PATIENT' && (
                <button
                  className="btn-outline-custom mt-3"
                  style={{ fontSize: 13, padding: '8px 14px' }}
                  onClick={() => setShowNew(true)}
                >
                  <i className="bi bi-plus-lg me-1" />Message a doctor
                </button>
              )}
            </div>
          ) : (
            conversations.map(c => {
              const { title, subtitle } = otherParty(c)
              const isActive = c.id === activeId
              return (
                <button
                  key={c.id}
                  onClick={() => openConversation(c.id)}
                  className="w-100 text-start"
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px',
                    border: 'none', borderBottom: '1px solid var(--gray-100)',
                    background: isActive ? 'var(--gray-50)' : 'white', cursor: 'pointer',
                  }}
                >
                  <div className="avatar" style={{ width: 38, height: 38, fontSize: 14 }}>
                    {title.charAt(0).toUpperCase()}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 14 }} className="truncate">{title}</div>
                    <div style={{ fontSize: 12, color: 'var(--gray-400)' }} className="truncate">{subtitle}</div>
                  </div>
                  {c.unreadCount > 0 && (
                    <span style={{ background: 'var(--primary)', color: 'white', borderRadius: 999, fontSize: 11, minWidth: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 6px' }}>
                      {c.unreadCount}
                    </span>
                  )}
                </button>
              )
            })
          )}
        </div>
      </div>

      {/* Thread */}
      <div style={{ flex: 1, minWidth: 0, display: threadVisible ? 'block' : 'none' }}>
        {active ? (
          <ChatThread
            key={active.id}
            conversationId={active.id}
            currentUserId={user.id}
            {...otherParty(active)}
            onActivity={load}
            onBack={isMobile ? () => setMobileThreadOpen(false) : undefined}
          />
        ) : (
          <div className="d-flex align-items-center justify-content-center h-100" style={{ color: 'var(--gray-400)', fontSize: 14 }}>
            <div className="text-center">
              <i className="bi bi-chat-square-text" style={{ fontSize: 36, display: 'block', marginBottom: 8 }} />
              Select a conversation to start chatting
            </div>
          </div>
        )}
      </div>

      {showNew && (
        <NewConversationModal
          onPick={handlePickDoctor}
          onClose={() => setShowNew(false)}
        />
      )}
    </div>
  )
}
