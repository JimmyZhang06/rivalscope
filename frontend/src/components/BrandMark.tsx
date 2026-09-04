export default function BrandMark({ className = 'h-9 w-[42px]' }: { className?: string }) {
  return (
    <img
      aria-hidden="true"
      src="/rivalscope-logo.png"
      alt=""
      className={`inline-block shrink-0 rounded-lg object-contain ${className}`}
    />
  )
}
