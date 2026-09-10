// Empty means same-origin (local Vite proxy or an Aliyun Nginx reverse proxy).
const apiOrigin = (import.meta.env.VITE_API_ORIGIN ?? '').trim().replace(/\/+$/, '')

if (apiOrigin) {
  const parsed = new URL(apiOrigin)
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== apiOrigin) {
    throw new Error('VITE_API_ORIGIN must be an HTTP(S) origin without a path')
  }
  if (import.meta.env.PROD && parsed.protocol !== 'https:') {
    throw new Error('VITE_API_ORIGIN must use HTTPS in production')
  }
}

export function apiUrl(path: string): string {
  if (!path.startsWith('/api/')) throw new Error('Expected an /api/ path')
  return `${apiOrigin}${path}`
}
