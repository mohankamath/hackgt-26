import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { EyeIcon, EyeSlashIcon, ArrowRightIcon, ShieldCheckIcon, BrainIcon, HandHeartIcon, UserCircleIcon, SmileyIcon } from '@phosphor-icons/react'
import { useAuth } from '../hooks/useAuth'
import { Logo } from '../components/common/ui'

const FEATURES = [
  { icon: ShieldCheckIcon, title: 'Every message and image checked', body: 'OpenAI moderation screens DMs, photos and profile pictures before your child sees them.' },
  { icon: BrainIcon, title: 'Sees patterns, not just words', body: 'Reads whole conversations to spot grooming signals like secrecy, gifts, and meetups.' },
  { icon: HandHeartIcon, title: 'Built for trust', body: 'Kind coaching for kids, clear explanations for parents, privacy mode for both.' },
]

const DEMO = [
  { role: 'Parent', icon: UserCircleIcon, username: 'parent', password: 'parent123' },
  { role: 'Kid', icon: SmileyIcon, username: 'child', password: 'child123' },
]

function HomePage() {
  const navigate = useNavigate()
  const { login } = useAuth()

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const signIn = (u: string, p: string) => {
    setError(null)
    setLoading(true)
    setTimeout(() => {
      const err = login(u, p)
      setLoading(false)
      if (err) {
        setError(err)
        return
      }
      navigate(u.toLowerCase().trim() === 'parent' ? '/parent-dashboard' : '/child-chat')
    }, 300)
  }

  return (
    <div className="min-h-screen bg-aurora relative overflow-hidden grid lg:grid-cols-[1.1fr_1fr]">
      <div className="absolute inset-0 bg-grid pointer-events-none" aria-hidden />

      {/* Story side */}
      <section className="relative hidden lg:flex flex-col justify-between p-12 xl:p-16">
        <div className="flex items-center gap-3">
          <Logo size={36} />
          <span className="font-display text-xl font-semibold tracking-tight">SafeGuard</span>
        </div>
        <div className="max-w-xl">
          <p className="text-accent text-sm font-semibold tracking-[0.18em] uppercase mb-4">Safer DMs for kids</p>
          <h1 className="text-5xl xl:text-6xl font-bold leading-[1.05] m-0">
            Let them connect.
            <br />
            <span className="text-gradient">We'll keep watch.</span>
          </h1>
          <p className="text-fg-soft text-lg mt-6 mb-0 leading-relaxed">
            One inbox for Discord and Instagram, with AI that filters harm, flags risky conversations, and helps parents and kids talk about what matters.
          </p>
          <ul className="mt-10 grid gap-4 list-none p-0">
            {FEATURES.map(({ icon: Icon, title, body }, i) => (
              <li key={title} className="flex gap-4 animate-rise" style={{ animationDelay: `${120 * i}ms` }}>
                <span className="w-10 h-10 rounded-xl bg-surface-2 ring-1 ring-line flex items-center justify-center text-accent shrink-0">
                  <Icon size={20} weight="duotone" aria-hidden />
                </span>
                <div>
                  <p className="font-semibold text-fg m-0">{title}</p>
                  <p className="text-sm text-muted m-0 mt-0.5">{body}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <p className="text-xs text-subtle m-0">Built at HackGT 13 · Seaside Market</p>
      </section>

      {/* Sign-in side */}
      <section className="relative flex items-center justify-center p-6">
        <div className="w-full max-w-[400px] panel p-8 backdrop-blur-xl bg-surface/80 animate-pop-in">
          <div className="lg:hidden flex items-center gap-2.5 mb-6">
            <Logo size={32} />
            <span className="font-display text-lg font-semibold">SafeGuard</span>
          </div>
          <h2 className="text-2xl font-semibold m-0">Welcome back</h2>
          <p className="text-sm text-muted mt-1 mb-6">Sign in to your family's space.</p>

          <form
            onSubmit={(e) => {
              e.preventDefault()
              signIn(username, password)
            }}
            className="flex flex-col gap-4"
          >
            <label className="text-xs font-medium text-fg-soft">
              Username
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="parent or child"
                autoComplete="username"
                required
                className="field w-full mt-1.5 px-3.5 py-2.5 text-sm"
              />
            </label>

            <label className="text-xs font-medium text-fg-soft">
              Password
              <span className="relative block mt-1.5">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  required
                  className="field w-full px-3.5 py-2.5 pr-10 text-sm"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 bg-transparent border-none text-muted hover:text-fg p-1 flex"
                >
                  {showPassword ? <EyeSlashIcon size={18} /> : <EyeIcon size={18} />}
                </button>
              </span>
            </label>

            {error && (
              <p role="alert" className="m-0 rounded-lg bg-danger/10 ring-1 ring-danger/30 px-3 py-2 text-sm text-danger">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading || !username.trim() || !password}
              className="mt-1 inline-flex items-center justify-center gap-2 rounded-xl border-none px-5 py-3 font-semibold text-abyss bg-accent-gradient shadow-glow hover:brightness-110 transition-all disabled:opacity-40 disabled:cursor-not-allowed group"
            >
              {loading ? 'Signing in…' : 'Sign in'}
              <ArrowRightIcon size={18} weight="bold" className="transition-transform group-hover:translate-x-0.5" aria-hidden />
            </button>
          </form>

          <div className="mt-7">
            <p className="text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-subtle mb-2">Demo accounts</p>
            <div className="grid grid-cols-2 gap-2">
              {DEMO.map(({ role, icon: Icon, username: u, password: p }) => (
                <button
                  key={role}
                  type="button"
                  onClick={() => signIn(u, p)}
                  className="flex items-center gap-2.5 rounded-xl bg-surface-2 ring-1 ring-line hover:ring-accent/50 hover:bg-surface-3 border-none px-3 py-2.5 text-left transition-all"
                >
                  <Icon size={22} weight="duotone" className="text-accent shrink-0" aria-hidden />
                  <span>
                    <span className="block text-sm font-medium text-fg">{role}</span>
                    <span className="block text-[0.7rem] text-muted font-mono">{u} / {p}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}

export default HomePage
