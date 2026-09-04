import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { forgotPassword, resetPassword } from '../api/client'
import AuthShell from '../components/AuthShell'

const INPUT_CLS =
  'w-full rounded-xl border border-black/15 bg-white/55 px-4 py-3 text-sm focus:border-[#245f8f] focus:outline-none focus:ring-1 focus:ring-[#245f8f]'

export default function ForgotPasswordPage() {
  const navigate = useNavigate()
  const [step, setStep] = useState<1 | 2>(1)
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [newPwd, setNewPwd] = useState('')
  const [confirmPwd, setConfirmPwd] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    setMessage('')
    try {
      const resp = await forgotPassword(email.trim())
      setMessage(resp.message)
      setStep(2)
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取验证码失败')
    } finally {
      setLoading(false)
    }
  }

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (newPwd.length < 8 || !/[A-Za-z]/.test(newPwd) || !/\d/.test(newPwd)) {
      setError('新密码需至少 8 位且同时包含字母和数字')
      return
    }
    if (newPwd !== confirmPwd) {
      setError('两次输入的新密码不一致')
      return
    }
    setLoading(true)
    try {
      await resetPassword(email.trim(), code.trim(), newPwd)
      navigate('/login', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : '重置失败')
      setLoading(false)
    }
  }

  return (
    <AuthShell
      title="找回密码"
      subtitle={
        <>
          想起密码了？
          <Link to="/login" className="font-medium text-[#245f8f] hover:underline">
            返回登录
          </Link>
        </>
      }
    >
      {step === 1 ? (
        <form onSubmit={handleSendCode} className="space-y-5">
          <div>
            <label htmlFor="forgot-email" className="mb-1.5 block text-sm font-medium text-gray-700">注册邮箱</label>
            <input
              id="forgot-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className={INPUT_CLS}
              required
              autoFocus
            />
          </div>
          {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-full bg-[#171b1f] py-3 text-sm font-semibold text-white transition hover:bg-black disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? '发送中…' : '发送验证码'}
          </button>
        </form>
      ) : (
        <form onSubmit={handleReset} className="space-y-5">
          {message && (
            <div className="rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
              {message} 请查看邮箱中的验证码。
            </div>
          )}
          <div>
            <label htmlFor="reset-code" className="mb-1.5 block text-sm font-medium text-gray-700">验证码</label>
            <input
              id="reset-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="6 位数字验证码"
              maxLength={6}
              className={INPUT_CLS}
              required
              autoFocus
            />
          </div>
          <div>
            <label htmlFor="reset-password" className="mb-1.5 block text-sm font-medium text-gray-700">新密码</label>
            <input
              id="reset-password"
              type="password"
              autoComplete="new-password"
              value={newPwd}
              onChange={(e) => setNewPwd(e.target.value)}
              placeholder="至少 8 位，含字母和数字"
              className={INPUT_CLS}
              required
            />
          </div>
          <div>
            <label htmlFor="reset-password-confirm" className="mb-1.5 block text-sm font-medium text-gray-700">确认新密码</label>
            <input
              id="reset-password-confirm"
              type="password"
              autoComplete="new-password"
              value={confirmPwd}
              onChange={(e) => setConfirmPwd(e.target.value)}
              placeholder="再次输入新密码"
              className={INPUT_CLS}
              required
            />
          </div>
          {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-full bg-[#171b1f] py-3 text-sm font-semibold text-white transition hover:bg-black disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? '提交中…' : '重置密码'}
          </button>
        </form>
      )}
    </AuthShell>
  )
}
