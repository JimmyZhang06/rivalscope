import { useCallback, useEffect, useState } from 'react'
import { Building2, Check, CheckCircle2, Ticket } from 'lucide-react'
import {
  createOrg,
  getOrgMe,
  joinOrg,
  leaveOrg,
  listOrgMembers,
  removeOrgMember,
  resetInviteCode,
  updateOrg,
  updateOrgMember,
} from '../api/client'
import type { OrgMe, OrgMember } from '../api/types'
import { useAuth } from '../auth/AuthContext'
import PlanBadge from './PlanBadge'

const ROLE_LABELS: Record<string, string> = { owner: '所有者', admin: '管理员', member: '成员' }
const ROLE_BADGE: Record<string, string> = {
  owner: 'bg-blue-100 text-blue-700',
  admin: 'bg-cyan-100 text-cyan-700',
  member: 'bg-gray-100 text-gray-600',
}

function MemberAvatar({ member }: { member: OrgMember }) {
  if (member.avatar.startsWith('data:image/')) {
    return <img src={member.avatar} alt="头像" className="h-9 w-9 shrink-0 rounded-full object-cover" />
  }
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-100 text-sm font-bold text-blue-700">
      {(member.nickname || member.email).slice(0, 1).toUpperCase()}
    </span>
  )
}

