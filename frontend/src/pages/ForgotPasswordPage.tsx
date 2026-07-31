import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { forgotPassword, resetPassword } from '../api/client'
import AuthShell from '../components/AuthShell'

const INPUT_CLS =
  'w-full rounded-md border border-gray-300 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500'

/** 忘记密码：两步式（获取演示验证码 → 重置密码） */
export default function ForgotPasswordPage() {
  const navigate = useNavigate()
  const [step, setStep] = useState<1 | 2>(1)
  const [email, setEmail] = useState('')
  const [demoCode, setDemoCode] = useState('')
  const [code, setCode] = useState('')
  const [newPwd, setNewPwd] = useState('')
  const [confirmPwd, setConfirmPwd] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const resp = await forgotPassword(email.trim())
      setDemoCode(resp.demo_code)
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
          <Link to="/login" className="font-medium text-blue-600 hover:underline">
            返回登录
          </Link>
        </>
      }
    >
      {step === 1 ? (
        <form onSubmit={handleSendCode} className="space-y-5">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">注册邮箱</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className={INPUT_CLS}
              required
              autoFocus
            />
          </div>
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-blue-600 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? '获取中…' : '获取验证码'}
          </button>
        </form>
      ) : (
        <form onSubmit={handleReset} className="space-y-5">
          {/* 演示模式：无邮件服务，验证码直接展示 */}
          <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
            演示模式：未接入邮件服务，你的验证码是{' '}
            <span className="font-mono text-base font-bold tracking-widest">{demoCode}</span>
            （10 分钟内有效）
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">验证码</label>
            <input
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
            <label className="mb-1.5 block text-sm font-medium text-gray-700">新密码</label>
            <input
              type="password"
              value={newPwd}
              onChange={(e) => setNewPwd(e.target.value)}
              placeholder="至少 8 位，含字母和数字"
              className={INPUT_CLS}
              required
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">确认新密码</label>
            <input
              type="password"
              value={confirmPwd}
              onChange={(e) => setConfirmPwd(e.target.value)}
              placeholder="再次输入新密码"
              className={INPUT_CLS}
              required
            />
          </div>
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-blue-600 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? '提交中…' : '重置密码'}
          </button>
        </form>
      )}
    </AuthShell>
  )
}
