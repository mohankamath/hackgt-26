import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import {
  SquaresFourIcon,
  UserPlusIcon,
  WaveformIcon,
  ChatsIcon,
  BellIcon,
  GearSixIcon,
  SignOutIcon,
} from '@phosphor-icons/react'
import { useAuth } from '../../hooks/useAuth'
import { Logo } from './ui'

interface Props {
  title: string
  subtitle?: string
  actions?: React.ReactNode
  children: React.ReactNode
  /** Counts shown as badges on nav items */
  badges?: Partial<Record<'contacts' | 'alerts', number>>
}

const SECTIONS = [
  { id: 'overview', label: 'Overview', icon: SquaresFourIcon },
  { id: 'contacts', label: 'New contacts', icon: UserPlusIcon, badge: 'contacts' as const },
  { id: 'risk', label: 'Conversations', icon: WaveformIcon },
  { id: 'messages', label: 'Messages', icon: ChatsIcon },
  { id: 'alerts', label: 'Alerts', icon: BellIcon, badge: 'alerts' as const },
]

/** Parent-side layout: slim icon rail on the left, sticky top bar, content area. */
export default function ParentShell({ title, subtitle, actions, children, badges = {} }: Props) {
  const navigate = useNavigate()
  const { logout } = useAuth()
  const location = useLocation()
  const onDashboard = location.pathname.startsWith('/parent-dashboard')

  const go = (id: string) => {
    if (!onDashboard) {
      navigate(`/parent-dashboard#${id}`)
      return
    }
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const railBtn = 'relative w-11 h-11 rounded-xl flex items-center justify-center border-none bg-transparent text-muted hover:text-fg hover:bg-surface-2 transition-colors group'

  return (
    <div className="min-h-screen bg-bg flex">
      <nav aria-label="Parent navigation" className="fixed inset-y-0 left-0 z-30 w-[72px] bg-abyss border-r border-line flex flex-col items-center py-4 gap-1 max-md:hidden">
        <button onClick={() => navigate('/parent-dashboard')} className="mb-4 bg-transparent border-none p-0" aria-label="Screened home">
          <Logo size={34} />
        </button>
        {SECTIONS.map(({ id, label, icon: Icon, badge }) => {
          const count = badge ? badges[badge] ?? 0 : 0
          return (
            <button key={id} onClick={() => go(id)} className={railBtn} aria-label={label} title={label}>
              <Icon size={22} weight="duotone" />
              {count > 0 && (
                <span className="absolute top-1.5 right-1.5 min-w-4 h-4 px-1 rounded-full bg-danger text-abyss text-[0.6rem] font-bold flex items-center justify-center">
                  {count > 9 ? '9+' : count}
                </span>
              )}
              <span className="pointer-events-none absolute left-14 whitespace-nowrap rounded-md bg-surface-3 px-2 py-1 text-xs text-fg opacity-0 group-hover:opacity-100 transition-opacity ring-1 ring-line">
                {label}
              </span>
            </button>
          )
        })}
        <div className="mt-auto flex flex-col gap-1">
          <NavLink to="/settings" aria-label="Settings" title="Settings" className={({ isActive }) => `${railBtn} ${isActive ? 'text-accent bg-surface-2' : ''}`}>
            <GearSixIcon size={22} weight="duotone" />
          </NavLink>
          <button onClick={() => { logout(); navigate('/') }} className={railBtn} aria-label="Log out" title="Log out">
            <SignOutIcon size={22} weight="duotone" />
          </button>
        </div>
      </nav>

      <div className="flex-1 md:ml-[72px] min-w-0 flex flex-col">
        <header className="sticky top-0 z-20 bg-bg/80 backdrop-blur-xl border-b border-line">
          <div className="max-w-[1440px] mx-auto px-6 h-16 flex items-center gap-4">
            <span className="md:hidden"><Logo size={28} /></span>
            <div className="min-w-0">
              <h1 className="text-lg font-semibold text-fg m-0 truncate">{title}</h1>
              {subtitle && <p className="text-xs text-muted m-0 truncate">{subtitle}</p>}
            </div>
            <div className="ml-auto flex items-center gap-2">{actions}</div>
          </div>
        </header>
        <main className="flex-1 max-w-[1440px] w-full mx-auto px-6 py-6">{children}</main>
      </div>
    </div>
  )
}
