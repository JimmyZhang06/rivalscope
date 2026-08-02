import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import ReactFlow, {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  type Edge,
  type Node,
  type NodeProps,
} from 'reactflow'
import 'reactflow/dist/style.css'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { AlertTriangle, CheckCircle2, FileText, Link2, Radar, RefreshCw, X } from 'lucide-react'
import { createTracker, getGraph, listTrackers, refreshGraph } from '../../api/client'
import type { EntityType, GraphDetail, GraphEntity, GraphRelation, RelationType, TrackerCreate } from '../../api/types'
import TrackerForm from '../../components/TrackerForm'

// 关系类型 → 中文标签、颜色、放射方向（相对根节点）
const RELATION_META: Record<RelationType, { label: string; color: string; dir: 'left' | 'right' | 'top' | 'bottom' }> = {
  upstream_supplier: { label: '上游供应商', color: '#0e7490', dir: 'left' },
  downstream_customer: { label: '下游客户', color: '#1d4ed8', dir: 'right' },
  competitor: { label: '竞争对手', color: '#b91c1c', dir: 'top' },
  partner: { label: '合作伙伴', color: '#047857', dir: 'bottom' },
  investor: { label: '投资方', color: '#b45309', dir: 'bottom' },
  parent: { label: '母公司', color: '#0f766e', dir: 'bottom' },
  subsidiary: { label: '子公司', color: '#0369a1', dir: 'bottom' },
}

// 实体类型 → 中文与配色（沿用 blue/cyan，禁紫）
const ENTITY_META: Record<EntityType, { label: string; bg: string; border: string; text: string }> = {
  company: { label: '企业', bg: 'bg-blue-50', border: 'border-blue-300', text: 'text-blue-700' },
  product: { label: '产品', bg: 'bg-cyan-50', border: 'border-cyan-300', text: 'text-cyan-700' },
  org: { label: '机构', bg: 'bg-sky-50', border: 'border-sky-300', text: 'text-sky-700' },
  person: { label: '人物', bg: 'bg-slate-50', border: 'border-slate-300', text: 'text-slate-700' },
}

interface EntityNodeData {
  entity: GraphEntity
}

function EntityNode({ data }: NodeProps<EntityNodeData>) {
  const { entity } = data
  const meta = ENTITY_META[entity.type] ?? ENTITY_META.company
  return (
    <div
      className={`rounded-lg border px-3 py-2 text-center shadow-sm ${meta.bg} ${
        entity.is_root ? 'border-blue-600 ring-2 ring-blue-400' : meta.border
      }`}
      style={{ width: 150 }}
    >
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <div className="truncate text-sm font-semibold text-gray-900" title={entity.name}>
        {entity.name}
      </div>
      <div className={`mt-0.5 text-[11px] ${meta.text}`}>
        {entity.is_root ? '★ 核心' : meta.label}
      </div>
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
    </div>
  )
}

const nodeTypes = { entity: EntityNode }

/** 确定性放射状布局：root 居中，上游左 / 下游右 / 竞争上 / 合作投资下 */
function computeLayout(detail: GraphDetail): Record<string, { x: number; y: number }> {
  const rootId = detail.entities.find((e) => e.is_root)?.id ?? detail.entities[0]?.id ?? ''
  // 依据与根节点相连的关系，为每个实体判定所属方向分组
  const dirOf: Record<string, 'left' | 'right' | 'top' | 'bottom' | 'other'> = {}
  for (const rel of detail.relations) {
    const meta = RELATION_META[rel.relation_type]
    if (!meta) continue
    if (rel.source_id === rootId && rel.target_id !== rootId && !dirOf[rel.target_id]) {
      dirOf[rel.target_id] = meta.dir
    } else if (rel.target_id === rootId && rel.source_id !== rootId && !dirOf[rel.source_id]) {
      dirOf[rel.source_id] = meta.dir
    }
  }
  const groups: Record<string, string[]> = { left: [], right: [], top: [], bottom: [], other: [] }
  for (const e of detail.entities) {
    if (e.id === rootId) continue
    groups[dirOf[e.id] ?? 'other'].push(e.id)
  }

  const pos: Record<string, { x: number; y: number }> = { [rootId]: { x: 0, y: 0 } }
  const spreadV = (ids: string[], x: number) =>
    ids.forEach((id, i) => {
      pos[id] = { x, y: (i - (ids.length - 1) / 2) * 96 }
    })
  const spreadH = (ids: string[], y: number) =>
    ids.forEach((id, i) => {
      pos[id] = { x: (i - (ids.length - 1) / 2) * 200, y }
    })
  spreadV(groups.left, -420)
  spreadV(groups.right, 420)
  spreadH(groups.top, -260)
  spreadH(groups.bottom, 280)
  // 未与根直接关联的实体放到更外圈底部
  groups.other.forEach((id, i) => {
    pos[id] = { x: (i - (groups.other.length - 1) / 2) * 200, y: 480 }
  })
  return pos
}

