import { useCallback, useEffect, useState } from 'react'
import { Plus, Pencil, Trash2, Lock, Unlock, Layers } from 'lucide-react'
import {
  createProfileTemplate,
  deleteProfileTemplate,
  freezeProfileTemplate,
  listProfileTemplates,
  updateProfileTemplate,
} from '../../api/client'
import type { ProfileTemplate } from '../../api/types'
import ConfirmDialog from '../../components/ConfirmDialog'
import { usePageTitle } from '../../hooks/usePageTitle'

export default function ProfileTemplatesPage() {
  usePageTitle('画像模板')
  const [items, setItems] = useState<ProfileTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<ProfileTemplate | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [name, setName] = useState('')
  const [dimsJson, setDimsJson] = useState('')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [deleteId, setDeleteId] = useState('')

  const reload = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setItems(await listProfileTemplates())
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  const resetForm = () => {
    setName('')
    setDimsJson('')
    setEditing(null)
    setShowForm(false)
  }

  const defaultDims = () => JSON.stringify([
    { key: "product_overview", label: "产品概况", fields: [{ key: "name", label: "名称", type: "text" }, { key: "price", label: "价格区间", type: "text" }] },
    { key: "core_features", label: "核心功能", fields: [{ key: "features", label: "功能列表", type: "text" }] },
    { key: "target_market", label: "目标市场", fields: [{ key: "market", label: "市场描述", type: "text" }] },
    { key: "strengths", label: "优势", fields: [{ key: "strengths", label: "优势描述", type: "text" }] },
    { key: "weaknesses", label: "劣势", fields: [{ key: "weaknesses", label: "劣势描述", type: "text" }] },
  ], null, 2)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      const dims = JSON.parse(dimsJson)
      if (!Array.isArray(dims)) throw new Error("dimensions 需为 JSON 数组")
      if (editing) {
        await updateProfileTemplate(editing.id, { name: name.trim(), dimensions: dims, org_id: editing.org_id })
        setNotice('模板已更新')
      } else {
        await createProfileTemplate({ name: name.trim(), dimensions: dims, org_id: '' })
        setNotice('模板已创建')
      }
      resetForm()
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSubmitting(false)
    }
  }

  const handleEdit = (t: ProfileTemplate) => {
    setEditing(t)
    setName(t.name)
    setDimsJson(JSON.stringify(t.dimensions, null, 2))
    setShowForm(true)
  }

  const handleFreeze = async (t: ProfileTemplate) => {
    try {
      await freezeProfileTemplate(t.id)
      setNotice('模板已冻结')
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败')
    }
  }

  const handleDelete = async (id: string) => {
    setDeleteId(id)
    setConfirmOpen(true)
  }

  const doDelete = async () => {
    if (!deleteId) return
    setSubmitting(true)
    try {
      await deleteProfileTemplate(deleteId)
      setNotice('模板已删除')
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败')
    } finally {
      setSubmitting(false)
      setConfirmOpen(false)
      setDeleteId('')
    }
  }

  const inputCls = 'w-full rounded-md border border-gray-200 px-4 py-2.5 text-sm outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500 font-mono'

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">画像模板</h1>
          <p className="mt-1 text-sm text-gray-500">管理竞品画像的维度模板，冻结后不可修改</p>
        </div>
        <button
          onClick={() => { setDimsJson(defaultDims()); resetForm(); setShowForm(true) }}
          className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700"
        >
          <Plus className="h-4 w-4" /> 新建模板
        </button>
      </div>

      {notice && <p className="mt-4 rounded-md bg-emerald-50 px-4 py-2 text-sm text-emerald-700">{notice}</p>}
      {error && <p className="mt-4 rounded-md bg-red-50 px-4 py-2 text-sm text-red-600">{error}</p>}

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={resetForm}>
          <div className="w-full max-w-2xl rounded-lg bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-gray-900">{editing ? '编辑模板' : '新建模板'}</h3>
            <form onSubmit={handleSubmit} className="mt-4 space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-500">模板名称 *</label>
                <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={200} className={inputCls} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500">维度定义（JSON 数组）*</label>
                <textarea value={dimsJson} onChange={(e) => setDimsJson(e.target.value)} rows={12} className={inputCls} />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={resetForm} className="rounded-md px-4 py-2 text-sm text-gray-500 hover:bg-gray-50">取消</button>
                <button type="submit" disabled={submitting || !name.trim()} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                  {submitting ? '保存中…' : '保存'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {loading ? (
        <p className="mt-8 text-center text-sm text-gray-400">加载中…</p>
      ) : items.length === 0 ? (
        <div className="mt-12 rounded-lg border border-dashed border-gray-300 py-12 text-center">
          <Layers className="mx-auto h-10 w-10 text-gray-300" />
          <p className="mt-3 text-sm text-gray-400">还没有模板，点击上方按钮创建</p>
        </div>
      ) : (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((t) => (
            <div key={t.id} className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-semibold text-gray-900">{t.name}</h3>
                  <p className="mt-1 text-xs text-gray-400">v{t.version} · {t.dimensions.length} 个维度</p>
                </div>
                {t.frozen_at ? (
                  <span className="flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-600">
                    <Lock className="h-3 w-3" /> 已冻结
                  </span>
                ) : (
                  <span className="flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">
                    <Unlock className="h-3 w-3" /> 草稿
                  </span>
                )}
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                {t.dimensions.map((d) => (
                  <span key={d.key} className="rounded bg-blue-50 px-1.5 py-0.5 text-xs text-blue-600">{d.label}</span>
                ))}
              </div>
              <div className="mt-3 flex items-center gap-1">
                <button
                  onClick={() => handleEdit(t)}
                  disabled={!!t.frozen_at}
                  className={`rounded p-1.5 transition ${
                    t.frozen_at ? 'cursor-not-allowed opacity-40 text-gray-300' : 'text-gray-400 hover:text-blue-600 hover:bg-blue-50'
                  }`}
                  title={t.frozen_at ? '模板已冻结，不可编辑' : '编辑'}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                {!t.frozen_at && (
                  <button onClick={() => handleFreeze(t)} className="rounded p-1.5 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50" title="冻结"><Lock className="h-3.5 w-3.5" /></button>
                )}
                <button onClick={() => handleDelete(t.id)} className="rounded p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50" title="删除"><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            </div>
          ))}
        </div>
      )}
      <ConfirmDialog
        open={confirmOpen}
        title="确认删除"
        message="删除该模板后将无法恢复，确定继续？"
        danger
        loading={submitting}
        onConfirm={doDelete}
        onCancel={() => { setConfirmOpen(false); setDeleteId('') }}
      />
    </div>
  )
}
