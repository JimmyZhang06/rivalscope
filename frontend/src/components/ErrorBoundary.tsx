import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  /** 出错后重置按钮的文案，默认 "重试" */
  resetLabel?: string
  /** 自定义回退 UI */
  fallback?: (reset: () => void) => ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

/** 顶层错误边界，防止未捕获异常白屏 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error('Uncaught error:', error, info.componentStack)
  }

  reset = () => {
    this.setState({ hasError: false, error: null })
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback(this.reset)

      return (
        <div className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center px-6 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-red-50 text-red-500">
            <span className="text-2xl">⚠</span>
          </div>
          <h2 className="mt-4 text-lg font-semibold text-gray-900">页面出错了</h2>
          <p className="mt-2 text-sm text-gray-500">
            {this.state.error?.message ?? '发生了未知错误'}
          </p>
          <button
            onClick={this.reset}
            className="mt-5 rounded-md bg-blue-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-blue-700"
          >
            {this.props.resetLabel ?? '重试'}
          </button>
        </div>
      )
    }

    return this.props.children
  }
}
