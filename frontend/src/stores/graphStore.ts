import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { listGraphs } from '../api/client'
import type { GraphProject } from '../api/types'

interface GraphState {
  projects: GraphProject[]
  loading: boolean
  reload: () => Promise<void>
}

export const useGraphStore = create<GraphState>()(
  persist(
    (set) => ({
      projects: [],
      loading: false,

      reload: async () => {
        set({ loading: true })
        try {
          const projects = await listGraphs()
          set({ projects })
        } finally {
          set({ loading: false })
        }
      },
    }),
    {
      name: 'graph-store',
      partialize: (s) => ({
        projects: s.projects,
      }),
    },
  ),
)
