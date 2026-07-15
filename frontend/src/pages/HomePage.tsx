import { useEffect, useRef, useState } from 'react'
import { useAudioRecorder } from '../hooks/useAudioRecorder'
import { useNavigate } from 'react-router-dom'
import { getAllJobs, getAllFolders, uploadFile, deleteJob } from '../api/client'
import { useAppStore } from '../store/useAppStore'
import FolderTree from '../components/FolderTree'
import type { JobResponse } from '../types/api'
import logo from '../assets/DissertationLogoV1.svg'
import micIcon from '../assets/mic_icon.svg'
import { ANNOUNCEMENT_COLOURS, ANNOUNCEMENT_FALLBACK } from '../utils/announcementColours'

function LeftSidebarIcon({ open }: { open: boolean }) {
    return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            {/* outer rounded rectangle (the "window") */}
            <rect x="3" y="3" width="18" height="18" rx="2" />
            {/* vertical divider that separates the sidebar panel from the main area */}
            <line x1="9" y1="3" x2="9" y2="21" />
            {/* when open, fill the left panel to show it's active */}
            {open && (
                <rect x="3" y="3" width="6" height="18" rx="2" fill="currentColor" />
            )}
        </svg>
    )
}

function RightSidebarIcon({ open }: { open: boolean }) {
    return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <line x1="15" y1="3" x2="15" y2="21" />
            {open && (
                <rect x="15" y="3" width="6" height="18" rx="2" fill="currentColor" />
            )}
        </svg>
    )
}

