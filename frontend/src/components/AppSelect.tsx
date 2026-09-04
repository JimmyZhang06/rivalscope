import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown } from 'lucide-react'

export interface AppSelectOption {
  value: string
  label: string
  disabled?: boolean
}

interface AppSelectProps {
  value: string
  options: AppSelectOption[]
  onValueChange: (value: string) => void
  placeholder?: string
  ariaLabel?: string
  disabled?: boolean
  title?: string
  size?: 'sm' | 'md'
  className?: string
}

interface MenuPosition extends CSSProperties {
  top: number
  left: number
  width: number
  maxHeight: number
}

export default function AppSelect({
  value,
  options,
  onValueChange,
  placeholder = '请选择',
  ariaLabel,
  disabled = false,
  title,
  size = 'md',
  className = '',
}: AppSelectProps) {
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const listboxId = useId()
  const selectedOption = useMemo(() => options.find((option) => option.value === value), [options, value])
  const selectedIndex = options.findIndex((option) => option.value === value)
  const compact = size === 'sm'

  const firstEnabled = () => options.findIndex((option) => !option.disabled)
  const lastEnabled = () => {
    for (let index = options.length - 1; index >= 0; index -= 1) {
      if (!options[index].disabled) return index
    }
    return -1
  }
  const nextEnabled = (from: number, direction: 1 | -1) => {
    if (!options.length) return -1
    let index = from
    for (let attempts = 0; attempts < options.length; attempts += 1) {
      index = (index + direction + options.length) % options.length
      if (!options[index].disabled) return index
    }
    return -1
  }

  const updateMenuPosition = () => {
    const trigger = triggerRef.current
    if (!trigger) return
    const rect = trigger.getBoundingClientRect()
    const estimatedHeight = Math.min(options.length * (compact ? 36 : 42) + 12, 280)
    const spaceBelow = window.innerHeight - rect.bottom - 12
    const spaceAbove = rect.top - 12
    const openAbove = spaceBelow < Math.min(estimatedHeight, 160) && spaceAbove > spaceBelow
    const maxHeight = Math.max(96, Math.min(280, openAbove ? spaceAbove - 6 : spaceBelow - 6))
    const width = Math.max(rect.width, compact ? 144 : 180)
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))
    const top = openAbove
      ? Math.max(8, rect.top - Math.min(estimatedHeight, maxHeight) - 6)
      : rect.bottom + 6
    setMenuPosition({ top, left, width, maxHeight })
  }

  useLayoutEffect(() => {
    if (!open) return
    updateMenuPosition()
  }, [open, options.length])

  useEffect(() => {
    if (!open) return
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false)
    }
    const handleViewportChange = () => updateMenuPosition()
    document.addEventListener('pointerdown', handlePointerDown, true)
    window.addEventListener('resize', handleViewportChange)
    window.addEventListener('scroll', handleViewportChange, true)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true)
      window.removeEventListener('resize', handleViewportChange)
      window.removeEventListener('scroll', handleViewportChange, true)
    }
  }, [open, options.length])

  useEffect(() => {
    if (!open || activeIndex < 0) return
    const frame = requestAnimationFrame(() => {
      document.getElementById(`${listboxId}-${activeIndex}`)?.scrollIntoView({ block: 'nearest' })
    })
    return () => cancelAnimationFrame(frame)
  }, [activeIndex, listboxId, open])

  const openMenu = () => {
    if (disabled || options.length === 0) return
    setActiveIndex(selectedIndex >= 0 && !options[selectedIndex]?.disabled ? selectedIndex : firstEnabled())
    setOpen(true)
  }

  const choose = (option: AppSelectOption) => {
    if (option.disabled) return
    onValueChange(option.value)
    setOpen(false)
    requestAnimationFrame(() => triggerRef.current?.focus())
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return
    if (event.key === 'Escape') {
      if (open) event.preventDefault()
      setOpen(false)
      return
    }
    if (event.key === 'Tab') {
      setOpen(false)
      return
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      if (!open) openMenu()
      else if (activeIndex >= 0) choose(options[activeIndex])
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open) {
        openMenu()
        return
      }
      setActiveIndex((current) => nextEnabled(current < 0 ? selectedIndex : current, event.key === 'ArrowDown' ? 1 : -1))
      return
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      if (!open) openMenu()
      setActiveIndex(event.key === 'Home' ? firstEnabled() : lastEnabled())
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-haspopup="listbox"
        aria-activedescendant={open && activeIndex >= 0 ? `${listboxId}-${activeIndex}` : undefined}
        disabled={disabled}
        title={title}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={handleKeyDown}
        className={`group inline-flex items-center justify-between gap-3 border border-black/[0.12] bg-[#fbfaf6] text-left text-[#171b1f] shadow-[0_1px_0_rgba(23,27,31,0.03)] outline-none transition hover:border-black/20 focus-visible:border-[#245f8f] focus-visible:ring-2 focus-visible:ring-[#245f8f]/20 disabled:cursor-not-allowed disabled:bg-black/[0.035] disabled:text-slate-400 ${
          compact ? 'min-h-8 rounded-lg px-2.5 py-1 text-xs' : 'min-h-11 rounded-xl px-3.5 py-2.5 text-sm'
        } ${open ? 'border-[#245f8f] ring-2 ring-[#245f8f]/15' : ''} ${className}`}
      >
        <span className={`min-w-0 flex-1 truncate ${!selectedOption || value === '' ? 'text-slate-400' : ''}`}>
          {selectedOption?.label ?? placeholder}
        </span>
        <ChevronDown className={`shrink-0 text-slate-400 transition-transform ${compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} ${open ? 'rotate-180 text-[#245f8f]' : 'group-hover:text-slate-600'}`} aria-hidden="true" />
      </button>

      {open && menuPosition && createPortal(
        <div
          ref={menuRef}
          id={listboxId}
          role="listbox"
          aria-label={ariaLabel}
          style={menuPosition}
          className="fixed z-[120] overflow-y-auto rounded-xl border border-black/[0.12] bg-[#fbfaf6]/[0.98] p-1.5 shadow-[0_18px_55px_rgba(17,26,40,0.2)] backdrop-blur-xl"
        >
          {options.map((option, index) => {
            const selected = option.value === value
            const active = index === activeIndex
            return (
              <button
                key={`${option.value}-${index}`}
                id={`${listboxId}-${index}`}
                type="button"
                role="option"
                aria-selected={selected}
                disabled={option.disabled}
                onMouseEnter={() => !option.disabled && setActiveIndex(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(option)}
                className={`flex w-full items-center justify-between gap-3 rounded-lg text-left transition ${
                  compact ? 'min-h-8 px-2.5 py-1 text-xs' : 'min-h-10 px-3 py-2 text-sm'
                } ${
                  selected
                    ? 'bg-[#e7edf0] font-medium text-[#17446a]'
                    : active
                      ? 'bg-[#f0eee7] text-[#171b1f]'
                      : 'text-slate-600 hover:bg-[#f0eee7] hover:text-[#171b1f]'
                } disabled:cursor-not-allowed disabled:opacity-40`}
              >
                <span className="truncate">{option.label}</span>
                {selected && <Check className={`${compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} shrink-0 text-[#245f8f]`} aria-hidden="true" />}
              </button>
            )
          })}
        </div>,
        document.body,
      )}
    </>
  )
}
