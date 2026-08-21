import { useCallback, useEffect, useState } from 'react'
import { Plus, Pencil, Trash2, Lock, Unlock, Layers, GripVertical } from 'lucide-react'
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

type DimField = { key: string; label: string; type: string }
type Dim = { key: string; label: string; fields: DimField[] }

const FIELD_TYPES = ['text', 'number', 'date'] as const

function emptyDim(): Dim {
  return { key: '', label: '', fields: [] }
}

function emptyField(): DimField {
  return { key: '', label: '', type: 'text' }
}

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
  const [dims, setDims] = useState<Dim[]>([])
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

  useEffect(() => { reload() }, [reload])

  const resetForm = () => {
    setName('')
    setDims([])
    setEditing(null)
    setShowForm(false)
  }

  const showNotice = (msg: string) => {
    setNotice(msg)
    setTimeout(() => setNotice(''), 2500)
  }

  const addDim = () => setDims(d => [...d, emptyDim()])
  const removeDim = (i: number) => setDims(d => d.filter((_, idx) => idx !== i))
  const updateDim = (i: number, patch: Partial<Dim>) => {
    setDims(d => d.map((dim, idx) => idx === i ? { ...dim, ...patch } : dim))
  }
  const addField = (di: number) => {
    updateDim(di, { fields: [...(dims[di]?.fields || []), emptyField()] })
  }
  const removeField = (di: number, fi: number) => {
    updateDim(di, { fields: dims[di].fields.filter((_, idx) => idx !== fi) })
  }
  const updateField = (di: number, fi: number, patch: Partial<DimField>) => {
    setDims(d => d.map((dim, idx) => {
      if (idx !== di) return dim
      return { ...dim, fields: dim.fields.map((f, fIdx) => fIdx === fi ? { ...f, ...patch } : f) }
    }))
  }

  const loadFromJson = () => {
    const raw = prompt('粘贴 JSON 维度数组：')
    if (!raw) return
    try {
      const arr = JSON.parse(raw)
      if (!Array.isArray(arr)) throw new Error('需为数组')
      const parsed: Dim[] = arr.map((d: any) => ({
        key: d.key || '',
        label: d.label || '',
        fields: (d.fields || []).map((f: any) => ({
          key: f.key || '',
          label: f.label || '',
          type: f.type || 'text',
        })),
      }))
      setDims(parsed)
      showNotice(`已导入 ${parsed.length} 个维度`)
    } catch {
      setError('JSON 格式不正确')
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      const dimList = dims
        .filter(d => d.key.trim() && d.label.trim())
        .map(d => ({
          key: d.key.trim(),
          label: d.label.trim(),
          fields: d.fields.filter(f => f.key.trim() && f.label.trim()),
        }))
      if (dimList.length === 0) throw new Error('请至少添加一个有名称的维度')
      if (editing) {
        await updateProfileTemplate(editing.id, { name: name.trim(), dimensions: dimList, org_id: editing.org_id })
        showNotice('模板已更新')
      } else {
        await createProfileTemplate({ name: name.trim(), dimensions: dimList, org_id: '' })
        showNotice('模板已创建')
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
    setDims(t.dimensions.map(d => ({
      key: d.key || '',
      label: d.label || '',
      fields: (d.fields || []).map(f => ({
        key: (f as any).key || '',
        label: (f as any).label || '',
        type: (f as any).type || 'text',
      })),
    })))
    setShowForm(true)
  }

  const handleFreeze = async (t: ProfileTemplate) => {
    try {
      await freezeProfileTemplate(t.id)
      showNotice('模板已冻结')
      await reload()
    } catch {
      setError('操作失败')
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
      showNotice('模板已删除')
      await reload()
    } catch {
      setError('删除失败')
    } finally {
      setSubmitting(false)
      setConfirmOpen(false)
      setDeleteId('')
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">画像模板</h1>
          <p className="mt-1 text-sm text-gray-500">管理竞品画像的维度模板，冻结后不可修改</p>
        </div>
        <button
          onClick={() => { resetForm(); setShowForm(true) }}
          className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700"
        >
          <Plus className="h-4 w-4" /> 新建模板
        </button>
      </div>

      {notice && <p className="mt-4 rounded-md bg-emerald-50 px-4 py-2 text-sm text-emerald-700">{notice}</p>}
      {error && <p className="mt-4 rounded-md bg-red-50 px-4 py-2 text-sm text-red-600">{error}</p>}

      {/* ---------- 表单弹窗 ---------- */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-8" onClick={resetForm}>
          <form role="dialog" aria-modal="true" aria-labelledby="template-dialog-title" onSubmit={handleSubmit} className="w-full max-w-2xl rounded-lg bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 id="template-dialog-title" className="text-base font-semibold text-gray-900">{editing ? '编辑模板' : '新建模板'}</h3>

            {/* 模板名称 */}
            <div className="mt-4">
              <label className="block text-xs font-medium text-gray-500">模板名称 *</label>
              <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={200}
                className="mt-1 w-full rounded-md border border-gray-200 px-3 py-2 text-sm outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500" />
            </div>

            {/* 维度编辑器 */}
            <div className="mt-5">
              <div className="flex items-center justify-between">
                <label className="block text-xs font-medium text-gray-500">维度定义 *</label>
                <div className="flex gap-2">
                  <button type="button" onClick={loadFromJson}
                    className="rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-500 transition hover:bg-gray-50">
                    从 JSON 导入
                  </button>
                  <button type="button" onClick={addDim}
                    className="rounded-md border border-blue-200 px-2 py-1 text-xs text-blue-600 transition hover:bg-blue-50">
                    + 添加维度
                  </button>
                </div>
              </div>

              {dims.length === 0 && (
                <div className="mt-3 rounded-md border border-dashed border-gray-200 py-6 text-center">
                  <p className="text-xs text-gray-400">还没有维度，点击上方按钮添加</p>
                </div>
              )}

              <div className="mt-3 space-y-4">
                {dims.map((dim, di) => (
                  <div key={di} className="rounded-lg border border-gray-200 p-4">
                    {/* 维度标题行 */}
                    <div className="flex items-center gap-2">
                      <GripVertical className="h-4 w-4 shrink-0 text-gray-300" />
                      <div className="grid flex-1 grid-cols-1 gap-2 sm:grid-cols-5">
                        <div className="sm:col-span-2">
                          <label className="block text-[10px] text-gray-400">维度标识（key）</label>
                          <input value={dim.key} onChange={(e) => updateDim(di, { key: e.target.value })}
                            placeholder="product_overview"
                            className="mt-0.5 w-full rounded border border-gray-100 px-2 py-1.5 text-xs outline-none transition focus:border-blue-400" />
                        </div>
                        <div className="sm:col-span-3">
                          <label className="block text-[10px] text-gray-400">显示名称</label>
                          <input value={dim.label} onChange={(e) => updateDim(di, { label: e.target.value })}
                            placeholder="产品概况"
                            className="mt-0.5 w-full rounded border border-gray-100 px-2 py-1.5 text-xs outline-none transition focus:border-blue-400" />
                        </div>
                      </div>
                      <button type="button" onClick={() => removeDim(di)}
                        className="mt-5 rounded p-1 text-gray-300 transition hover:text-red-500 hover:bg-red-50">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    {/* 字段列表 */}
                    <div className="mt-3 space-y-2 sm:ml-6">
                      {dim.fields.map((f, fi) => (
                        <div key={fi} className="flex items-center gap-2 rounded bg-gray-50 p-2">
                          <div className="grid flex-1 grid-cols-1 gap-2 sm:grid-cols-5">
                            <div className="sm:col-span-2">
                              <label className="block text-[10px] text-gray-400">字段标识</label>
                              <input value={f.key} onChange={(e) => updateField(di, fi, { key: e.target.value })}
                                placeholder="name"
                                className="mt-0.5 w-full rounded border border-gray-200 px-2 py-1 text-[11px] outline-none transition focus:border-blue-400" />
                            </div>
                            <div className="sm:col-span-2">
                              <label className="block text-[10px] text-gray-400">字段名称</label>
                              <input value={f.label} onChange={(e) => updateField(di, fi, { label: e.target.value })}
                                placeholder="产品名称"
                                className="mt-0.5 w-full rounded border border-gray-200 px-2 py-1 text-[11px] outline-none transition focus:border-blue-400" />
                            </div>
                            <div>
                              <label className="block text-[10px] text-gray-400">类型</label>
                              <select value={f.type} onChange={(e) => updateField(di, fi, { type: e.target.value })}
                                className="mt-0.5 w-full rounded border border-gray-200 px-1.5 py-1 text-[11px] outline-none">
                                {FIELD_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                              </select>
                            </div>
                          </div>
                          <button type="button" onClick={() => removeField(di, fi)}
                            className="mt-4 rounded p-0.5 text-gray-300 transition hover:text-red-500">
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                      <button type="button" onClick={() => addField(di)}
                        className="flex items-center gap-1 rounded py-1 pl-1 text-[11px] text-gray-400 transition hover:text-blue-600 hover:bg-blue-50">
                        <Plus className="h-3 w-3" /> 添加字段
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* 操作按钮 */}
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" onClick={resetForm}
                className="rounded-md px-4 py-2 text-sm text-gray-500 transition hover:bg-gray-50">
                取消
              </button>
              <button type="submit" disabled={submitting || !name.trim()}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-50">
                {submitting ? '保存中…' : '保存'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ---------- 模板列表 ---------- */}
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
                  <span key={d.key} className="rounded bg-blue-50 px-1.5 py-0.5 text-xs text-blue-600">{d.label || d.key}</span>
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
                  <button onClick={() => handleFreeze(t)} className="rounded p-1.5 text-gray-400 transition hover:text-emerald-600 hover:bg-emerald-50" title="冻结"><Lock className="h-3.5 w-3.5" /></button>
                )}
                <button onClick={() => handleDelete(t.id)} className="rounded p-1.5 text-gray-400 transition hover:text-red-600 hover:bg-red-50" title="删除"><Trash2 className="h-3.5 w-3.5" /></button>
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
