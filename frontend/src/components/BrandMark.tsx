export default function BrandMark({ className = 'h-9 w-9' }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`relative inline-block shrink-0 overflow-hidden rounded-[28%] bg-[#111a28] ${className}`}
    >
      <img
        src="/rivalscope-logo.png"
        alt=""
        className="absolute inset-0 h-full w-full scale-[1.22] object-cover object-center"
      />
    </span>
  )
}
