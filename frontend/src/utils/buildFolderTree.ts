import type { Folder, JobResponse } from '../types/api'

export const RECENTS_ID = '__recents__'

export type TreeNode = {
    folder: Folder         // synthesised Recents folder uses sentinel ID
    children: TreeNode[]
    jobs: JobResponse[]    // jobs sitting directly inside this folder
    isRecents: boolean
}

export function buildFolderTree(
    folders: Folder[],
    jobs: JobResponse[],
): TreeNode[] {
    // Bucket folders by parent_id
    const childrenByParent = new Map<string | null, Folder[]>()
    folders.forEach(f => {
        const key = f.parent_id ?? null
        if (!childrenByParent.has(key)) childrenByParent.set(key, [])
        childrenByParent.get(key)!.push(f)
    })

    // Bucket jobs by folder_id (null jobs go to Recents)
    const jobsByFolder = new Map<string | null, JobResponse[]>()
    jobs.forEach(j => {
        const key = j.folder_id ?? null
        if (!jobsByFolder.has(key)) jobsByFolder.set(key, [])
        jobsByFolder.get(key)!.push(j)
    })

    // Recursively build a real folder's subtree
    const buildNode = (folder: Folder): TreeNode => ({
        folder,
        children: (childrenByParent.get(folder.folder_id) ?? [])
            .sort((a, b) => a.name.localeCompare(b.name))
            .map(buildNode),
        jobs: (jobsByFolder.get(folder.folder_id) ?? [])
            .sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? '')),
        isRecents: false,
    })

    // Recents: synthesised, pinned to top, holds all unfiled jobs
    const recentsNode: TreeNode = {
        folder: {
            folder_id: RECENTS_ID,
            name: 'Recents',
            parent_id: null,
            created_at: '',
        },
        children: [],
        jobs: (jobsByFolder.get(null) ?? [])
            .sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? '')),
        isRecents: true,
    }

    const realRoots = (childrenByParent.get(null) ?? [])
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(buildNode)

    return recentsNode.jobs.length > 0
    ? [recentsNode, ...realRoots]
    : realRoots
}

// Used by the "Move to..." menu - flat list with breadcrumb-style paths
export function buildFolderPaths(folders: Folder[]): Array<{ folder: Folder; path: string }> {
    const byId = new Map(folders.map(f => [f.folder_id, f]))
    const pathFor = (folder: Folder): string => {
        if (!folder.parent_id) return folder.name
        const parent = byId.get(folder.parent_id)
        if (!parent) return folder.name
        return `${pathFor(parent)} / ${folder.name}`
    }
    return folders
        .map(f => ({ folder: f, path: pathFor(f) }))
        .sort((a, b) => a.path.localeCompare(b.path))
}

// Used by NotesPage auto-expand - walks up the parent chain
export function getAncestorIds(folderId: string | null, folders: Folder[]): string[] {
    if (!folderId) return []
    const byId = new Map(folders.map(f => [f.folder_id, f]))
    const ancestors: string[] = []
    let current = byId.get(folderId)
    while (current) {
        ancestors.push(current.folder_id)
        current = current.parent_id ? byId.get(current.parent_id) : undefined
    }
    return ancestors
}