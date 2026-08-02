import { type ClassValue, clsx } from 'clsx'

/** 合并 class 值（类似 cn() 但基于 clsx） */
export function cn(...inputs: ClassValue[]) {
  return clsx(inputs)
}

/** 标准 input 样式（默认边框色 gray-300） */
export const INPUT_CLS = cn(
  'w-full rounded-md border border-gray-300',
  'px-4 py-2.5 text-sm',
  'outline-none transition',
  'focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500',
)

/** 等宽字体 variant */
export const INPUT_CLS_MONO = cn(INPUT_CLS, 'font-mono')

/** 小尺寸 variant */
export const INPUT_CLS_SMALL = cn(INPUT_CLS, 'px-3 py-1.5 text-xs')

/** 浅边框 variant（用于嵌套在已设边框的容器内） */
export const INPUT_CLS_LIGHT = 'w-full rounded-md border border-gray-200 px-4 py-2.5 text-sm outline-none transition focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500'
