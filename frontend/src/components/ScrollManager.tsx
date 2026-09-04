import { useLayoutEffect } from 'react'
import { useLocation } from 'react-router-dom'

export default function ScrollManager() {
  const { pathname, search, hash } = useLocation()

  useLayoutEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (hash) {
        const target = document.getElementById(decodeURIComponent(hash.slice(1)))
        if (target) {
          target.scrollIntoView({ block: 'start', behavior: 'auto' })
          return
        }
      }
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
    })
    return () => cancelAnimationFrame(frame)
  }, [hash, pathname, search])

  return null
}
