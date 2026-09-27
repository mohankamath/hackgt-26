import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'

export type Role = 'parent' | 'child'

interface AuthState {
  role: Role
  username: string
}

interface AuthContextValue {
  user: AuthState | null
  login: (username: string, password: string) => string | null
  logout: () => void
}

/** Hardcoded credentials */
const CREDENTIALS: Record<string, { password: string; role: Role }> = {
  parent: { password: 'parent123', role: 'parent' },
  child: { password: 'child123', role: 'child' },
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthState | null>(() => {
    try {
      const stored = sessionStorage.getItem('screened_auth')
      return stored ? JSON.parse(stored) : null
    } catch {
      return null
    }
  })

  const login = useCallback((username: string, password: string): string | null => {
    const key = username.toLowerCase().trim()
    const cred = CREDENTIALS[key]
    if (!cred) return 'Unknown username'
    if (cred.password !== password) return 'Incorrect password'
    const state: AuthState = { role: cred.role, username: key }
    setUser(state)
    sessionStorage.setItem('screened_auth', JSON.stringify(state))
    return null // no error
  }, [])

  const logout = useCallback(() => {
    setUser(null)
    sessionStorage.removeItem('screened_auth')
  }, [])

  return (
    <AuthContext.Provider value={{ user, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
