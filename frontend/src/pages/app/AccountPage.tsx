import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  AlertTriangle,
  BarChart3,
  Building2,
  Camera,
  CreditCard,
  History,
  KeyRound,
  Lock,
  Pencil,
  ReceiptText,
  User,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import {
  changePassword,
  deleteAccount,
  getOrgMe,
  getUsage,
  listLogins,
  listOrders,
  logoutAll,
  saveTokens,
  updateProfile,
} from '../../api/client'
import type { LoginLog, Order, OrgMe, UsageStats } from '../../api/types'
import { fmtDate, fmtDateTime } from '../../utils/time'
import { useAuth } from '../../auth/AuthContext'
import OrgPanel from '../../components/OrgPanel'
import PlanBadge from '../../components/PlanBadge'
import ConfirmDialog from '../../components/ConfirmDialog'
import { usePageTitle } from '../../hooks/usePageTitle'

const PLAN_NAMES: Record<string, string> = { free: '免费版', pro: '专业版', enterprise: '企业版' }

/** 预设头像色（与后端 AVATAR_KEYS 一致） */
const AVATAR_COLORS: Record<string, string> = {
  '': 'from-blue-500 to-blue-600',
  blue: 'from-blue-500 to-blue-600',
  cyan: 'from-cyan-500 to-cyan-600',
  emerald: 'from-emerald-500 to-emerald-600',
  amber: 'from-amber-500 to-amber-600',
  rose: 'from-rose-500 to-rose-600',
  slate: 'from-slate-500 to-slate-600',
  teal: 'from-teal-500 to-teal-600',
  sky: 'from-sky-400 to-sky-600',
}

const ACTION_LABELS: Record<LoginLog['action'], string> = {
  login: '登录',
  register: '注册',
  reset: '重置密码',
}

/** 上传的图片压缩为 128x128 JPEG data URL（约 5~15KB） */
function compressAvatar(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      const size = 128
      const canvas = document.createElement('canvas')
      canvas.width = size
      canvas.height = size
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new Error('当前浏览器不支持图片处理'))
        return
      }
      // 居中裁剪为正方形
      const side = Math.min(img.width, img.height)
      ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size)
      resolve(canvas.toDataURL('image/jpeg', 0.85))
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('图片读取失败，请换一张试试'))
    }
    img.src = url
  })
}

const INPUT_CLS =
  'w-full rounded-md border border-gray-200 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100'

/** 从 UA 提取简短设备名 */
function shortUA(ua: string): string {
  if (!ua) return '未知设备'
  if (/edg/i.test(ua)) return 'Edge'
  if (/chrome/i.test(ua)) return 'Chrome'
  if (/firefox/i.test(ua)) return 'Firefox'
  if (/safari/i.test(ua)) return 'Safari'
  if (/python|requests|curl/i.test(ua)) return 'API 调用'
  return ua.slice(0, 24)
}

type Tab = 'profile' | 'security' | 'workspace' | 'billing'

const TAB_KEYS: Tab[] = ['profile', 'security', 'workspace', 'billing']

