import { Search } from 'lucide-react'

export default function BrandMark({ className = 'h-9 w-9' }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`relative inline-flex shrink-0 items-center justify-center rounded-[28%] border border-slate-200/90 bg-[#fffefa] text-[#0b1422] shadow-[0_1px_2px_rgba(15,23,42,0.08)] ${className}`}
    >
      <Search className="h-[54%] w-[54%]" strokeWidth={2.25} />
      <span className="absolute right-[7%] top-[7%] h-[17%] w-[17%] rounded-full bg-[#ff7a00]" />
    </span>
  )
}
