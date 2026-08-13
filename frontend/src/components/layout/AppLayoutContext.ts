import { useOutletContext } from 'react-router-dom'

export interface AppLayoutContextValue {
  unreadCount: number
  unreadError: string
  refreshUnreadCount: () => void
}

export function useAppLayoutContext() {
  return useOutletContext<AppLayoutContextValue>()
}
