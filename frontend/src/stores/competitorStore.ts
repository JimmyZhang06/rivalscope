import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { listCompetitors, listProfileTemplates } from '../api/client'
import type { Competitor, ProfileTemplate } from '../api/types'

interface CompetitorState {
  items: Competitor[]
  templates: ProfileTemplate[]
  loading: boolean
  reload: () => Promise<void>
}

export const useCompetitorStore = create<CompetitorState>()(
  persist(
    (set) => ({
      items: [],
      templates: [],
      loading: false,

      reload: async () => {
        set({ loading: true })
        try {
          const [cs, ts] = await Promise.all([
            listCompetitors(),
            listProfileTemplates(),
          ])
          set({ items: cs, templates: ts.filter((t) => t.frozen_at) })
        } finally {
          set({ loading: false })
        }
      },
    }),
    {
      name: 'competitor-store',
      partialize: (s) => ({
        items: s.items,
        templates: s.templates,
      }),
    },
  ),
)
