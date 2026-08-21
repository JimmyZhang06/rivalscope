import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { getOrgMe, listTrackers } from '../api/client'
import type { Tracker } from '../api/types'

interface TrackerState {
  trackers: Tracker[]
  hasOrg: boolean | null
  loading: boolean
  reload: () => Promise<void>
}

export const useTrackerStore = create<TrackerState>()(
  persist(
    (set) => ({
      trackers: [],
      hasOrg: null,
      loading: false,

      reload: async () => {
        set({ loading: true })
        try {
          const me = await getOrgMe()
          const hasOrg = !!me.org
          set({
            hasOrg,
            trackers: hasOrg ? await listTrackers() : [],
          })
        } finally {
          set({ loading: false })
        }
      },
    }),
    {
      name: 'tracker-store',
      partialize: (s) => ({
        trackers: s.trackers,
        hasOrg: s.hasOrg,
      }),
    },
  ),
)
