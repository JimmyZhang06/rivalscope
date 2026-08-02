import { useEffect } from 'react'

/**
 * 同步 document.title。
 * 各页面顶部调用一次即可：usePageTitle('调研记录')
 */
export function usePageTitle(title: string) {
  useEffect(() => {
    document.title = `${title} — 竞品调研 Agent`
  }, [title])
}
