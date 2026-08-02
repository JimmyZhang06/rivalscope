/** 通用骨架屏组件，替换纯文字"加载中…" */

export function CardSkeleton() {
  return (
    <div className="animate-pulse rounded-lg border border-gray-200 bg-gray-50 p-5">
      <div className="flex items-start gap-3">
        <div className="flex-1 space-y-3">
          <div className="h-4 w-32 rounded bg-gray-200" />
          <div className="h-3 w-48 rounded bg-gray-100" />
          <div className="h-2 w-full rounded bg-gray-100" />
        </div>
      </div>
    </div>
  )
}

export function ListSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="animate-pulse space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-lg border border-gray-200 bg-gray-50 p-4">
          <div className="h-4 w-40 rounded bg-gray-200" />
          <div className="mt-2 h-3 w-60 rounded bg-gray-100" />
        </div>
      ))}
    </div>
  )
}