export default function GraphDetailPage() {
  const { id = '' } = useParams()
  const [detail, setDetail] = useState<GraphDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [selectedEntity, setSelectedEntity] = useState<GraphEntity | null>(null)
  const [selectedRelation, setSelectedRelation] = useState<GraphRelation | null>(null)
  const [showReport, setShowReport] = useState(false)
  // 纳入定时追踪：已有追踪项映射（产品名 -> tracker id）与新建弹窗
  const [trackerIdByName, setTrackerIdByName] = useState<Record<string, string>>({})
  const [showTrackForm, setShowTrackForm] = useState(false)
  const [trackSubmitting, setTrackSubmitting] = useState(false)
  const [trackError, setTrackError] = useState('')
  const [trackNotice, setTrackNotice] = useState('')
  // 存储 ReactFlow 实例（用于"重置布局"按钮）
  const flowApiRef = useRef<any>(null)

  const reload = useCallback(async () => {
    try {
      setDetail(await getGraph(id))
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    reload()
  }, [reload])

  // 构建中时轮询
  useEffect(() => {
    if (!detail || (detail.status !== 'building' && detail.status !== 'pending')) return
    const timer = setInterval(reload, 4000)
    return () => clearInterval(timer)
  }, [detail, reload])

  // 已有追踪项（用于"已在追踪"标识）；未加入企业等场景静默，创建时由后端提示
  useEffect(() => {
    listTrackers()
      .then((list) => {
        const m: Record<string, string> = {}
        list.forEach((t) => (m[t.product_name] = t.id))
        setTrackerIdByName(m)
      })
      .catch(() => {})
  }, [])

  const entityById = useMemo(() => {
    const m: Record<string, GraphEntity> = {}
    detail?.entities.forEach((e) => (m[e.id] = e))
    return m
  }, [detail])

  const nodes = useMemo<Node<EntityNodeData>[]>(() => {
    if (!detail) return []
    const pos = computeLayout(detail)
    return detail.entities.map((e) => ({
      id: e.id,
      type: 'entity',
      position: pos[e.id] ?? { x: 0, y: 0 },
      data: { entity: e },
    }))
  }, [detail])

  const edges = useMemo<Edge[]>(() => {
    if (!detail) return []
    return detail.relations.map((r) => {
      const meta = RELATION_META[r.relation_type]
      return {
        id: r.id,
        source: r.source_id,
        target: r.target_id,
        label: meta?.label ?? r.relation_type,
        labelStyle: { fontSize: 11, fill: meta?.color ?? '#475569' },
        labelBgStyle: { fill: '#ffffff', fillOpacity: 0.85 },
        style: { stroke: meta?.color ?? '#94a3b8', strokeWidth: 1.5 },
        markerEnd: { type: MarkerType.ArrowClosed, color: meta?.color ?? '#94a3b8' },
      }
    })
  }, [detail])

  const relationsOfSelected = useMemo(() => {
    if (!detail || !selectedEntity) return []
    return detail.relations.filter((r) => r.source_id === selectedEntity.id || r.target_id === selectedEntity.id)
  }, [detail, selectedEntity])

  // 纳入追踪的预填：竞品 = 该实体所有 competitor 关系对端实体名，时效沿用图谱项目
  const trackPrefill = useMemo(() => {
    if (!detail || !selectedEntity) return undefined
    const rivals = detail.relations
      .filter(
        (r) =>
          r.relation_type === 'competitor' &&
          (r.source_id === selectedEntity.id || r.target_id === selectedEntity.id),
      )
      .map((r) => (r.source_id === selectedEntity.id ? entityById[r.target_id] : entityById[r.source_id]))
      .filter((e): e is GraphEntity => !!e && e.name !== selectedEntity.name)
    return {
      product_name: selectedEntity.name,
      competitors: [...new Set(rivals.map((e) => e.name))].join(','),
      time_range: detail.time_range,
    }
  }, [detail, selectedEntity, entityById])

  const handleTrackSubmit = async (payload: TrackerCreate) => {
    setTrackSubmitting(true)
    setTrackError('')
    try {
      const t = await createTracker(payload)
      setTrackerIdByName((prev) => ({ ...prev, [t.product_name]: t.id }))
      setShowTrackForm(false)
      setTrackNotice(`「${t.product_name}」已纳入定时追踪`)
    } catch (err) {
      setTrackError(err instanceof Error ? err.message : '创建追踪失败')
    } finally {
      setTrackSubmitting(false)
    }
  }

  const handleRefresh = async () => {
    setRefreshing(true)
    setError('')
    try {
      await refreshGraph(id)
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : '重建失败')
    } finally {
      setRefreshing(false)
    }
  }

  if (loading) {
    return <div className="mx-auto max-w-5xl px-6 py-8 text-sm text-gray-400">加载中…</div>
  }
  if (!detail) {
    return (
      <div className="mx-auto max-w-5xl px-6 py-8">
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
          {error || '图谱不存在'}
        </div>
        <Link to="/app/graph" className="mt-4 inline-block text-sm text-blue-600 hover:underline">
          ← 返回图谱列表
        </Link>
      </div>
    )
  }

  const building = detail.status === 'building' || detail.status === 'pending'

  return (
    <div className="flex h-screen flex-col">
      {/* 顶部栏（右侧留出通知铃铛的固定位置，避免遮挡） */}
      <div className="flex flex-wrap items-center gap-3 border-b border-gray-200 bg-white py-4 pl-6 pr-20">
        <Link to="/app/graph" className="text-sm text-gray-500 hover:text-blue-600">
          ← 返回
        </Link>
        <h1 className="text-lg font-bold tracking-tight text-gray-900">{detail.root_name}</h1>
        {detail.industry && (
          <span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-xs text-blue-700">{detail.industry}</span>
        )}
        <span className="text-xs text-gray-400">
          {detail.entities.length} 个实体 · {detail.relations.length} 条关系
        </span>
        <span className="flex-1" />
        {detail.status === 'completed' && detail.report_markdown && (
          <button
            onClick={() => setShowReport(true)}
            className="flex items-center gap-1.5 rounded-md bg-blue-600 px-4 py-1.5 text-xs font-medium text-white transition hover:bg-blue-700"
          >
            <FileText className="h-3.5 w-3.5" />
            分析报告
          </button>
        )}
        <button
          onClick={handleRefresh}
          disabled={refreshing || building}
          className="flex items-center gap-1.5 rounded-md border border-gray-200 px-4 py-1.5 text-xs font-medium text-gray-600 transition hover:bg-gray-50 disabled:opacity-50"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          {refreshing ? '重建中…' : '重建图谱'}
        </button>
        <button
          onClick={() => flowApiRef.current?.fitView({ padding: 0.2, duration: 300 })}
          disabled={!detail || detail.status !== 'completed'}
          className="flex items-center gap-1.5 rounded-md border border-gray-200 px-4 py-1.5 text-xs font-medium text-gray-600 transition hover:bg-gray-50 disabled:opacity-50"
          title="重置布局"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          重置布局
        </button>
      </div>

      {error && (
        <div className="border-b border-red-200 bg-red-50 px-6 py-2 text-sm text-red-600">{error}</div>
      )}

      {trackNotice && (
        <div className="flex items-center gap-2 border-b border-blue-100 bg-blue-50 px-6 py-2 text-sm text-blue-700">
          <CheckCircle2 className="h-4 w-4 shrink-0" /> {trackNotice}
          <Link to="/app/trackers" className="font-medium underline hover:text-blue-800">
            前往追踪管理
          </Link>
          <span className="flex-1" />
          <button onClick={() => setTrackNotice('')} className="text-blue-400 hover:text-blue-600">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* 图例 */}
      <div className="flex flex-wrap items-center gap-3 border-b border-gray-100 bg-gray-50 px-6 py-2">
        {(Object.keys(RELATION_META) as RelationType[]).map((k) => (
          <span key={k} className="flex items-center gap-1.5 text-xs text-gray-500">
            <span className="inline-block h-0.5 w-4 rounded" style={{ backgroundColor: RELATION_META[k].color }} />
            {RELATION_META[k].label}
          </span>
        ))}
      </div>

      {/* 画布区域 */}
      <div className="relative flex-1">
        {building ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <span className="h-3 w-3 animate-pulse rounded-full bg-blue-500" />
            <p className="mt-4 font-medium text-gray-900">正在构建关系网络…</p>
            <p className="mt-1 text-sm text-gray-500">联网检索并抽取产业链关系，约需 1~2 分钟，页面会自动刷新</p>
          </div>
        ) : detail.status === 'failed' ? (
          <div className="flex h-full flex-col items-center justify-center px-6 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-red-50 text-red-500">
              <AlertTriangle className="h-7 w-7" />
            </span>
            <p className="mt-4 font-medium text-gray-900">图谱构建失败</p>
            <p className="mt-1 max-w-lg text-sm text-red-600">{detail.error || '未知错误'}</p>
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="mt-5 rounded-md bg-blue-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50"
            >
              {refreshing ? '重建中…' : '重新构建'}
            </button>
          </div>
        ) : (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            fitView
            minZoom={0.2}
            onInit={(instance) => { flowApiRef.current = instance as any }}
            onNodeClick={(_, node) => {
              setSelectedEntity(entityById[node.id] ?? null)
              setSelectedRelation(null)
            }}
            onEdgeClick={(_, edge) => {
              setSelectedRelation(detail.relations.find((r) => r.id === edge.id) ?? null)
              setSelectedEntity(null)
            }}
            onPaneClick={() => {
              setSelectedEntity(null)
              setSelectedRelation(null)
            }}
          >
            <Background color="#e2e8f0" gap={20} />
            <Controls />
          </ReactFlow>
        )}

        {/* 右侧详情抽屉 */}
        {(selectedEntity || selectedRelation) && (
          <div className="absolute inset-y-0 right-0 z-10 w-80 overflow-y-auto border-l border-gray-200 bg-white p-5 shadow-xl">
            <button
              onClick={() => {
                setSelectedEntity(null)
                setSelectedRelation(null)
              }}
              className="float-right text-gray-400 hover:text-gray-600"
            >
              <X className="h-4 w-4" />
            </button>

            {selectedEntity && (
              <div>
                <span className={`rounded-full px-2 py-0.5 text-xs ${ENTITY_META[selectedEntity.type]?.text ?? ''}`}>
                  {ENTITY_META[selectedEntity.type]?.label ?? selectedEntity.type}
                </span>
                <h3 className="mt-2 text-lg font-bold text-gray-900">{selectedEntity.name}</h3>
                {selectedEntity.industry && <p className="mt-1 text-sm text-gray-500">行业：{selectedEntity.industry}</p>}
                {selectedEntity.description && (
                  <p className="mt-3 text-sm leading-relaxed text-gray-600">{selectedEntity.description}</p>
                )}
                {trackerIdByName[selectedEntity.name] ? (
                  <Link
                    to={`/app/trackers/${trackerIdByName[selectedEntity.name]}`}
                    className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-md bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-700 transition hover:bg-blue-100"
                  >
                    <Radar className="h-4 w-4" /> 已在追踪 · 查看详情
                  </Link>
                ) : (
                  <button
                    onClick={() => {
                      setTrackError('')
                      setShowTrackForm(true)
                    }}
                    className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700"
                  >
                    <Radar className="h-4 w-4" /> 纳入定时追踪
                  </button>
                )}
                <h4 className="mt-5 text-sm font-semibold text-gray-900">关联关系（{relationsOfSelected.length}）</h4>
                <div className="mt-2 space-y-2">
                  {relationsOfSelected.map((r) => {
                    const meta = RELATION_META[r.relation_type]
                    const other =
                      r.source_id === selectedEntity.id ? entityById[r.target_id] : entityById[r.source_id]
                    const outgoing = r.source_id === selectedEntity.id
                    return (
                      <button
                        key={r.id}
                        onClick={() => {
                          setSelectedRelation(r)
                          setSelectedEntity(null)
                        }}
                        className="block w-full rounded-md border border-gray-100 bg-gray-50 px-3 py-2 text-left text-xs transition hover:bg-gray-100"
                      >
                        <span className="font-medium" style={{ color: meta?.color }}>
                          {meta?.label ?? r.relation_type}
                        </span>
                        <span className="text-gray-400"> {outgoing ? '→' : '←'} </span>
                        <span className="text-gray-700">{other?.name ?? '未知'}</span>
                      </button>
                    )
                  })}
                  {relationsOfSelected.length === 0 && <p className="text-xs text-gray-400">暂无关联关系</p>}
                </div>
              </div>
            )}

            {selectedRelation && (
              <div>
                <span
                  className="rounded-full px-2 py-0.5 text-xs font-medium text-white"
                  style={{ backgroundColor: RELATION_META[selectedRelation.relation_type]?.color ?? '#64748b' }}
                >
                  {RELATION_META[selectedRelation.relation_type]?.label ?? selectedRelation.relation_type}
                </span>
                <h3 className="mt-2 text-base font-bold text-gray-900">
                  {entityById[selectedRelation.source_id]?.name ?? '?'}
                  <span className="mx-1.5 text-gray-400">→</span>
                  {entityById[selectedRelation.target_id]?.name ?? '?'}
                </h3>
                <p className="mt-1 text-xs text-gray-400">
                  置信度 {(selectedRelation.confidence * 100).toFixed(0)}%
                </p>
                {selectedRelation.description && (
                  <p className="mt-3 text-sm leading-relaxed text-gray-600">{selectedRelation.description}</p>
                )}
                {selectedRelation.source_url ? (
                  <a
                    href={selectedRelation.source_url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-4 flex items-center gap-1.5 truncate text-sm text-blue-600 hover:underline"
                    title={selectedRelation.source_url}
                  >
                    <Link2 className="h-4 w-4 shrink-0" /> 查看来源
                  </a>
                ) : (
                  <p className="mt-4 text-xs text-gray-400">该关系暂无来源链接</p>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 关系网络分析报告抽屉 */}
      {showReport && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={() => setShowReport(false)}>
          <div
            className="flex h-full w-full max-w-2xl flex-col bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
              <div className="flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-md bg-blue-50 text-blue-700">
                  <FileText className="h-4 w-4" />
                </span>
                <div>
                  <h2 className="text-sm font-semibold text-gray-900">关系网络分析报告</h2>
                  <p className="text-xs text-gray-400">基于 {detail.root_name} 的产业链关系自动生成</p>
                </div>
              </div>
              <button onClick={() => setShowReport(false)} className="text-gray-400 transition hover:text-gray-600">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
              <div className="prose prose-sm max-w-none text-gray-800 prose-headings:tracking-tight prose-a:text-blue-600 [&_table]:text-xs">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{detail.report_markdown}</ReactMarkdown>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 纳入追踪弹窗（复用 TrackerForm，图谱数据预填） */}
      {showTrackForm && selectedEntity && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-8">
          <div className="max-h-full w-full max-w-lg overflow-y-auto rounded-lg bg-white p-6 shadow-xl">
            <h3 className="text-lg font-bold text-gray-900">将「{selectedEntity.name}」纳入定时追踪</h3>
            <p className="mt-1 text-xs text-gray-400">已按图谱信息预填竞品与时效，可调整后创建</p>
            {trackError && (
              <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-600">
                {trackError}
              </div>
            )}
            <div className="mt-5">
              <TrackerForm
                initial={trackPrefill}
                submitting={trackSubmitting}
                onSubmit={handleTrackSubmit}
                onCancel={() => setShowTrackForm(false)}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
