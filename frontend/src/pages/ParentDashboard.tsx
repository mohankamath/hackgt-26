import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ShieldCheckIcon, GearIcon, SignOutIcon, BellIcon } from '@phosphor-icons/react'
import { useMessages } from '../hooks/useMessages'
import { useContacts } from '../hooks/useContacts'
import { useThreads } from '../hooks/useThreads'
import { useAlerts } from '../hooks/useAlerts'
import { useDigests } from '../hooks/useDigests'
import { useSettings } from '../hooks/useSettings'
import { useAuth } from '../hooks/useAuth'
import { activityByDay, categoryBreakdown, overviewStats, reviewFeed } from '../lib/stats'
import type { FirestoreMessage } from '../types/message'
import type { Alert } from '../types/safety'
import OverviewStats from '../components/dashboard/OverviewStats'
import { ActivityChart, CategoryBreakdown } from '../components/dashboard/Charts'
import RiskThreads from '../components/dashboard/RiskThreads'
import { ContactList, ContactQueue } from '../components/dashboard/ContactQueue'
import { AlertsFeed, AlertToasts } from '../components/dashboard/AlertsFeed'
import MessageFeed, { type FeedFilter } from '../components/dashboard/MessageFeed'
import MessageReviewDrawer from '../components/dashboard/MessageReviewDrawer'
import DigestCard from '../components/dashboard/DigestCard'

function scrollToSection(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function ParentDashboard() {
  const navigate = useNavigate()
  const { logout } = useAuth()
  const { messages, loading, error } = useMessages()
  const { contacts, statusOf, setStatus, revet } = useContacts()
  const { threads } = useThreads()
  const { alerts, unreadCount, markRead, markAllRead } = useAlerts()
  const { latest: digest } = useDigests()
  const { settings } = useSettings()

  const [filter, setFilter] = useState<FeedFilter>('all')
  const [search, setSearch] = useState('')
  const [openDocId, setOpenDocId] = useState<string | null>(null)

  const effectiveFilter: FeedFilter = settings.privacyMode && filter === 'all' ? 'flagged' : filter
  const stats = useMemo(() => overviewStats(messages), [messages])
  const activity = useMemo(() => activityByDay(messages), [messages])
  const categories = useMemo(() => categoryBreakdown(messages), [messages])
  const feed = useMemo(
    () => reviewFeed(messages, { privacyMode: settings.privacyMode, filter: effectiveFilter, search }),
    [messages, settings.privacyMode, effectiveFilter, search],
  )
  const riskyThreads = threads.filter((t) => t.risk_level === 'medium' || t.risk_level === 'high').length
  const openMsg: FirestoreMessage | undefined = openDocId ? messages.find((m) => m.id === openDocId) : undefined

  const openAlert = (a: Alert) => {
    if (a.message_doc_id && messages.some((m) => m.id === a.message_doc_id)) setOpenDocId(a.message_doc_id)
    else if (a.type === 'new_contact' || a.type === 'contact_risk') scrollToSection('contacts')
    else if (a.thread_id) scrollToSection('risk')
  }

  return (
    <div className="min-h-screen bg-soft-peach-50 flex flex-col">
      <header className="bg-spicy-orange-500 text-white px-6 py-4 flex items-center gap-4 flex-wrap">
        <button onClick={() => { logout(); navigate('/') }} className="bg-white/20 border-none text-white px-4 py-2 rounded-xl text-sm font-semibold cursor-pointer hover:bg-white/35 transition-colors flex items-center gap-1.5">
          <SignOutIcon size={16} weight="bold" aria-hidden /> Log out
        </button>
        <div className="flex items-center gap-2">
          <ShieldCheckIcon size={24} weight="bold" aria-hidden />
          <h1 className="text-xl font-bold m-0">{settings.childName && settings.childName !== 'Your child' ? `${settings.childName}'s SafeGuard` : 'Parent Dashboard'}</h1>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => scrollToSection('alerts')} className="relative bg-white/20 border-none text-white px-3 py-2 rounded-xl text-sm font-semibold cursor-pointer hover:bg-white/35 flex items-center gap-1.5" aria-label={`${unreadCount} unread alerts`}>
            <BellIcon size={16} weight="bold" aria-hidden />
            {unreadCount > 0 && <span className="bg-white text-spicy-orange-600 text-[0.7rem] font-bold rounded-full min-w-5 h-5 px-1 flex items-center justify-center">{unreadCount}</span>}
          </button>
          <button onClick={() => navigate('/settings')} className="bg-white/20 border-none text-white px-4 py-2 rounded-xl text-sm font-semibold cursor-pointer hover:bg-white/35 transition-colors flex items-center gap-1.5">
            <GearIcon size={16} weight="bold" aria-hidden /> Settings
          </button>
        </div>
      </header>

      <main className="px-6 py-5 flex flex-col gap-5 max-w-[1400px] w-full mx-auto">
        <OverviewStats stats={stats} highRiskThreads={riskyThreads} />

        <div id="contacts">
          <ContactQueue contacts={contacts} onSetStatus={setStatus} onRevet={revet} onOpenMessage={setOpenDocId} />
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-5 items-start">
          <div className="xl:col-span-2 flex flex-col gap-5">
            <div id="risk">
              <RiskThreads threads={threads} onOpenMessage={setOpenDocId} riskyOnly={settings.privacyMode} />
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <ActivityChart data={activity} />
              <CategoryBreakdown data={categories} />
            </div>
            <MessageFeed
              messages={feed}
              filter={effectiveFilter}
              onFilter={setFilter}
              search={search}
              onSearch={setSearch}
              privacyMode={settings.privacyMode}
              onOpen={(m) => setOpenDocId(m.id ?? null)}
              loading={loading}
              error={error}
            />
          </div>
          <div className="flex flex-col gap-5">
            <div id="alerts">
              <AlertsFeed alerts={alerts} unreadCount={unreadCount} onMarkRead={markRead} onMarkAllRead={markAllRead} onOpen={openAlert} />
            </div>
            <DigestCard digest={digest} />
            <ContactList contacts={contacts} onSetStatus={setStatus} />
          </div>
        </div>
      </main>

      <AlertToasts alerts={alerts} onOpen={openAlert} />
      {openMsg && (
        <MessageReviewDrawer msg={openMsg} contactStatus={statusOf(openMsg.contact_id)} onClose={() => setOpenDocId(null)} onSetContactStatus={setStatus} />
      )}
    </div>
  )
}

export default ParentDashboard
