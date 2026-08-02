import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { listResearch } from '../api/client'
import type { TaskBrief } from '../api/types'

type Filter = 'all' | 'mine' | 'others'

interface TaskState {
  tasks: TaskBrief[]
  filter: Filter
  loading: boolean
  setFilter: (f: Filter) => void
  reload: () => Promise<void>
  /** 外部刷新后同步 store（用于删除操作） */
  syncTasks: (tasks: TaskBrief[]) => void
}

export const useTaskStore = create<TaskState>()(
  persist(
    (set) => ({
      tasks: [],
      filter: 'all',
      loading: false,

      setFilter: (filter) => set({ filter }),

      syncTasks: (tasks) => set({ tasks }),

      reload: async () => {
        set({ loading: true })
        try {
          const tasks = await listResearch()
          set({ tasks })
        } finally {
          set({ loading: false })
        }
      },
    }),
    {
      name: 'task-store',
      partialize: (s) => ({
        tasks: s.tasks,
        filter: s.filter,
      }),
    },
  ),
)
