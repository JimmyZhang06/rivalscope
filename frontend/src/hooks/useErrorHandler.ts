import { useState, useCallback } from 'react'

export function useErrorHandler(fallback = '操作失败') {
  const [error, setError] = useState('')
  const clear = useCallback(() => setError(''), [])
  const handle = useCallback(
    (err: unknown) => {
      const message = err instanceof Error ? err.message : fallback
      setError(message)
      console.error(fallback, err)
    },
    [fallback],
  )
  return { error, clear, handle }
}
