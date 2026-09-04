import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import AuthShell from '../components/AuthShell'
import { DEMO_ACCESS_KEY } from '../api/demo'

export default function LoginPage() {
  const { enterDemo, login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from ?? '/app'

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [demoKey, setDemoKey] = useState('')
  const [demoLoading, setDemoLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      await login(email.trim(), password)
      navigate(from, { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败')
      setLoading(false)
    }
  }

  const handleDemoSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setDemoLoading(true)
    setError('')
    try {
      await enterDemo(demoKey)
      navigate(from, { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : '无法进入演示模式')
      setDemoLoading(false)
    }
  }

  return (
    <AuthShell
      title="欢迎回来"
      subtitle={
        <>
          还没有账号？
          <Link to="/register" className="font-medium text-[#245f8f] hover:underline">
            免费注册
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label htmlFor="login-email" className="mb-1.5 block text-sm font-medium text-gray-700">邮箱</label>
          <input
            id="login-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="w-full rounded-xl border border-black/15 bg-white/55 px-4 py-3 text-sm focus:border-[#245f8f] focus:outline-none focus:ring-1 focus:ring-[#245f8f]"
            required
            autoFocus
          />
        </div>
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label htmlFor="login-password" className="block text-sm font-medium text-gray-700">密码</label>
            <Link to="/forgot-password" className="text-xs text-[#245f8f] hover:underline">
              忘记密码？
            </Link>
          </div>
          <input
            id="login-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="请输入密码"
            className="w-full rounded-xl border border-black/15 bg-white/55 px-4 py-3 text-sm focus:border-[#245f8f] focus:outline-none focus:ring-1 focus:ring-[#245f8f]"
            required
          />
        </div>
        {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-full bg-[#171b1f] py-3 text-sm font-semibold text-white transition hover:bg-black disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? '登录中…' : '登录'}
        </button>
      </form>
      <div className="my-6 flex items-center gap-3" aria-hidden="true">
        <span className="h-px flex-1 bg-gray-200" />
        <span className="text-xs font-medium text-gray-400">或使用演示访问</span>
        <span className="h-px flex-1 bg-gray-200" />
      </div>
      <form onSubmit={handleDemoSubmit} className="rounded-2xl border border-[#245f8f]/15 bg-[#e7edf0] p-4">
        <label htmlFor="demo-access-key" className="block text-sm font-semibold text-slate-900">演示访问密钥</label>
        <p className="mt-1 text-xs leading-5 text-slate-500">无需连接后端即可浏览示例工作台；演示操作不会保存。</p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <input
            id="demo-access-key"
            type="text"
            autoComplete="off"
            value={demoKey}
            onChange={(e) => setDemoKey(e.target.value)}
            placeholder={DEMO_ACCESS_KEY}
            className="min-w-0 flex-1 rounded-xl border border-[#245f8f]/20 bg-[#fbfaf6] px-3 py-2.5 text-sm focus:border-[#245f8f] focus:outline-none focus:ring-1 focus:ring-[#245f8f]"
            required
          />
          <button
            type="submit"
            disabled={demoLoading}
            className="rounded-full bg-[#245f8f] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#17446a] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {demoLoading ? '进入中…' : '进入演示'}
          </button>
        </div>
      </form>
    </AuthShell>
  )
}