function timeAgo(isoString: string): string {
    const seconds = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000)
    if (seconds < 60) return `${seconds}s ago`
    if (seconds < 3600) return `${Math.floor(seconds / 60)} mins ago`
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`
    return `${Math.floor(seconds / 86400)} days ago`
}


function StatusIcon({ status }: { status: string }) {
    if (status === 'done') return (
        <div className="w-8 h-8 rounded-full border-2 border-green-500 flex items-center justify-center shrink-0">
            <span className="text-green-500 text-sm">✓</span>
        </div>
    )
    if (status === 'failed') return (
        <div className="w-8 h-8 rounded-full border-2 border-red-500 flex items-center justify-center shrink-0">
            <span className="text-red-500 text-sm">✕</span>
        </div>
    )
    return (
        <div className="w-8 h-8 rounded-full border-2 border-orange-400 border-t-transparent animate-spin shrink-0" />
    )
}

function RecentAnnouncements() {
    const { allJobs } = useAppStore()

    const allAnnouncements = allJobs
        .filter(j => j.status === 'done' && j.result?.notes_structured?.announcements?.length)
        .flatMap(j => j.result!.notes_structured!.announcements.map(a => ({
            ...a,
            jobFilename: j.filename ?? j.job_id
        })))

    return (
        <div className="w-64 border-l border-gray-800 flex flex-col h-full shrink-0">

            <div className="p-4 border-b border-gray-800">
                <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-widest">
                    Recent Announcements
                </h2>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {allAnnouncements.length === 0 ? (
                    <p className="text-gray-700 text-sm">
                        Announcements from completed notes appear here.
                    </p>
                ) : (
                    allAnnouncements.map((a, i) => (
                        <div key={i} className="space-y-1">
                            <div className="flex items-center gap-2 flex-wrap">
                                {a.type && (
                                    <span className={`text-xs px-2 py-0.5 rounded font-medium
                                        ${ANNOUNCEMENT_COLOURS[a.type] ?? ANNOUNCEMENT_FALLBACK}`}>
                                        {a.type}
                                    </span>
                                )}
                                <span className="text-gray-600 text-xs truncate">
                                    {a.jobFilename}
                                </span>
                            </div>
                            <p className="text-gray-300 text-sm leading-snug">{a.text}</p>
                        </div>
                    ))
                )}
            </div>

        </div>
    )
}


export default function HomePage() {

    const navigate = useNavigate()
    const { allJobs, setAllJobs, setFolders,
        setAudioSrc, setJobData,
        leftSidebarOpen: leftOpen, rightSidebarOpen: rightOpen,
        setLeftSidebarOpen, setRightSidebarOpen } = useAppStore()

    const [dragging, setDragging] = useState(false)
    const [uploading, setUploading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [recordingName, setRecordingName] = useState('untitled')
    const inputRef = useRef<HTMLInputElement>(null)
    const zoneRef = useRef<HTMLDivElement>(null)
    const recorder = useAudioRecorder()

    // Option C - Escape key
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && recorder.phase !== 'idle') {
                recorder.cancelAll()
            }
        }
        document.addEventListener('keydown', handleKeyDown)
        return () => document.removeEventListener('keydown', handleKeyDown)
    }, [recorder.phase, recorder.cancelAll])

    // Option B - Click outside
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (recorder.phase !== 'idle' && zoneRef.current && !zoneRef.current.contains(e.target as Node)) {
                recorder.cancelAll()
            }
        }
        document.addEventListener('mousedown', handleClickOutside)
        return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [recorder.phase, recorder.cancelAll])

    const formatTime = (s: number) => {
        const m = Math.floor(s / 60).toString().padStart(2, '0')
        const sec = (s % 60).toString().padStart(2, '0')
        return `${m}:${sec}`
    }

    const handleRecordingUpload = async () => {
        if (!recorder.recordedBlob) return
        const extension = recorder.recordedBlob.type.includes('mp4') ? 'mp4' : 'webm'
        const safeName = recordingName.trim() || 'untitled'
        const file = new File([recorder.recordedBlob], `${safeName}.${extension}`, {
            type: recorder.recordedBlob.type,
        })
        recorder.cancelAll()
        await handleFile(file)
    }

    // Fetch all jobs and folders on load, polls every 4 seconds
    useEffect(() => {
        const load = async () => {
            const [jobs, foldersData] = await Promise.all([
                getAllJobs(),
                getAllFolders()
            ])
            setAllJobs(jobs)
            setFolders(foldersData)
        }
        load()
        const interval = setInterval(load, 4000)
        return () => clearInterval(interval)
    }, [])

    // Called when a file is dropped or selected
    const handleFile = async (file: File) => {
        setUploading(true)
        setError(null)
        try {
            const src = URL.createObjectURL(file)
            setAudioSrc(src)
            await uploadFile(file)
            const jobs = await getAllJobs()
            setAllJobs(jobs)
        } catch {
            setError('Upload failed - is the backend running?')
        } finally {
            setUploading(false)
        }
    }

    // Called when user drops a file onto the upload zone
    const onDrop = (e: React.DragEvent) => {
        e.preventDefault()
        setDragging(false)
        const file = e.dataTransfer.files[0]
        if (file) handleFile(file)
    }

    // Called when clicking a completed job row - navigate to its notes
    const handleJobClick = (job: JobResponse) => {
        if (job.status !== 'done') return
        setJobData(job)
        navigate(`/jobs/${job.job_id}/notes`)
    }

    // Called when clicking the delete button on a job row
    const handleDelete = async (e: React.MouseEvent, jobId: string) => {
        e.stopPropagation()
        await deleteJob(jobId)
        setAllJobs(allJobs.filter(j => j.job_id !== jobId))
    }

    const visibleJobs = allJobs

    return (
        <div className="h-screen flex overflow-hidden bg-gray-950 text-white">

            {/* Backdrop - blocks clicks and blurs content when recording/reviewing */}
            {recorder.phase !== 'idle' && recorder.phase !== 'requesting' && (
                <div
                    className="absolute inset-0 z-10 bg-gray-950/60 backdrop-blur-[2px]"
                    onClick={(e) => e.stopPropagation()}
                />
            )}

            <div className={`transition-all duration-300 overflow-hidden shrink-0 ${leftOpen ? 'w-64' : 'w-0'}`}>
                <FolderTree />
            </div>

            <div className="flex-1 flex flex-col overflow-hidden">

                {/* Sidebar toggle bar */}
                <div className="shrink-0 flex items-center justify-between px-4 pt-3">
                    <button
                        onClick={() => setLeftSidebarOpen(!leftOpen)}
                        title={leftOpen ? 'Collapse folders' : 'Expand folders'}
                        className="text-gray-600 hover:text-white transition-colors"
                    >
                        <LeftSidebarIcon open={leftOpen} />
                    </button>

                    <button
                        onClick={() => setRightSidebarOpen(!rightOpen)}
                        title={rightOpen ? 'Collapse announcements' : 'Expand announcements'}
                        className="text-gray-600 hover:text-white transition-colors"
                    >
                        <RightSidebarIcon open={rightOpen} />
                    </button>
                </div>


                <div className='shrink-0 text-center pt-0 pb-6'>
                    <div className='text-6xl'>
                        <img src={logo} alt="Note Generator logo" className="w-38 h-38 mx-auto" />
                    </div>
                    <h1 className='text-3xl font-bold text-white'>
                        Lectern
                    </h1>
                    <p className='text-gray-500 mt-1 mb-3'>
                        Upload to generate structured notes
                    </p>
                </div>

                <div className='px-12 shrink-0 max-w-3xl mx-auto w-full mt-3 mb-4 relative z-20'>
                    <div
                        ref={zoneRef}
                        onClick={() => {
                            if (recorder.phase !== 'idle') return
                            if (!uploading) inputRef.current?.click()
                        }}
                        onDragOver={(e) => { e.preventDefault(); if (recorder.phase === 'idle') setDragging(true) }}
                        onDragLeave={() => setDragging(false)}
                        onDrop={(e) => { if (recorder.phase === 'idle') onDrop(e) }}
                        className={`relative border-2 border-dashed rounded-2xl p-8 text-center transition-colors h-[220px] flex flex-col items-center justify-center
                            transition-colors
                            ${recorder.phase === 'recording' ? 'border-red-500 bg-red-950/20 cursor-default' : ''}
                            ${recorder.phase === 'review' ? 'border-green-500 bg-green-950/20 cursor-default' : ''}
                            ${recorder.phase === 'requesting' ? 'border-gray-700 cursor-wait' : ''}
                            ${recorder.phase === 'idle' && uploading ? 'opacity-50 cursor-not-allowed border-gray-700' : ''}
                            ${recorder.phase === 'idle' && !uploading && dragging ? 'border-blue-400 bg-blue-950/20 cursor-pointer' : ''}
                            ${recorder.phase === 'idle' && !uploading && !dragging ? 'border-gray-700 hover:border-gray-500 cursor-pointer' : ''}`}
                    >

                        {/* The hidden file input stays regardless of phase */}
                        <input
                            ref={inputRef}
                            type="file"
                            accept="audio/*,video/*"
                            className="hidden"
                            onChange={(e) => {
                                const f = e.target.files?.[0]
                                if (f) handleFile(f)
                            }}
                        />

                        {/* IDLE PHASE */}
                        {(recorder.phase === 'idle' || recorder.phase === 'requesting') && (
                            <>
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation()
                                        recorder.startRecording()
                                    }}
                                    className='absolute top-4 right-4 text-gray-600 hover:text-white transition-colors hover:scale-115 transition-transform duration-150'
                                >
                                    <img src={micIcon} alt="Record" className="w-7 h-7" />
                                </button>

                                <p className='text-gray-300 text-lg'>
                                    {recorder.phase === 'requesting'
                                        ? 'Waiting for microphone permission...'
                                        : 'Drag & drop, click or record to upload'}
                                </p>

                                <p className='text-gray-600 text-sm mt-1'>
                                    {recorder.phase === 'requesting' ? '' : 'MP3, MP4, WAV, M4A, MOV'}
                                </p>

                                {recorder.error && (
                                    <p className="text-red-400 text-sm mt-2">{recorder.error}</p>
                                )}
                            </>
                        )}

                        {/* RECORDING PHASE */}
                        {recorder.phase === 'recording' && (
                            <div className="flex flex-col items-center gap-4 py-4">

                                {/* Waveform bars */}
                                <div className="flex items-end gap-1.5 h-10">
                                    {recorder.barHeights.map((h, i) => (
                                        <div
                                            key={i}
                                            className="w-2.5 bg-red-500 rounded-full"
                                            style={{ height: `${h}px` }}
                                        />
                                    ))}
                                </div>

                                {/* Pulsing dot + timer */}
                                <div className="flex items-center gap-2">
                                    <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
                                    <span className="text-red-400 font-mono text-lg font-semibold tracking-widest">
                                        {formatTime(recorder.timerSeconds)}
                                    </span>
                                </div>

                                <button
                                    onClick={(e) => {
                                        e.stopPropagation()
                                        recorder.stopRecording()
                                    }}
                                    className="w-10 h-10 flex items-center justify-center rounded-full
                                            bg-red-600 hover:bg-red-700 transition-colors"
                                    title="Stop recording"
                                >
                                    <svg
                                        width="14"
                                        height="14"
                                        viewBox="0 0 14 14"
                                        fill="currentColor"
                                        xmlns="http://www.w3.org/2000/svg"
                                    >
                                        <rect width="14" height="14" rx="2" fill="white" />
                                    </svg>
                                </button>

                            </div>
                        )}

                        {/* REVIEW PHASE */}
                        {recorder.phase === 'review' && (
                            <div className="flex flex-col items-center gap-2 py-1 w-full">

                                <p className="text-gray-200 mb-1 text-sm font-medium">Review, name, and upload your recording</p>

                                <input
                                    type="text"
                                    value={recordingName}
                                    onChange={(e) => setRecordingName(e.target.value)}
                                    onClick={(e) => e.stopPropagation()}
                                    placeholder="Name your recording..."
                                    className="w-full max-w-sm bg-gray-800 text-white text-sm px-3 py-2
                                            rounded-xl border border-gray-600 outline-none focus:border-gray-400
                                            transition-colors mb-2"
                                />

                                {recorder.previewUrl && (
                                    <audio
                                        src={recorder.previewUrl}
                                        controls
                                        className="w-full max-w-sm"
                                        onClick={(e) => e.stopPropagation()}
                                    />
                                )}

                                <div className="flex gap-4 items-center mt-4">

                                    {/* Re-record - red circular arrow */}
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation()
                                            setRecordingName('untitled')
                                            recorder.resetRecording()
                                        }}
                                        title="Re-record"
                                        className="w-10 h-10 flex items-center justify-center rounded-full
                                                bg-red-700 hover:bg-red-800 transition-colors"
                                    >
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                                            stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                                            <path d="M3 3v5h5" />
                                        </svg>
                                    </button>

                                    {/* Upload - green upload arrow */}
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation()
                                            handleRecordingUpload()
                                        }}
                                        disabled={uploading}
                                        title="Upload recording"
                                        className="w-10 h-10 flex items-center justify-center rounded-full
                                                bg-green-600 hover:bg-green-700 transition-colors disabled:opacity-50"
                                    >
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                                            stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                            <polyline points="17 8 12 3 7 8" />
                                            <line x1="12" y1="3" x2="12" y2="15" />
                                        </svg>
                                    </button>

                                </div>

                            </div>
                        )}

                    </div>
                    {error && (
                        <p className="text-red-400 text-sm mt-2 text-center">{error}</p>
                    )}
                </div>

                <div className='flex-1 overflow-y-auto px-12 mt-8'>

                    <div className='max-w-4xl mx-auto w-full'>

                        <h2 className='text-xs font-semibold text-gray-500 uppercase tracking-widest mb-4'>
                            Recent Uploads
                        </h2>

                        {visibleJobs.length === 0 && (
                            <p className="text-gray-700 text-sm text-center mt-12">
                                No uploads yet - drop a lecture recording above.
                            </p>
                        )}

                        {visibleJobs.map(job => (
                            <div
                                key={job.job_id}
                                onClick={() => handleJobClick(job)}
                                className={`flex items-center justify-between py-4 border-b border-gray-800
                                    transition-colors px-3 rounded-lg
                                    ${job.status === 'done'
                                        ? 'cursor-pointer hover:bg-gray-900/50'
                                        : 'cursor-default'}`}
                            >
                                <div>
                                    <p className="text-white text-sm font-medium">
                                        {job.filename ?? job.job_id}
                                    </p>
                                    <p className="text-gray-500 text-xs mt-0.5">
                                        Uploaded {timeAgo(job.created_at)}
                                    </p>
                                </div>
                                <div className="flex items-center gap-3">
                                    <span className="text-gray-400 text-sm">
                                        {job.status === 'queued' && 'Pending'}
                                        {job.status === 'processing' && 'Processing'}
                                        {job.status === 'done' && 'Complete'}
                                        {job.status === 'failed' && 'Processing failed'}
                                    </span>
                                    <StatusIcon status={job.status} />
                                    <button
                                        onClick={(e) => handleDelete(e, job.job_id)}
                                        className="text-gray-700 hover:text-red-400 text-sm transition-colors"
                                    >
                                        ✕
                                    </button>
                                </div>
                            </div>
                        ))}

                    </div>

                </div>

            </div>

            <div className={`transition-all duration-300 overflow-hidden shrink-0 ${rightOpen ? 'w-64' : 'w-0'}`}>
                <RecentAnnouncements />
            </div>

        </div>
    )
}