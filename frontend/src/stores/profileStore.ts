import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { listCompetitors, listProfileTemplates, listProfiles } from '../api/client'
import type { Competitor, CompetitorProfile, ProfileTemplate } from '../api/types'

interface ProfileState {
  profiles: CompetitorProfile[]
  templates: ProfileTemplate[]
  competitors: Competitor[]
  loading: boolean
  reload: () => Promise<void>
}

export const useProfileStore = create<ProfileState>()(
  persist(
    (set) => ({
      profiles: [],
      templates: [],
      competitors: [],
      loading: false,

      reload: async () => {
        set({ loading: true })
        try {
          const [t, c, p] = await Promise.all([
            listProfileTemplates(),
            listCompetitors(),
            listProfiles(),
          ])
          set({ templates: t, competitors: c, profiles: p })
        } finally {
          set({ loading: false })
        }
      },
    }),
    {
      name: 'profile-store',
      partialize: (s) => ({
        profiles: s.profiles,
        templates: s.templates,
        competitors: s.competitors,
      }),
    },
  ),
)
