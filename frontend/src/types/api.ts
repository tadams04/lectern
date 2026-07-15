export type JobStatus = 'queued' | 'processing' | 'done' | 'failed'
export type NoteSource = 'transcript' | 'unverified_llm'
export type AnnouncementType =
    | 'deadline' | 'task' | 'meeting' | 'resource' | 'admin' | 'error' | null


export interface TranscriptSegment {
    start: number
    end: number
    text: string
}


export interface NoteBullet {
    text: string
    source: NoteSource
    segment_start: number | null
    segment_end: number | null
}


export interface NoteSection {
    title: string
    start: number
    end: number
    summary: string | null
    bullets: NoteBullet[]
}


export interface AnnouncementItem {
    text: string
    timestamp: number
    type: AnnouncementType
}


export interface NotesPayload {
    sections: NoteSection[]
    announcements: AnnouncementItem[]
}


export interface ResultPayload {
    transcript_segments: TranscriptSegment[]
    notes_structured: NotesPayload | null
    notes_error: string | null
}


export interface JobResponse {
    job_id: string
    status: JobStatus
    filename: string | null
    folder_id: string | null
    created_at: string
    started_at: string | null
    finished_at: string | null
    duration_seconds: number | null
    result: ResultPayload | null
    error: string | null
}


export interface Folder {
    folder_id: string
    name: string
    parent_id: string | null
    created_at: string
}