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
          const [me, trackers] = await Promise.all([
            getOrgMe(),
            // persist 已缓存 hasOrg 时可并行；首次加载（null）走串行兜底
            (async () => {
              const state = useTrackerStore.getState()
              if (state.hasOrg === true) return listTrackers()
              // hasOrg 为 null/false 时不调 listTrackers
              return [] as never[]
            })(),
          ])
          const hasOrg = !!me.org
          set({
            hasOrg,
            // 若缓存判断为无企业但实际有企业，补拉一次
            trackers: hasOrg && trackers.length === 0 && useTrackerStore.getState().hasOrg === false
              ? await listTrackers()
              : hasOrg ? trackers : [],
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
