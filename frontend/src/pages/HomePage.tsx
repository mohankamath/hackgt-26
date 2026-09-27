import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ShieldCheck, SignIn, Eye, EyeSlash } from '@phosphor-icons/react'
import { useAuth } from '../hooks/useAuth'

function HomePage() {
  const navigate = useNavigate()
  const { login } = useAuth()

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    // Small timeout to feel like a real login
    setTimeout(() => {
      const err = login(username, password)
      setLoading(false)
      if (err) {
        setError(err)
        return
      }
      // Redirect based on role
      const key = username.toLowerCase().trim()
      if (key === 'parent') {
        navigate('/parent-dashboard')
      } else {
        navigate('/child-chat')
      }
    }, 400)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-soft-peach-50 relative overflow-hidden">
      <div className="bg-white rounded-4xl px-10 py-12 text-center shadow-[0_20px_60px_rgba(0,0,0,0.08)] max-w-[420px] w-[90%] z-10">
        <div className="mb-3 flex justify-center">
          <ShieldCheck size={64} weight="duotone" className="text-rust-brown-500" />
        </div>

        <h1 className="text-4xl font-extrabold text-ink-black-900 mb-1">
          SafeGuard
        </h1>

        <p className="text-lg font-semibold text-ink-black-400 mb-8">
          Sign in to continue
        </p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="text-left">
            <label htmlFor="username" className="text-xs font-bold text-ink-black-500 mb-1 block">
              Username
            </label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Enter username"
              autoComplete="username"
              required
              className="w-full bg-soft-peach-50 border border-rust-brown-100 rounded-xl px-4 py-3 text-sm text-ink-black-800 placeholder:text-ink-black-300 outline-none focus:border-rust-brown-300 focus:ring-2 focus:ring-rust-brown-100 transition-all"
            />
          </div>

          <div className="text-left">
            <label htmlFor="password" className="text-xs font-bold text-ink-black-500 mb-1 block">
              Password
            </label>
            <div className="relative">
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password"
                autoComplete="current-password"
                required
                className="w-full bg-soft-peach-50 border border-rust-brown-100 rounded-xl px-4 py-3 pr-11 text-sm text-ink-black-800 placeholder:text-ink-black-300 outline-none focus:border-rust-brown-300 focus:ring-2 focus:ring-rust-brown-100 transition-all"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 bg-transparent border-none cursor-pointer text-ink-black-400 hover:text-ink-black-600 transition-colors p-0 flex items-center"
              >
                {showPassword ? <EyeSlash size={18} weight="bold" /> : <Eye size={18} weight="bold" />}
              </button>
            </div>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-2.5 text-sm text-red-600 font-semibold text-left">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !username.trim() || !password}
            className="flex items-center justify-center gap-3 px-6 py-4 rounded-2xl text-lg font-bold text-white bg-spicy-orange-500 cursor-pointer border-none transition-all duration-200 hover:-translate-y-1 hover:shadow-lg active:translate-y-0 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:shadow-none"
          >
            <SignIn size={24} weight="bold" />
            <span className="tracking-wide">{loading ? 'Signing in…' : 'Sign In'}</span>
          </button>
        </form>

      </div>
    </div>
  )
}

export default HomePage
