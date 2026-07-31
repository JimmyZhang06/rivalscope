import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Bot, MessageSquarePlus, X } from 'lucide-react'
import AssistantChat from './AssistantChat'
import { listAssistantSessions } from '../api/client'

/** 右下角 AI 助手悬浮球 + 浮动对话面板；在独立助手页时隐藏 */
export default function AssistantWidget() {
  const [open, setOpen] = useState(false)
  // null 表示新会话（尚未落库）
  const [currentId, setCurrentId] = useState<string | null>(null)
  const location = useLocation()

  // 打开面板时载入最近一次会话，续聊而非每次新开
  useEffect(() => {
    if (!open) return
    listAssistantSessions()
      .then((list) => setCurrentId((prev) => prev ?? (list[0]?.id ?? null)))
      .catch(() => {})
  }, [open])

  if (location.pathname.startsWith('/app/assistant')) return null

  return (
    <>
      {open && (
        <div className="fixed bottom-24 right-6 z-40 flex h-[560px] w-96 max-w-[calc(100vw-3rem)] flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl">
          <div className="flex items-center justify-between bg-slate-900 px-4 py-3">
            <p className="flex items-center gap-2 text-sm font-semibold text-white">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/10">
                <Bot className="h-4 w-4" />
              </span>
              AI 助手
            </p>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setCurrentId(null)}
                title="新建会话"
                className="rounded-md p-1.5 text-slate-400 transition hover:bg-white/10 hover:text-white"
              >
                <MessageSquarePlus className="h-4 w-4" />
              </button>
              <Link
                to="/app/assistant"
                onClick={() => setOpen(false)}
                title="展开全屏"
                className="rounded-md px-2 py-1 text-xs text-slate-400 transition hover:bg-white/10 hover:text-white"
              >
                展开全屏 ↗
              </Link>
              <button
                onClick={() => setOpen(false)}
                title="收起"
                className="rounded-md p-1.5 text-slate-400 transition hover:bg-white/10 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
          <AssistantChat
            key={currentId ?? 'new'}
            sessionId={currentId}
            onSessionCreated={setCurrentId}
          />
        </div>
      )}
      <button
        onClick={() => setOpen((v) => !v)}
        title="AI 助手"
        className="fixed bottom-6 right-6 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-slate-900 text-white shadow-lg ring-1 ring-white/10 transition hover:bg-slate-800 hover:shadow-xl"
      >
        {open ? <X className="h-5 w-5" /> : <Bot className="h-5 w-5" />}
      </button>
    </>
  )
}
