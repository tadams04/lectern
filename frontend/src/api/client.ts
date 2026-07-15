import type { JobResponse } from '../types/api'
import type { Folder } from '../types/api'

export async function uploadFile(file: File): Promise<{ job_id: string }> {
    const form = new FormData()
    form.append('file', file)
    const res = await fetch('/api/upload', {
        method: 'POST',
        body: form,
    })
    if (!res.ok) throw new Error(`Upload failed: ${res.status}`)
    return res.json()
}

export async function getJob(jobId: string): Promise<JobResponse> {
    const res = await fetch(`/api/jobs/${jobId}`)
    if (!res.ok) throw new Error(`Job fetch failed: ${res.status}`)
    return res.json()
}

export async function getAllJobs(): Promise<JobResponse[]> {
    const res = await fetch('/api/jobs')
    if (!res.ok) throw new Error(`Jobs fetch failed: ${res.status}`)
    return res.json()
}

export async function deleteJob(jobId: string): Promise<void> {
    await fetch(`/api/jobs/${jobId}`, { method: 'DELETE' })
}

export async function moveJobToFolder(jobId: string, folderId: string | null): Promise<void> {
    await fetch(`/api/jobs/${jobId}/folder`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder_id: folderId })
    })
}

export async function getAllFolders(): Promise<Folder[]> {
    const res = await fetch('/api/folders')
    if (!res.ok) throw new Error(`Folders fetch failed: ${res.status}`)
    return res.json()
}

export async function createFolder(name: string, parentId?: string): Promise<{ folder_id: string }> {
    const res = await fetch('/api/folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, parent_id: parentId ?? null })
    })
    return res.json()
}

export async function renameFolder(folderId: string, name: string): Promise<void> {
    await fetch(`/api/folders/${folderId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
    })
}

export async function deleteFolder(folderId: string): Promise<void> {
    await fetch(`/api/folders/${folderId}`, { method: 'DELETE' })
}