/** 统一的区块标题：图标徽标 + 标题 + 说明 + 可选右侧操作，营造企业级设置面板的规整层次 */
function SectionHeader({
  icon: Icon,
  title,
  desc,
  action,
  tone = 'blue',
}: {
  icon: LucideIcon
  title: string
  desc?: string
  action?: ReactNode
  tone?: 'blue' | 'red'
}) {
  const isRed = tone === 'red'
  return (
    <div
      className={`flex items-start justify-between gap-3 border-b pb-3 ${
        isRed ? 'border-red-100' : 'border-gray-100'
      }`}
    >
      <div className="flex items-center gap-2.5">
        <span
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${
            isRed ? 'bg-red-50 text-red-600' : 'bg-blue-50 text-blue-700'
          }`}
        >
          <Icon className="h-4 w-4" />
        </span>
        <div>
          <h2 className={`text-sm font-semibold ${isRed ? 'text-red-700' : 'text-gray-900'}`}>{title}</h2>
          {desc && <p className={`mt-0.5 text-xs ${isRed ? 'text-red-500' : 'text-gray-400'}`}>{desc}</p>}
        </div>
      </div>
      {action}
    </div>
  )
}

export default function AccountPage() {
  usePageTitle('设置')
  const { user } = useAuth()
  // Tab 由 URL 参数驱动（/app/account?tab=org），便于外部直达与刷新保持
  const [searchParams, setSearchParams] = useSearchParams()
  const rawParam = searchParams.get('tab')
  const legacyTabs: Record<string, Tab> = { overview: 'profile', org: 'workspace', orders: 'billing' }
  const normalizedParam = rawParam ? (legacyTabs[rawParam] ?? rawParam) : null
  const tab: Tab = normalizedParam && TAB_KEYS.includes(normalizedParam as Tab) ? normalizedParam as Tab : 'profile'
  const setTab = (t: Tab) => setSearchParams(t === 'profile' ? {} : { tab: t }, { replace: true })

  if (!user) return null

  const tabs: { key: Tab; label: string; icon: LucideIcon }[] = [
    { key: 'profile', label: '个人资料', icon: User },
    { key: 'security', label: '登录与安全', icon: Lock },
    { key: 'workspace', label: '工作区与成员', icon: Building2 },
    { key: 'billing', label: '套餐与账单', icon: ReceiptText },
  ]

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
      <h1 className="text-2xl font-bold tracking-tight text-gray-900">账户设置</h1>
      <p className="mt-1 text-sm text-gray-500">管理个人账户、工作区成员、使用配额与账单</p>

      <div role="tablist" aria-label="设置分类" className="mt-6 grid grid-cols-2 gap-1 rounded-lg bg-gray-100 p-1 sm:flex sm:overflow-x-auto">
        {tabs.map((t) => (
          <button
            key={t.key}
            id={`settings-tab-${t.key}`}
            role="tab"
            aria-selected={tab === t.key}
            aria-controls={`settings-panel-${t.key}`}
            onClick={() => setTab(t.key)}
            onKeyDown={(event) => {
              const currentIndex = tabs.findIndex((item) => item.key === t.key)
              const nextIndex = event.key === 'ArrowRight'
                ? (currentIndex + 1) % tabs.length
                : event.key === 'ArrowLeft'
                  ? (currentIndex - 1 + tabs.length) % tabs.length
                  : event.key === 'Home'
                    ? 0
                    : event.key === 'End'
                      ? tabs.length - 1
                      : -1
              if (nextIndex < 0) return
              event.preventDefault()
              const nextTab = tabs[nextIndex]
              setTab(nextTab.key)
              requestAnimationFrame(() => document.getElementById(`settings-tab-${nextTab.key}`)?.focus())
            }}
            className={`flex min-h-10 items-center justify-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition sm:shrink-0 sm:px-4 ${
              tab === t.key ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500 hover:text-gray-800'
            }`}
          >
            <t.icon className="h-3.5 w-3.5" />
            {t.label}
          </button>
        ))}
      </div>

      <div id={`settings-panel-${tab}`} role="tabpanel" aria-labelledby={`settings-tab-${tab}`}>
        {tab === 'profile' && <OverviewTab />}
        {tab === 'security' && <SecurityTab />}
        {tab === 'workspace' && <OrgPanel />}
        {tab === 'billing' && <BillingTab />}
      </div>
    </div>
  )
}

/** 个人资料：头像与昵称编辑 */
function OverviewTab() {
  const { user, updateUser } = useAuth()
  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  if (!user) return null

  const isCustomAvatar = user.avatar.startsWith('data:image/')

  const handleUpload = async (file: File | undefined) => {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setError('请选择图片文件')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      setError('图片不能超过 5MB')
      return
    }
    setUploading(true)
    setError('')
    try {
      const dataUrl = await compressAvatar(file)
      updateUser(await updateProfile({ avatar: dataUrl }))
    } catch (e) {
      setError(e instanceof Error ? e.message : '上传失败')
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const saveName = async () => {
    const nickname = nameDraft.trim()
    if (!nickname || nickname === user.nickname) {
      setEditingName(false)
      return
    }
    setSaving(true)
    setError('')
    try {
      updateUser(await updateProfile({ nickname }))
      setEditingName(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mt-6 space-y-6">
      {error && <p className="rounded-md bg-red-50 px-4 py-2 text-sm text-red-600">{error}</p>}

      {/* 资料卡：头像 + 昵称行内编辑 */}
      <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
        <SectionHeader icon={User} title="账号资料" desc="头像、昵称与基础信息" />
        <div className="mt-5 flex flex-wrap items-start gap-5">
          {isCustomAvatar ? (
            <img
              src={user.avatar}
              alt="头像"
              className="h-16 w-16 rounded-full object-cover shadow-sm ring-1 ring-gray-200"
            />
          ) : (
            <span
              className={`flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br text-2xl font-bold text-white shadow-sm ${
                AVATAR_COLORS[user.avatar] ?? AVATAR_COLORS['']
              }`}
            >
              {(user.nickname || user.email).slice(0, 1).toUpperCase()}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              {editingName ? (
                <>
                  <input
                    autoFocus
                    aria-label="昵称"
                    value={nameDraft}
                    maxLength={50}
                    onChange={(e) => setNameDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') saveName()
                      if (e.key === 'Escape') setEditingName(false)
                    }}
                    className="w-44 rounded-md border border-blue-300 px-2.5 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-100"
                  />
                  <button
                    onClick={saveName}
                    disabled={saving}
                    className="rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    {saving ? '保存中…' : '保存'}
                  </button>
                  <button
                    onClick={() => setEditingName(false)}
                    className="rounded-md px-2 py-1 text-xs text-gray-400 hover:text-gray-600"
                  >
                    取消
                  </button>
                </>
              ) : (
                <>
                  <p className="font-semibold text-gray-900">{user.nickname || '未设置昵称'}</p>
                  <button
                    onClick={() => {
                      setNameDraft(user.nickname)
                      setEditingName(true)
                    }}
                    className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"
                  >
                    <Pencil className="h-3 w-3" /> 编辑
                  </button>
                  {user.role === 'admin' && (
                    <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-700">
                      管理员
                    </span>
                  )}
                </>
              )}
            </div>
            <p className="mt-0.5 text-sm text-gray-500">{user.email}</p>
            <p className="mt-0.5 text-xs text-gray-400">
              注册于 {fmtDate(user.created_at)}
            </p>
            {/* 头像：上传自定义图片 */}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                aria-label="选择头像图片"
                className="hidden"
                onChange={(e) => handleUpload(e.target.files?.[0])}
              />
              <button
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-3 py-1 text-xs font-medium text-gray-600 transition hover:border-blue-300 hover:text-blue-600 disabled:opacity-50"
              >
                <Camera className="h-3 w-3" /> {uploading ? '上传中…' : '上传头像'}
              </button>
            </div>
          </div>
        </div>
      </section>

    </div>
  )
}

/** 安全：修改密码 + 登录历史 + 退出所有设备 + 注销账号 */
function SecurityTab() {
  const { user, updateUser, logout } = useAuth()
  const navigate = useNavigate()
  const [logs, setLogs] = useState<LoginLog[]>([])
  const [logsLoading, setLogsLoading] = useState(true)
  const [logsError, setLogsError] = useState('')
  const [orgMe, setOrgMe] = useState<OrgMe | null>(null)
  const [oldPwd, setOldPwd] = useState('')
  const [newPwd, setNewPwd] = useState('')
  const [confirmPwd, setConfirmPwd] = useState('')
  const [pwdMsg, setPwdMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [pwdSaving, setPwdSaving] = useState(false)
  const [logoutAllMsg, setLogoutAllMsg] = useState('')
  const [showLogoutAll, setShowLogoutAll] = useState(false)
  const [logoutAllSaving, setLogoutAllSaving] = useState(false)
  const [showDelete, setShowDelete] = useState(false)
  const [deletePwd, setDeletePwd] = useState('')
  const [deleteErr, setDeleteErr] = useState('')
  const [deleting, setDeleting] = useState(false)

  const loadLogs = useCallback(() => {
    setLogsLoading(true)
    setLogsError('')
    listLogins()
      .then(setLogs)
      .catch((err) => setLogsError(err instanceof Error ? err.message : '登录记录加载失败'))
      .finally(() => setLogsLoading(false))
  }, [])

  useEffect(loadLogs, [loadLogs])
  useEffect(() => {
    getOrgMe().then(setOrgMe).catch(() => setOrgMe(null))
  }, [])

  const submitPassword = async (e: FormEvent) => {
    e.preventDefault()
    setPwdMsg(null)
    if (newPwd.length < 8 || !/[A-Za-z]/.test(newPwd) || !/\d/.test(newPwd)) {
      setPwdMsg({ ok: false, text: '新密码需至少 8 位且同时包含字母和数字' })
      return
    }
    if (newPwd !== confirmPwd) {
      setPwdMsg({ ok: false, text: '两次输入的新密码不一致' })
      return
    }
    setPwdSaving(true)
    try {
      const resp = await changePassword(oldPwd, newPwd)
      await saveTokens(resp)
      updateUser(resp.user)
      setOldPwd('')
      setNewPwd('')
      setConfirmPwd('')
      setPwdMsg({ ok: true, text: '密码已修改，其他设备的登录已全部失效' })
    } catch (err) {
      setPwdMsg({ ok: false, text: err instanceof Error ? err.message : '修改失败' })
    } finally {
      setPwdSaving(false)
    }
  }

  const handleLogoutAll = async () => {
    setLogoutAllSaving(true)
    try {
      const resp = await logoutAll()
      await saveTokens(resp)
      updateUser(resp.user)
      setLogoutAllMsg('已退出所有其他设备，当前设备保持登录')
      setShowLogoutAll(false)
    } catch (err) {
      setLogoutAllMsg(err instanceof Error ? err.message : '操作失败')
    } finally {
      setLogoutAllSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!deletePwd) {
      setDeleteErr('请输入密码确认')
      return
    }
    setDeleting(true)
    setDeleteErr('')
    try {
      await deleteAccount(deletePwd)
      logout()
      navigate('/', { replace: true })
    } catch (err) {
      setDeleteErr(err instanceof Error ? err.message : '注销失败')
      setDeleting(false)
    }
  }

  return (
    <div className="mt-6 space-y-6">
      {/* 修改密码 */}
      <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
        <SectionHeader
          icon={KeyRound}
          title="修改密码"
          desc="修改后其他设备的登录将全部失效，当前设备无需重新登录"
        />
        <form onSubmit={submitPassword} className="mt-5 max-w-sm space-y-3">
          <label htmlFor="current-password" className="block text-sm font-medium text-gray-700">当前密码</label>
          <input
            id="current-password"
            type="password"
            autoComplete="current-password"
            value={oldPwd}
            onChange={(e) => setOldPwd(e.target.value)}
            required
            className={INPUT_CLS}
          />
          <label htmlFor="new-password" className="block text-sm font-medium text-gray-700">新密码</label>
          <input
            id="new-password"
            type="password"
            autoComplete="new-password"
            placeholder="新密码（至少 8 位，含字母和数字）"
            value={newPwd}
            onChange={(e) => setNewPwd(e.target.value)}
            required
            className={INPUT_CLS}
          />
          <label htmlFor="confirm-password" className="block text-sm font-medium text-gray-700">确认新密码</label>
          <input
            id="confirm-password"
            type="password"
            autoComplete="new-password"
            placeholder="确认新密码"
            value={confirmPwd}
            onChange={(e) => setConfirmPwd(e.target.value)}
            required
            className={INPUT_CLS}
          />
          {pwdMsg && (
            <p className={`text-sm ${pwdMsg.ok ? 'text-emerald-600' : 'text-red-600'}`}>{pwdMsg.text}</p>
          )}
          <button
            type="submit"
            disabled={pwdSaving}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-50"
          >
            {pwdSaving ? '提交中…' : '确认修改'}
          </button>
        </form>
      </section>

      {/* 登录历史 */}
      <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
        <SectionHeader
          icon={History}
          title="登录历史"
          desc="最近的登录、注册与重置密码记录"
          action={
            <button
              onClick={() => setShowLogoutAll(true)}
              className="rounded-md border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 transition hover:border-amber-300 hover:text-amber-600"
            >
              退出其他设备
            </button>
          }
        />
        {logoutAllMsg && <p className="mt-2 text-xs text-emerald-600">{logoutAllMsg}</p>}
        {logsLoading ? (
          <p className="mt-4 text-sm text-gray-500" role="status">正在加载登录记录…</p>
        ) : logsError ? (
          <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            <p>{logsError}</p>
            <button onClick={loadLogs} className="mt-2 font-medium text-red-700 underline underline-offset-2">重新加载</button>
          </div>
        ) : logs.length === 0 ? (
          <p className="mt-4 text-sm text-gray-400">暂无记录</p>
        ) : (
          <ul className="mt-4 divide-y divide-gray-50">
            {logs.map((log) => (
              <li key={log.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5 text-sm">
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    log.action === 'reset' ? 'bg-amber-100 text-amber-700' : 'bg-blue-50 text-blue-700'
                  }`}
                >
                  {ACTION_LABELS[log.action] ?? log.action}
                </span>
                <span className="text-gray-900">{fmtDateTime(log.created_at)}</span>
                <span className="text-gray-400">{log.ip || '—'}</span>
                <span className="text-xs text-gray-400">{shortUA(log.user_agent)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 危险区：注销账号（管理员不可注销） */}
      {user?.role !== 'admin' && (
        <section className="rounded-lg border border-red-200 bg-red-50/50 p-5 sm:p-6">
          <SectionHeader
            icon={AlertTriangle}
            tone="red"
            title="危险操作"
            desc="注销将删除个人账户及其个人调研任务、订单和登录记录，且不可恢复"
          />
          {orgMe?.org ? (
            <p className="mt-3 text-sm text-red-700">请先在“工作区与成员”中退出当前工作区，再注销个人账户。</p>
          ) : (
            <button
              onClick={() => {
                setShowDelete(true)
                setDeletePwd('')
                setDeleteErr('')
              }}
              className="mt-3 rounded-md border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-600 transition hover:bg-red-600 hover:text-white"
            >
              注销账号
            </button>
          )}
        </section>
      )}

      <ConfirmDialog
        open={showLogoutAll}
        title="退出其他设备？"
        message="其他设备上的登录会立即失效，当前设备将保持登录。"
        confirmText="确认退出"
        loading={logoutAllSaving}
        onCancel={() => setShowLogoutAll(false)}
        onConfirm={handleLogoutAll}
      />

      <ConfirmDialog
        open={showDelete}
        title="永久注销账号？"
        message={
          <>
            <p>个人账户、个人调研任务、订单和登录记录将被永久删除。请输入当前密码确认。</p>
            <label htmlFor="delete-account-password" className="mt-4 block font-medium text-gray-700">当前密码</label>
            <input
              id="delete-account-password"
              type="password"
              autoComplete="current-password"
              placeholder="输入密码确认"
              value={deletePwd}
              onChange={(e) => setDeletePwd(e.target.value)}
              className={`mt-4 ${INPUT_CLS}`}
            />
            {deleteErr && <p className="mt-2 text-sm text-red-600">{deleteErr}</p>}
          </>
        }
        confirmText="永久注销"
        danger
        loading={deleting}
        onCancel={() => setShowDelete(false)}
        onConfirm={handleDelete}
      />
    </div>
  )
}

