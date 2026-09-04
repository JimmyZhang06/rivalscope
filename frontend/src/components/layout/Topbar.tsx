import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Gem, LogOut, Menu, Shield, UserRound } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'
import type { User } from '../../api/types'
import NotificationBell from '../NotificationBell'
import CreateMenu from './CreateMenu'
import { getPageTitle } from './navigation'

interface TopbarProps {
  unreadCount: number
  user: User | null
  onOpenMobile: () => void
  onLogout: () => void
  onRefreshUnread: () => void
}

export default function Topbar({ unreadCount, user, onOpenMobile, onLogout, onRefreshUnread }: TopbarProps) {
  const { pathname } = useLocation()
  const title = getPageTitle(pathname)
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const userMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!userMenuOpen) return
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) setUserMenuOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setUserMenuOpen(false)
    }
    document.addEventListener('mousedown', closeOnOutsideClick)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [userMenuOpen])

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-black/10 bg-[#f8f6f0]/95 px-4 backdrop-blur-xl sm:px-6">
      <div className="flex min-w-0 items-center gap-3">
        <button
          type="button"
          aria-label="打开导航"
          onClick={onOpenMobile}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-black/10 bg-white/50 text-gray-600 hover:bg-white lg:hidden"
        >
          <Menu className="h-4 w-4" />
        </button>
        <div className="min-w-0">
          <p className="truncate text-[10px] font-semibold uppercase tracking-[0.18em] text-[#245f8f]">RivalScope intelligence</p>
          <h1 className="truncate text-sm font-semibold text-[#171b1f] sm:text-base">{title}</h1>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <CreateMenu />
        <NotificationBell count={unreadCount} onCountChange={onRefreshUnread} />
        <div ref={userMenuRef} className="relative">
          <button
            type="button"
            aria-label="打开用户菜单"
            aria-haspopup="menu"
            aria-expanded={userMenuOpen}
            onClick={() => setUserMenuOpen((value) => !value)}
            className="flex h-9 items-center gap-1.5 rounded-full border border-black/10 bg-white/55 p-1 pr-2 text-gray-600 hover:bg-white"
          >
            {user?.avatar?.startsWith('data:image/') ? (
              <img src={user.avatar} alt="头像" className="h-7 w-7 rounded-md object-cover" />
            ) : (
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#171b1f] text-xs font-bold text-white">
                {(user?.nickname || user?.email || '?').slice(0, 1).toUpperCase()}
              </span>
            )}
            <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          {userMenuOpen && (
            <div role="menu" aria-label="用户菜单" className="absolute right-0 top-11 z-50 w-56 overflow-hidden rounded-2xl border border-black/10 bg-[#fbfaf6] p-1.5 shadow-xl">
              <div className="border-b border-gray-100 px-3 py-2">
                <p className="truncate text-sm font-semibold text-gray-900">{user?.nickname || '用户'}</p>
                <p className="truncate text-xs text-gray-400">{user?.email}</p>
              </div>
              <Link role="menuitem" to="/app/account" onClick={() => setUserMenuOpen(false)} className="mt-1 flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"><UserRound className="h-4 w-4" />账户设置</Link>
              <Link role="menuitem" to="/app/account?tab=billing" onClick={() => setUserMenuOpen(false)} className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"><Gem className="h-4 w-4" />套餐与账单</Link>
              {user?.role === 'admin' && <Link role="menuitem" to="/app/admin" onClick={() => setUserMenuOpen(false)} className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"><Shield className="h-4 w-4" />管理后台</Link>}
              <button role="menuitem" type="button" onClick={onLogout} className="mt-1 flex w-full items-center gap-3 border-t border-gray-100 px-3 py-2.5 text-left text-sm text-red-600 hover:bg-red-50"><LogOut className="h-4 w-4" />退出登录</button>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
