import { create } from 'zustand'
import { createRef } from 'react'
import type { RefObject } from 'react'
import type { JobResponse } from '../types/api'
import type { Folder } from '../types/api'

interface AppStore {
    currentJobId: string | null
    jobData: JobResponse | null
    audioRef: RefObject<HTMLAudioElement | null>
    audioSrc: string | null
    allJobs: JobResponse[]
    folders: Folder[]
    expandedFolderIds: Set<string>
    leftSidebarOpen: boolean
    rightSidebarOpen: boolean

    setJobId: (id: string) => void
    setJobData: (data: JobResponse) => void
    setAudioSrc: (src: string) => void
    seekTo: (seconds: number) => void
    setAllJobs: (jobs: JobResponse[]) => void
    setFolders: (folders: Folder[]) => void
    toggleFolderExpanded: (id: string) => void
    expandFolders: (ids: string[]) => void
    collapseAllFolders: () => void
    setLeftSidebarOpen: (open: boolean) => void
    setRightSidebarOpen: (open: boolean) => void
}

export const useAppStore = create<AppStore>((set, get) => ({
    currentJobId: null,
    jobData: null,
    audioRef: createRef<HTMLAudioElement>(),
    audioSrc: null,
    allJobs: [],
    folders: [],
    expandedFolderIds: new Set<string>(),
    leftSidebarOpen: true,
    rightSidebarOpen: true,

    setJobId: (id) => set({ currentJobId: id }),
    setJobData: (data) => set({ jobData: data }),
    setAudioSrc: (src) => set({ audioSrc: src }),
    setAllJobs: (jobs) => set({ allJobs: jobs }),
    setFolders: (folders) => set({ folders: folders }),
    toggleFolderExpanded: (id) => set((state) => {
        const next = new Set(state.expandedFolderIds)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return { expandedFolderIds: next }
    }),

    expandFolders: (ids) => set((state) => {
        const next = new Set(state.expandedFolderIds)
        ids.forEach(id => next.add(id))
        return { expandedFolderIds: next }
    }),

    collapseAllFolders: () => set({ expandedFolderIds: new Set() }),

    setLeftSidebarOpen: (open) => set({ leftSidebarOpen: open }),
    setRightSidebarOpen: (open) => set({ rightSidebarOpen: open }),

    seekTo: (seconds) => {
        const ref = get().audioRef
        if (ref?.current) {
            ref.current.currentTime = seconds
            ref.current.play()
        }
    },
}))