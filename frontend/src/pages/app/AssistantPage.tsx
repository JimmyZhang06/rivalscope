import { useEffect, useRef, useState } from 'react'
import { Bot, Check, MessageSquarePlus, Pencil, Trash2 } from 'lucide-react'
import AssistantChat from '../../components/AssistantChat'
import {
  deleteAssistantSession,
  listAssistantSessions,
  renameAssistantSession,
} from '../../api/client'
import type { AssistantSession } from '../../api/types'

/** 全局 AI 助手独立页：左侧会话历史 + 右侧对话面板 */
export default function AssistantPage() {
  const [sessions, setSessions] = useState<AssistantSession[]>([])
  // null 表示「新会话」（尚未落库）
  const [currentId, setCurrentId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState('')
  const editInputRef = useRef<HTMLInputElement>(null)

  const refreshSessions = () => listAssistantSessions().then(setSessions).catch(() => {})

  // 首次加载：拉取会话列表，默认选中最近活跃的一条
  useEffect(() => {
    listAssistantSessions()
      .then((list) => {
        setSessions(list)
        setCurrentId((prev) => prev ?? (list[0]?.id ?? null))
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (editingId) editInputRef.current?.focus()
  }, [editingId])

  const startNew = () => {
    setCurrentId(null)
    setEditingId(null)
  }

  const handleSessionCreated = (id: string) => {
    setCurrentId(id)
    refreshSessions()
  }

  const startRename = (s: AssistantSession) => {
    setEditingId(s.id)
    setEditingTitle(s.title)
  }

  const commitRename = async () => {
    const id = editingId
    const title = editingTitle.trim()
    setEditingId(null)
    if (!id || !title) return
    try {
      const updated = await renameAssistantSession(id, title)
      setSessions((prev) => prev.map((s) => (s.id === id ? updated : s)))
    } catch {
      /* 忽略：改名失败保持原标题 */
    }
  }

  const handleDelete = async (id: string) => {
    if (!window.confirm('确认删除该会话及其全部消息？')) return
    try {
      await deleteAssistantSession(id)
      setSessions((prev) => {
        const next = prev.filter((s) => s.id !== id)
        if (currentId === id) setCurrentId(next[0]?.id ?? null)
        return next
      })
    } catch {
      /* 忽略删除失败 */
    }
  }

  const isNew = currentId === null

  return (
    <div className="mx-auto flex h-screen max-w-6xl flex-col px-6 py-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">AI 助手</h1>
        <p className="mt-1 text-sm text-gray-500">
          可询问调研报告与追踪期次中的内容，AI 自动定位相关报告并附引用链接，不占调研额度
        </p>
      </div>

      <div className="mt-4 grid min-h-0 flex-1 grid-cols-1 gap-4 md:grid-cols-[16rem_1fr]">
        {/* 会话侧栏 */}
        <aside className="hidden min-h-0 flex-col overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm md:flex">
          <div className="border-b border-gray-100 px-3 py-3">
            <button
              onClick={startNew}
              className="flex w-full items-center justify-center gap-1.5 rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-blue-700"
            >
              <MessageSquarePlus className="h-4 w-4" /> 新建会话
            </button>
          </div>
          <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 py-2">
            {isNew && (
              <div className="flex items-center gap-2 rounded-md bg-blue-50 px-3 py-2 text-sm font-medium text-blue-700">
                <Bot className="h-4 w-4 shrink-0" /> 新会话
              </div>
            )}
            {sessions.length === 0 && !isNew && (
              <p className="px-3 py-8 text-center text-xs text-gray-400">暂无历史会话</p>
            )}
            {sessions.map((s) => {
              const active = s.id === currentId
              const editing = s.id === editingId
              return (
                <div
                  key={s.id}
                  className={`group flex items-center gap-1 rounded-md px-2 py-2 text-sm transition ${
                    active ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {editing ? (
                    <input
                      ref={editInputRef}
                      value={editingTitle}
                      onChange={(e) => setEditingTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitRename()
                        if (e.key === 'Escape') setEditingId(null)
                      }}
                      onBlur={commitRename}
                      maxLength={200}
                      className="min-w-0 flex-1 rounded border border-blue-300 bg-white px-1.5 py-0.5 text-sm text-gray-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  ) : (
                    <button
                      onClick={() => setCurrentId(s.id)}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    >
                      <Bot className={`h-4 w-4 shrink-0 ${active ? 'text-blue-600' : 'text-gray-400'}`} />
                      <span className="truncate">{s.title}</span>
                    </button>
                  )}
                  {editing ? (
                    <button
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={commitRename}
                      className="shrink-0 rounded p-1 text-blue-600 hover:bg-blue-100"
                      title="保存"
                    >
                      <Check className="h-3.5 w-3.5" />
                    </button>
                  ) : (
                    <div className="flex shrink-0 items-center opacity-0 transition group-hover:opacity-100">
                      <button
                        onClick={() => startRename(s)}
                        className="rounded p-1 text-gray-400 hover:bg-gray-200 hover:text-gray-700"
                        title="重命名"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => handleDelete(s.id)}
                        className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-500"
                        title="删除"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </aside>

        {/* 对话面板 */}
        <div className="min-h-0 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
          <AssistantChat
            key={currentId ?? 'new'}
            sessionId={currentId}
            onSessionCreated={handleSessionCreated}
            onActivity={refreshSessions}
          />
        </div>
      </div>
    </div>
  )
}