/** 企业管理面板（内嵌于个人中心「企业」Tab） */
export default function OrgPanel() {
  const { user } = useAuth()
  const [me, setMe] = useState<OrgMe | null>(null)
  const [members, setMembers] = useState<OrgMember[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  // 创建 / 加入表单
  const [createName, setCreateName] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // 企业信息编辑
  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const [copied, setCopied] = useState(false)

  // 成员月额度行内编辑
  const [editingLimitId, setEditingLimitId] = useState('')
  const [limitDraft, setLimitDraft] = useState('')

  const canManage = me?.org_role === 'owner' || me?.org_role === 'admin'

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const data = await getOrgMe()
      setMe(data)
      setMembers(data.org ? await listOrgMembers() : [])
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  const run = async (fn: () => Promise<unknown>, successMsg = '') => {
    setError('')
    setNotice('')
    setSubmitting(true)
    try {
      await fn()
      await reload()
      if (successMsg) setNotice(successMsg)
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败')
    } finally {
      setSubmitting(false)
    }
  }

  const handleCopy = async () => {
    if (!me?.org) return
    await navigator.clipboard.writeText(me.org.invite_code)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const saveLimit = (m: OrgMember) => {
    const raw = limitDraft.trim()
    // 留空或 -1 表示不限
    const limit = raw === '' || raw === '-1' ? -1 : Number(raw)
    if (!Number.isInteger(limit) || limit < -1) {
      setError('额度需为 -1（不限）或非负整数')
      return
    }
    run(() => updateOrgMember(m.id, { org_monthly_limit: limit }), '成员月额度已更新').then(() =>
      setEditingLimitId(''),
    )
  }

  if (loading && !me) {
    return <p className="mt-6 text-sm text-gray-400">加载中…</p>
  }

  return (
    <div className="mt-6 space-y-6">
      <p className="text-sm text-gray-500">企业成员共享调研任务、定时追踪与企业套餐配额</p>

      {notice && (
        <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          <CheckCircle2 className="h-4 w-4 shrink-0" /> {notice}
        </div>
      )}
      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>
      )}

      {!me?.org ? (
        /* 未加入企业：创建 / 邀请码加入 双卡 */
        <div className="grid gap-6 md:grid-cols-2">
          <div className="rounded-lg border border-gray-200 bg-white p-7 shadow-sm">
            <h3 className="flex items-center gap-2 text-lg font-semibold text-gray-900">
              <Building2 className="h-5 w-5 text-blue-600" /> 创建企业
            </h3>
            <p className="mt-1 text-sm text-gray-500">创建后您将成为企业所有者，可邀请同事加入</p>
            <input
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
              placeholder="企业名称，如：字节跳动市场部"
              maxLength={100}
              className="mt-5 w-full rounded-md border border-gray-200 px-4 py-2.5 text-sm outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
            <button
              onClick={() => run(() => createOrg(createName.trim()), '企业创建成功')}
              disabled={submitting || !createName.trim()}
              className="mt-4 w-full rounded-md bg-blue-600 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50"
            >
              创建企业
            </button>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-7 shadow-sm">
            <h3 className="flex items-center gap-2 text-lg font-semibold text-gray-900">
              <Ticket className="h-5 w-5 text-blue-600" /> 加入企业
            </h3>
            <p className="mt-1 text-sm text-gray-500">输入企业管理员提供的 8 位邀请码</p>
            <input
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
              placeholder="8 位邀请码"
              maxLength={8}
              className="mt-5 w-full rounded-md border border-gray-200 px-4 py-2.5 text-sm font-mono tracking-widest outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
            <button
              onClick={() => run(() => joinOrg(inviteCode.trim()), '已加入企业')}
              disabled={submitting || inviteCode.trim().length !== 8}
              className="mt-4 w-full rounded-md border border-blue-600 py-2.5 text-sm font-semibold text-blue-700 transition hover:bg-blue-50 disabled:opacity-50"
            >
              加入企业
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* 企业信息卡 */}
          <section className="rounded-lg border border-gray-200 bg-white p-7 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                {editingName ? (
                  <div className="flex items-center gap-2">
                    <input
                      value={nameDraft}
                      onChange={(e) => setNameDraft(e.target.value)}
                      maxLength={100}
                      className="rounded-md border border-gray-200 px-3 py-1.5 text-lg font-semibold outline-none focus:border-blue-500"
                    />
                    <button
                      onClick={() =>
                        run(() => updateOrg(nameDraft.trim()), '企业名称已更新').then(() => setEditingName(false))
                      }
                      disabled={submitting || !nameDraft.trim()}
                      className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                      保存
                    </button>
                    <button
                      onClick={() => setEditingName(false)}
                      className="rounded-md border border-gray-200 px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-50"
                    >
                      取消
                    </button>
                  </div>
                ) : (
                  <h3 className="flex items-center gap-2 text-xl font-bold text-gray-900">
                    <Building2 className="h-5 w-5 text-gray-400" /> {me.org.name}
                    {canManage && (
                      <button
                        onClick={() => {
                          setNameDraft(me.org!.name)
                          setEditingName(true)
                        }}
                        className="text-sm font-normal text-blue-700 hover:underline"
                      >
                        改名
                      </button>
                    )}
                  </h3>
                )}
                <div className="mt-2 flex items-center gap-2 text-sm text-gray-500">
                  <PlanBadge plan={me.org.plan} />
                  {me.org.plan_expires_at && (
                    <span>有效期至 {new Date(me.org.plan_expires_at).toLocaleDateString('zh-CN')}</span>
                  )}
                  <span>· {me.member_count} 名成员</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ROLE_BADGE[me.org_role] ?? ''}`}>
                    我是{ROLE_LABELS[me.org_role] ?? me.org_role}
                  </span>
                </div>
              </div>
              <button
                onClick={() => {
                  if (window.confirm(me.org_role === 'owner' ? '退出将解散企业（仅当无其他成员时），确认？' : '确认退出该企业？')) {
                    run(() => leaveOrg(), '已退出企业')
                  }
                }}
                disabled={submitting}
                className="rounded-md border border-red-200 px-4 py-2 text-sm font-medium text-red-600 transition hover:bg-red-50 disabled:opacity-50"
              >
                退出企业
              </button>
            </div>

            {/* 邀请码 */}
            <div className="mt-6 flex flex-wrap items-center gap-3 rounded-md bg-blue-50 px-5 py-4">
              <span className="text-sm text-gray-600">邀请码</span>
              <code className="rounded-md bg-white px-4 py-1.5 font-mono text-lg font-bold tracking-widest text-blue-700">
                {me.org.invite_code}
              </code>
              <button
                onClick={handleCopy}
                className="rounded-md border border-blue-200 px-3 py-1.5 text-sm font-medium text-blue-700 transition hover:bg-blue-100"
              >
                {copied ? <span className="inline-flex items-center gap-1">已复制 <Check className="h-3 w-3" /></span> : '复制'}
              </button>
              {canManage && (
                <button
                  onClick={() => run(() => resetInviteCode(), '邀请码已重置，旧邀请码即刻失效')}
                  disabled={submitting}
                  className="rounded-md border border-gray-200 px-3 py-1.5 text-sm text-gray-500 transition hover:bg-gray-50 disabled:opacity-50"
                >
                  重置邀请码
                </button>
              )}
              <span className="text-xs text-gray-400">分享给同事即可加入企业</span>
            </div>
          </section>

          {/* 成员列表 */}
          <section className="rounded-lg border border-gray-200 bg-white shadow-sm">
            <div className="border-b border-gray-100 px-7 py-4">
              <h3 className="font-semibold text-gray-900">成员（{members.length}）</h3>
            </div>
            <ul className="divide-y divide-gray-50">
              {members.map((m) => {
                const isSelf = m.id === user?.id
                const canEditThis = canManage && m.org_role !== 'owner' && !isSelf
                return (
                  <li key={m.id} className="flex flex-wrap items-center gap-4 px-7 py-4">
                    <MemberAvatar member={m} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-gray-900">
                        {m.nickname || m.email}
                        {isSelf && <span className="ml-1.5 text-xs text-gray-400">（我）</span>}
                      </p>
                      <p className="truncate text-xs text-gray-400">{m.email}</p>
                    </div>
                    {/* 本月用量 / 月额度 */}
                    <span
                      className={`text-xs ${
                        m.org_monthly_limit >= 0 && m.month_used >= m.org_monthly_limit
                          ? 'text-amber-600'
                          : 'text-gray-400'
                      }`}
                      title="本月发起调研次数 / 成员月额度"
                    >
                      本月 {m.month_used} / {m.org_monthly_limit < 0 ? '不限' : m.org_monthly_limit} 次
                    </span>
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${ROLE_BADGE[m.org_role] ?? ''}`}>
                      {ROLE_LABELS[m.org_role] ?? m.org_role}
                    </span>
                    {canEditThis && (
                      <>
                        {editingLimitId === m.id ? (
                          <span className="flex items-center gap-1.5">
                            <input
                              autoFocus
                              value={limitDraft}
                              onChange={(e) => setLimitDraft(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') saveLimit(m)
                                if (e.key === 'Escape') setEditingLimitId('')
                              }}
                              placeholder="不限"
                              className="w-16 rounded-md border border-blue-300 px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-blue-100"
                            />
                            <button
                              onClick={() => saveLimit(m)}
                              disabled={submitting}
                              className="rounded-md bg-blue-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                            >
                              保存
                            </button>
                            <button
                              onClick={() => setEditingLimitId('')}
                              className="rounded-md px-1.5 py-1.5 text-xs text-gray-400 hover:text-gray-600"
                            >
                              取消
                            </button>
                          </span>
                        ) : (
                          <button
                            onClick={() => {
                              setEditingLimitId(m.id)
                              setLimitDraft(m.org_monthly_limit < 0 ? '' : String(m.org_monthly_limit))
                            }}
                            className="rounded-md border border-gray-200 px-2.5 py-1.5 text-xs text-gray-600 transition hover:border-blue-300 hover:text-blue-700"
                            title="设置该成员每月可发起的调研次数，留空为不限"
                          >
                            设额度
                          </button>
                        )}
                        <select
                          value={m.org_role}
                          onChange={(e) =>
                            run(() => updateOrgMember(m.id, { org_role: e.target.value as 'admin' | 'member' }), '角色已更新')
                          }
                          disabled={submitting}
                          className="rounded-md border border-gray-200 px-2 py-1.5 text-xs text-gray-600 outline-none focus:border-blue-500"
                        >
                          <option value="admin">管理员</option>
                          <option value="member">成员</option>
                        </select>
                        <button
                          onClick={() => {
                            if (window.confirm(`确认将 ${m.nickname || m.email} 移出企业？`)) {
                              run(() => removeOrgMember(m.id), '已移出成员')
                            }
                          }}
                          disabled={submitting}
                          className="rounded-md border border-red-200 px-2.5 py-1.5 text-xs text-red-600 transition hover:bg-red-50 disabled:opacity-50"
                        >
                          移出
                        </button>
                      </>
                    )}
                  </li>
                )
              })}
            </ul>
          </section>
        </>
      )}
    </div>
  )
}
