import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { Link } from 'react-router-dom'
import remarkGfm from 'remark-gfm'
import { Bot, FileText, Send, Trash2 } from 'lucide-react'
import { askAssistant, clearSessionMessages, listSessionMessages } from '../api/client'
import type { AssistantMessage } from '../api/types'

/**
 * 全局 AI 助手对话面板：会话驱动，悬浮窗与独立页共用。
 * - sessionId 为 null 表示「新会话」（尚未落库），首条提问后由后端创建并回调 onSessionCreated
 * - 切换 sessionId 会重新拉取该会话的历史消息
 */
export default function AssistantChat({
  sessionId,
  onSessionCreated,
  onActivity,
}: {
  sessionId: string | null
  onSessionCreated?: (sessionId: string) => void
  onActivity?: () => void
}) {
  const [messages, setMessages] = useState<AssistantMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  // 切换会话时重新加载历史；新会话（null）清空为空态
  useEffect(() => {
    if (!sessionId) {
      setMessages([])
      return
    }
    listSessionMessages(sessionId).then(setMessages).catch(() => {})
  }, [sessionId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, sending])

  const handleSend = async () => {
    const question = input.trim()
    if (!question || sending) return
    setInput('')
    setError('')
    setSending(true)
    // 本地先追加用户消息（后端会同步落库）
    setMessages((prev) => [
      ...prev,
      {
        id: `local-${Date.now()}`,
        session_id: sessionId ?? '',
        role: 'user',
        content: question,
        created_at: new Date().toISOString(),
        refs: [],
      },
    ])
    try {
      const reply = await askAssistant(question, sessionId ?? '')
      setMessages((prev) => [...prev, reply])
      // 新会话首答：把后端创建的会话 id 回传给父级（切换选中并刷新列表）
      if (!sessionId && reply.session_id) onSessionCreated?.(reply.session_id)
      onActivity?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : '回答失败')
    } finally {
      setSending(false)
    }
  }

  const handleClear = async () => {
    if (!sessionId) {
      setMessages([])
      return
    }
    if (!window.confirm('确认清空当前会话的全部消息？')) return
    setError('')
    try {
      await clearSessionMessages(sessionId)
      setMessages([])
      onActivity?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : '清空失败')
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {messages.length > 0 && (
          <div className="text-right">
            <button
              onClick={handleClear}
              className="inline-flex items-center gap-1 text-xs text-gray-400 transition hover:text-red-500"
            >
              <Trash2 className="h-3 w-3" /> 清空对话
            </button>
          </div>
        )}
        {messages.length === 0 && !sending && (
          <div className="mt-12 flex flex-col items-center text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-blue-50 text-blue-600">
              <Bot className="h-7 w-7" />
            </span>
            <p className="mt-3 text-sm font-medium text-gray-700">向 AI 助手提问</p>
            <p className="mt-1 max-w-xs text-xs leading-relaxed text-gray-400">
              可询问调研报告与追踪期次中的内容，例如「XX 最近一期追踪有什么变化？」，AI 会自动定位相关报告并附引用，不占调研额度
            </p>
          </div>
        )}
        {messages.map((m) =>
          m.role === 'user' ? (
            <div key={m.id} className="flex justify-end">
              <div className="max-w-[85%] whitespace-pre-wrap rounded-lg rounded-br-sm bg-blue-600 px-4 py-2.5 text-sm leading-relaxed text-white shadow-sm">
                {m.content}
              </div>
            </div>
          ) : (
            <div key={m.id} className="flex justify-start gap-2">
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-900 text-white">
                <Bot className="h-4 w-4" />
              </span>
              <div className="max-w-[88%] rounded-lg rounded-tl-sm border border-gray-200 bg-white px-4 py-2.5 shadow-sm">
                <div className="prose prose-sm max-w-none text-gray-800 [&_table]:text-xs">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
                </div>
                {m.refs.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5 border-t border-gray-100 pt-2">
                    {m.refs.map((r) => (
                      <Link
                        key={r.task_id}
                        to={`/app/tasks/${r.task_id}`}
                        className="inline-flex items-center gap-1 rounded-full border border-blue-100 bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700 transition hover:bg-blue-100"
                      >
                        <FileText className="h-3 w-3" /> {r.product_name}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ),
        )}
        {sending && (
          <div className="flex justify-start gap-2">
            <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-900 text-white">
              <Bot className="h-4 w-4" />
            </span>
            <div className="flex items-center gap-1 rounded-lg rounded-tl-sm border border-gray-200 bg-white px-4 py-3 shadow-sm">
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400 [animation-delay:-0.2s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400 [animation-delay:-0.1s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400" />
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {error && <p className="mx-4 mb-2 rounded-md bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>}

      <div className="flex items-end gap-2 border-t border-gray-100 bg-gray-50/60 px-4 py-3">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              handleSend()
            }
          }}
          rows={1}
          placeholder="输入问题，Enter 发送"
          className="max-h-28 flex-1 resize-none rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        <button
          onClick={handleSend}
          disabled={sending || !input.trim()}
          className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Send className="h-4 w-4" /> 发送
        </button>
      </div>
    </div>
  )
}
