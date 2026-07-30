import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import AuthShell from '../components/AuthShell'

export default function RegisterPage() {
  const { register } = useAuth()
  const navigate = useNavigate()

  const [nickname, setNickname] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!/^(?=.*[A-Za-z])(?=.*\d).{8,}$/.test(password)) {
      setError('密码至少 8 位，且需同时包含字母和数字')
      return
    }
    setLoading(true)
    setError('')
    try {
      await register(email.trim(), password, nickname.trim())
      navigate('/app', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : '注册失败')
      setLoading(false)
    }
  }

  return (
    <AuthShell
      title="创建账号"
      subtitle={
        <>
          已有账号？
          <Link to="/login" className="font-medium text-blue-600 hover:underline">
            直接登录
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-gray-700">昵称</label>
          <input
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            placeholder="如何称呼你？"
            className="w-full rounded-xl border border-gray-300 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            maxLength={50}
            required
            autoFocus
          />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-gray-700">邮箱</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="w-full rounded-xl border border-gray-300 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            required
          />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-gray-700">密码</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="至少 8 位，含字母和数字"
            className="w-full rounded-xl border border-gray-300 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            required
          />
        </div>
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-xl bg-blue-600 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? '注册中…' : '免费注册'}
        </button>
        <p className="text-center text-xs text-gray-400">注册即默认同意演示用途的服务条款</p>
      </form>
    </AuthShell>
  )
}