/** 套餐、用量与订单 */
function BillingTab() {
  const { user } = useAuth()
  const [usage, setUsage] = useState<UsageStats | null>(null)
  const [orders, setOrders] = useState<Order[]>([])
  const [orgMe, setOrgMe] = useState<OrgMe | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const loadBilling = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [usageData, orderData, orgData] = await Promise.all([getUsage(), listOrders(), getOrgMe()])
      setUsage(usageData)
      setOrders(orderData)
      setOrgMe(orgData)
    } catch (err) {
      setError(err instanceof Error ? err.message : '套餐与账单加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadBilling() }, [loadBilling])

  if (!user) return null

  if (loading) {
    return <p className="mt-6 rounded-lg border border-gray-200 bg-white p-6 text-sm text-gray-500" role="status">正在加载套餐与账单…</p>
  }

  if (error || !usage) {
    return (
      <div className="mt-6 rounded-lg border border-red-200 bg-red-50 p-5 text-sm text-red-700">
        <p>{error || '套餐与账单加载失败'}</p>
        <button onClick={loadBilling} className="mt-2 font-medium underline underline-offset-2">重新加载</button>
      </div>
    )
  }

  const quota = usage.quota
  const unlimited = quota.limit < 0
  const ratio = !unlimited && quota.limit > 0 ? Math.min(quota.used / quota.limit, 1) : 0
  const nearLimit = ratio >= 0.8
  const maxCount = Math.max(...usage.months.map((month) => month.count), 1)
  const effectivePlan = quota.plan
  const canManageBilling = !orgMe?.org || orgMe.org_role === 'owner' || orgMe.org_role === 'admin'
  const expiresAt = orgMe?.org ? orgMe.org.plan_expires_at : user.plan_expires_at

  return (
    <div className="mt-6 space-y-6">
      <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
        <SectionHeader
          icon={CreditCard}
          title="当前有效套餐"
          desc={orgMe?.org ? `由工作区“${orgMe.org.name}”提供` : '个人账户套餐'}
          action={canManageBilling ? (
            <Link to="/app/pricing" className="inline-flex min-h-9 items-center rounded-md border border-blue-200 bg-blue-50 px-3 text-xs font-medium text-blue-700 hover:bg-blue-100">
              {effectivePlan === 'free' ? '升级套餐' : '管理 / 续费'}
            </Link>
          ) : undefined}
        />
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <PlanBadge plan={effectivePlan} />
          <span className="text-sm text-gray-600">{expiresAt ? `有效期至 ${fmtDateTime(expiresAt)}` : '长期有效'}</span>
          {!canManageBilling && <span className="text-xs text-gray-500">如需升级，请联系工作区管理员</span>}
        </div>
      </section>

      <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
        <SectionHeader icon={BarChart3} title="配额与用量" desc="本月调研配额与近半年趋势" />
        <div className="mt-4 grid gap-6 sm:grid-cols-2">
          <div>
            <div className="flex items-baseline justify-between">
              <p className="text-sm text-gray-600">本月调研次数</p>
              <p className="text-sm font-semibold tabular-nums text-gray-900">{quota.used}<span className="font-normal text-gray-500"> / {unlimited ? '不限' : quota.limit}</span></p>
            </div>
            <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-gray-100" role="progressbar" aria-label="本月配额使用比例" aria-valuemin={0} aria-valuemax={unlimited ? undefined : quota.limit} aria-valuenow={quota.used}>
              <div className={`h-full rounded-full ${unlimited ? 'bg-emerald-500' : nearLimit ? 'bg-amber-500' : 'bg-blue-500'}`} style={{ width: unlimited ? '100%' : `${Math.round(ratio * 100)}%` }} />
            </div>
            <p className="mt-2 text-xs text-gray-500">{unlimited ? '当前套餐不限次数' : nearLimit ? '本月额度即将用完' : `单次调研最多 ${quota.max_queries} 组检索`}</p>
            {quota.member_limit >= 0 && <p className="mt-1 text-xs text-blue-600">个人成员额度：{quota.member_used} / {quota.member_limit} 次</p>}
          </div>
          <div>
            <p className="text-sm text-gray-600">近 {usage.months.length} 个月调研次数</p>
            <div className="mt-2 flex h-24 items-end gap-2" aria-label="近半年用量柱状图">
              {usage.months.map((month) => (
                <div key={month.month} className="flex flex-1 flex-col items-center gap-1">
                  <span className="text-[11px] text-gray-600">{month.count || 0}</span>
                  <div className={`w-full rounded-t ${month.count > 0 ? 'bg-blue-400' : 'bg-gray-100'}`} style={{ height: `${Math.max((month.count / maxCount) * 56, 4)}px` }} />
                  <span className="text-[11px] text-gray-500">{month.month.slice(5)}月</span>
                </div>
              ))}
            </div>
          </div>
          {usage.members && usage.members.length > 0 && (
            <div className="rounded-md border border-gray-100 bg-gray-50 p-3 sm:col-span-2">
              <p className="mb-2 text-xs font-medium text-gray-600">本月成员用量</p>
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {usage.members.map((member) => <span key={member.user_id} className="text-xs text-gray-700">{member.nickname}：<strong>{member.count}</strong> 次</span>)}
              </div>
            </div>
          )}
        </div>
      </section>

      <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
        <SectionHeader icon={ReceiptText} title="订单记录" desc="套餐购买、续费及订单状态" />
        {orders.length === 0 ? (
          <p className="mt-4 rounded-md border border-dashed border-gray-200 py-8 text-center text-sm text-gray-500">暂无订单</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[620px] text-left text-sm">
              <thead><tr className="border-b border-gray-200 bg-gray-50 text-xs text-gray-600"><th className="px-3 py-2 font-medium">订单号</th><th className="px-3 py-2 font-medium">套餐</th><th className="px-3 py-2 font-medium">金额</th><th className="px-3 py-2 font-medium">状态</th><th className="px-3 py-2 font-medium">支付时间</th></tr></thead>
              <tbody>{orders.map((order) => <tr key={order.id} className="border-b border-gray-100 last:border-0"><td className="px-3 py-3 font-mono text-xs text-gray-600">{order.id.slice(0, 8)}…</td><td className="px-3 py-3 text-gray-900">{PLAN_NAMES[order.plan] ?? order.plan}</td><td className="px-3 py-3 font-medium tabular-nums text-gray-900">¥{order.amount}</td><td className="px-3 py-3"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${order.status === 'paid' ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-600'}`}>{order.status === 'paid' ? '已支付' : order.status}</span></td><td className="px-3 py-3 text-gray-600">{order.paid_at ? fmtDateTime(order.paid_at) : '—'}</td></tr>)}</tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
