import type { ReactNode } from 'react'

/** 数据洞察卡片统一容器：图标 + 标题 + 副标题头部 */
export default function ChartCard({
  icon,
  title,
  subtitle,
  children,
}: {
  icon: string
  title: string
  subtitle?: string
  children: ReactNode
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-base">{icon}</span>
        <div>
          <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
          {subtitle && <p className="text-xs text-gray-400">{subtitle}</p>}
        </div>
      </div>
      <div className="mt-3">{children}</div>
    </div>
  )
}
