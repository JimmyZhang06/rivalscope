import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { ApiError, fetchMe, login as apiLogin, register as apiRegister, request, tokenStore } from '../api/client'
import type { User } from '../api/types'

interface AuthState {
  user: User | null
  /** 启动时恢复会话是否完成 */
  ready: boolean
  login: (email: string, password: string) => Promise<User>
  register: (email: string, password: string, nickname: string) => Promise<User>
  logout: () => void
  /** 重新拉取当前用户信息（升级套餐后刷新徽标） */
  refreshUser: () => Promise<void>
  /** 直接以后端返回的用户对象更新（改资料后同步） */
  updateUser: (user: User) => void
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [ready, setReady] = useState(false)

  // 启动时如有 token 则尝试恢复会话
  useEffect(() => {
    if (!tokenStore.get()) {
      setReady(true)
      return
    }
    fetchMe()
      .then(setUser)
      .catch(() => tokenStore.clear())
      .finally(() => setReady(true))
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    const resp = await apiLogin(email, password)
    tokenStore.set(resp.access_token)
    setUser(resp.user)
    return resp.user
  }, [])

  const register = useCallback(async (email: string, password: string, nickname: string) => {
    const resp = await apiRegister(email, password, nickname)
    tokenStore.set(resp.access_token)
    setUser(resp.user)
    return resp.user
  }, [])

  const logout = useCallback(() => {
    tokenStore.clear()
    setUser(null)
  }, [])

  const refreshUser = useCallback(async () => {
    if (!tokenStore.get()) return
    try {
      setUser(await fetchMe())
    } catch {
      /* 401 时 request 已处理跳转 */
    }
  }, [])

  const updateUser = useCallback((u: User) => setUser(u), [])

  const value = useMemo(
    () => ({ user, ready, login, register, logout, refreshUser, updateUser }),
    [user, ready, login, register, logout, refreshUser, updateUser],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth 必须在 AuthProvider 内使用')
  return ctx
}

/** 未登录跳转 /login 的路由守卫 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, ready } = useAuth()
  const location = useLocation()
  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600" />
      </div>
    )
  }
  if (!user) return <Navigate to="/login" state={{ from: location.pathname }} replace />
  return <>{children}</>
}

export function RequireAdmin({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [verified, setVerified] = useState(false)
  const [verifiedError, setVerifiedError] = useState(false)

  useEffect(() => {
    if (!user || user.role !== 'admin') return
    let cancelled = false
    request<{ total_users: number }>('/api/admin/stats')
      .then(() => !cancelled && setVerified(true))
      .catch((err) => {
        if (cancelled) return
        if (err instanceof ApiError && err.status === 403) {
          tokenStore.clear()
        }
        setVerifiedError(true)
      })
    return () => { cancelled = true }
  }, [user])

  if (!user || user.role !== 'admin') return <Navigate to="/app" replace />
  if (verifiedError) return <Navigate to="/login" replace />
  if (!verified) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600" />
      </div>
    )
  }
  return <>{children}</>
}
