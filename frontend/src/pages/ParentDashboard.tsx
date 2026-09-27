import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { BellIcon, EyeSlashIcon, GearSixIcon } from '@phosphor-icons/react'
import { useMessages } from '../hooks/useMessages'
import { useContacts } from '../hooks/useContacts'
import { useThreads } from '../hooks/useThreads'
import { useAlerts } from '../hooks/useAlerts'
import { useDigests } from '../hooks/useDigests'
import { useSettings } from '../hooks/useSettings'
import { activityByDay, categoryBreakdown, overviewStats, reviewFeed } from '../lib/stats'
import type { FirestoreMessage } from '../types/message'
import type { Alert } from '../types/safety'
import ParentShell from '../components/common/ParentShell'
import { Chip } from '../components/common/ui'
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

function greeting(now = new Date()) {
  const h = now.getHours()
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
}

function ParentDashboard() {
  const navigate = useNavigate()
  const location = useLocation()
  const { messages, loading, error } = useMessages()
  const { contacts, pending, statusOf, setStatus, revet } = useContacts()
  const { threads } = useThreads()
  const { alerts, unreadCount, markRead, markAllRead } = useAlerts()
  const { latest: digest } = useDigests()
  const { settings } = useSettings()

  const [filter, setFilter] = useState<FeedFilter>('all')
  const [search, setSearch] = useState('')
  const [openDocId, setOpenDocId] = useState<string | null>(null)

  // Deep links from the nav rail on other pages (e.g. /parent-dashboard#alerts)
  useEffect(() => {
    if (location.hash) setTimeout(() => scrollToSection(location.hash.slice(1)), 150)
  }, [location.hash])

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
  const childName = settings.childName && settings.childName !== 'Your child' ? settings.childName : 'your child'

  const openAlert = (a: Alert) => {
    if (a.message_doc_id && messages.some((m) => m.id === a.message_doc_id)) setOpenDocId(a.message_doc_id)
    else if (a.type === 'new_contact' || a.type === 'contact_risk') scrollToSection('contacts')
    else if (a.thread_id) scrollToSection('risk')
  }

  const headerBtn = 'relative h-9 px-3 rounded-lg bg-surface-2 ring-1 ring-line border-none text-fg-soft hover:text-fg hover:bg-surface-3 flex items-center gap-1.5 text-sm transition-colors'

  return (
    <ParentShell
      title={`${greeting()}`}
      subtitle={`Here's how ${childName}'s conversations are going`}
      badges={{ contacts: pending.length, alerts: unreadCount }}
      actions={
        <>
          {settings.privacyMode && (
            <Chip tone="warn" className="max-sm:hidden">
              <EyeSlashIcon size={11} aria-hidden /> privacy mode
            </Chip>
          )}
          <button onClick={() => scrollToSection('alerts')} className={headerBtn} aria-label={`${unreadCount} unread alerts`}>
            <BellIcon size={16} weight={unreadCount ? 'fill' : 'regular'} className={unreadCount ? 'text-accent' : ''} aria-hidden />
            {unreadCount > 0 && <span className="text-xs font-semibold text-fg tabular-nums">{unreadCount}</span>}
          </button>
          <button onClick={() => navigate('/settings')} className={`${headerBtn} md:hidden`} aria-label="Settings">
            <GearSixIcon size={16} aria-hidden />
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <div id="overview" className="scroll-mt-24">
          <OverviewStats stats={stats} highRiskThreads={riskyThreads} />
        </div>

        <div id="contacts" className="scroll-mt-24">
          <ContactQueue contacts={contacts} onSetStatus={setStatus} onRevet={revet} onOpenMessage={setOpenDocId} />
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_380px] gap-5 items-start">
          <div className="flex flex-col gap-5 min-w-0">
            <div id="risk" className="scroll-mt-24">
              <RiskThreads threads={threads} onOpenMessage={setOpenDocId} riskyOnly={settings.privacyMode} />
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <ActivityChart data={activity} />
              <CategoryBreakdown data={categories} />
            </div>
            <div id="messages" className="scroll-mt-24">
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
          </div>
          <aside className="flex flex-col gap-5 xl:sticky xl:top-20">
            <div id="alerts" className="scroll-mt-24">
              <AlertsFeed alerts={alerts} unreadCount={unreadCount} onMarkRead={markRead} onMarkAllRead={markAllRead} onOpen={openAlert} />
            </div>
            <DigestCard digest={digest} />
            <ContactList contacts={contacts} onSetStatus={setStatus} />
          </aside>
        </div>
      </div>

      <AlertToasts alerts={alerts} onOpen={openAlert} />
      {openMsg && (
        <MessageReviewDrawer msg={openMsg} contactStatus={statusOf(openMsg.contact_id)} onClose={() => setOpenDocId(null)} onSetContactStatus={setStatus} />
      )}
    </ParentShell>
  )
}

export default ParentDashboard
