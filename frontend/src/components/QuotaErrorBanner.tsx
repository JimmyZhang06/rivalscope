import { Link } from 'react-router-dom'

/** 统一错误红条：额度/套餐相关错误时附带升级引导链接 */
export default function QuotaErrorBanner({ message }: { message: string }) {
  if (!message) return null
  const quotaRelated = message.includes('额度已用完') || message.includes('请升级')
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600">
      <span>{message}</span>
      {quotaRelated && (
        <Link to="/app/pricing" className="font-medium text-blue-600 hover:underline">
          前往套餐升级 →
        </Link>
      )}
    </div>
  )
}
