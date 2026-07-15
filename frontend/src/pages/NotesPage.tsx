import { useEffect, useState, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { getJob, getAllFolders } from '../api/client'
import { useAppStore } from '../store/useAppStore'
import { downloadMarkdown } from '../utils/exportMarkdown'
import FolderTree from '../components/FolderTree'
import { getAncestorIds } from '../utils/buildFolderTree'
import type { NoteBullet, NoteSection, AnnouncementItem } from '../types/api'
import { ANNOUNCEMENT_COLOURS, ANNOUNCEMENT_FALLBACK } from '../utils/announcementColours'
import { printToPdf } from '../utils/exportPdf'

import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'

import ReactMarkdown from 'react-markdown'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'

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

function Bullet({ bullet }: { bullet: NoteBullet }) {
    return (
        <li className="flex items-start gap-2 p-2 rounded-lg text-sm text-gray-300">
            <span className="mt-1 text-gray-600 shrink-0">•</span>
            <div className="flex-1 prose prose-invert prose-sm max-w-none">
                <ReactMarkdown
                    remarkPlugins={[remarkMath]}
                    rehypePlugins={[[rehypeKatex, { strict: 'ignore' }]]}
                    components={{
                        code({ className, children, ...props }: any) {
                            const match = /language-(\w+)/.exec(className || '')
                            const isBlock = match !== null
                            return isBlock ? (
                                <SyntaxHighlighter
                                    style={oneDark}
                                    language={match[1]}
                                    PreTag="div"
                                    customStyle={{
                                        borderRadius: '8px',
                                        fontSize: '0.8rem',
                                        margin: '8px 0',
                                    }}
                                >
                                    {String(children).replace(/\n$/, '')}
                                </SyntaxHighlighter>
                            ) : (
                                <code
                                    className="bg-gray-800 px-1 py-0.5 rounded text-blue-300 text-xs"
                                    {...props}
                                >
                                    {children}
                                </code>
                            )
                        },
                    }}
                >
                    {bullet.text}
                </ReactMarkdown>
            </div>
            {bullet.source === 'unverified_llm' && (
                <span className="shrink-0 text-xs bg-amber-900 text-amber-300 px-1.5 py-0.5 rounded font-medium">
                    AI
                </span>
            )}
            {bullet.segment_start != null && (
                <span className="shrink-0 text-xs text-gray-700 tabular-nums">
                    {Math.floor(bullet.segment_start / 60)}:{Math.floor(bullet.segment_start % 60).toString().padStart(2, '0')}
                </span>
            )}
        </li>
    )
}

function SectionCard({ section }: { section: NoteSection }) {
    const [open, setOpen] = useState(true)
    return (
        <div className="mb-4 bg-gray-900 rounded-2xl overflow-hidden border border-gray-800">
            <button
                onClick={() => setOpen(o => !o)}
                className="w-full text-left px-5 py-4 flex justify-between items-center hover:bg-gray-800/50 transition-colors"
            >
                <div className="font-semibold text-white prose prose-invert prose-sm max-w-none">
                    <ReactMarkdown
                        remarkPlugins={[remarkMath]}
                        rehypePlugins={[[rehypeKatex, { strict: 'ignore' }]]}
                        components={{ p: ({ children }) => <span>{children}</span> }}
                    >
                        {section.title}
                    </ReactMarkdown>
                </div>
                <span className="text-gray-600 text-xs ml-4 shrink-0">{open ? '▲' : '▼'}</span>
            </button>
            {open && (
                <div className="px-5 pb-4">
                    {section.summary && (
                        <p className="text-gray-500 text-sm mb-3 italic border-l-2 border-gray-700 pl-3">
                            {section.summary}
                        </p>
                    )}
                    <ul className="space-y-1">
                        {section.bullets.map((b, i) => (
                            <Bullet key={i} bullet={b} />
                        ))}
                    </ul>
                </div>
            )}
        </div>
    )
}

function AnnouncementCard({ item }: { item: AnnouncementItem }) {
    const colourClass = ANNOUNCEMENT_COLOURS[item.type ?? ''] ?? ANNOUNCEMENT_FALLBACK
    const mins = Math.floor(item.timestamp / 60)
    const secs = Math.floor(item.timestamp % 60).toString().padStart(2, '0')

    return (
        <div className="p-3 rounded-xl bg-gray-900 border border-gray-800 mb-2">
            <div className="flex items-center gap-2 mb-1.5">
                {item.type && (
                    <span className={`text-xs px-2 py-0.5 rounded font-medium ${colourClass}`}>
                        {item.type}
                    </span>
                )}
                <span className="text-gray-600 text-xs">
                    {mins}:{secs}
                </span>
            </div>
            <p className="text-gray-300 text-sm leading-snug">{item.text}</p>
        </div>
    )
}

export default function NotesPage() {
    const { jobId } = useParams<{ jobId: string }>()
    const navigate = useNavigate()

    const { jobData, setJobData, folders, setFolders, expandFolders,
        leftSidebarOpen: leftOpen, rightSidebarOpen: rightOpen,
        setLeftSidebarOpen, setRightSidebarOpen } = useAppStore()

    const [exportMenuOpen, setExportMenuOpen] = useState(false)
    const exportMenuRef = useRef<HTMLDivElement>(null)

    // Load job if not already in store
    useEffect(() => {
        if (!jobId || jobData?.job_id === jobId) return
        getJob(jobId).then(setJobData).catch(console.error)
    }, [jobId])

    // Load folders if empty (e.g. deep-link into notes page)
    useEffect(() => {
        if (folders.length === 0) {
            getAllFolders().then(setFolders).catch(console.error)
        }
    }, [])

    // Auto-expand the sidebar tree to reveal the active note
    useEffect(() => {
        if (!jobData?.folder_id || folders.length === 0) return
        const ancestors = getAncestorIds(jobData.folder_id, folders)
        if (ancestors.length > 0) expandFolders(ancestors)
    }, [jobData?.folder_id, folders.length])

    // Close export menu when clicking outside
    useEffect(() => {
        if (!exportMenuOpen) return

        const handleClickOutside = (e: MouseEvent) => {
            if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
                setExportMenuOpen(false)
            }
        }
        document.addEventListener('mousedown', handleClickOutside)
        return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [exportMenuOpen])

    const notes = jobData?.result?.notes_structured
    const sections = notes?.sections ?? []
    const announcements = notes?.announcements ?? []

    return (
        <div className="h-screen bg-gray-950 text-white flex overflow-hidden">

            {/* LEFT SIDEBAR - Folder tree */}
            <div
                className={`transition-all duration-300 overflow-hidden shrink-0 print:hidden
                    ${leftOpen ? 'w-64' : 'w-0'}`}
            >
                <FolderTree />
            </div>

            {/* CENTRE COLUMN */}
            <div className="flex-1 flex flex-col overflow-hidden">

                {/* Sidebar toggle bar */}
                <div className="shrink-0 flex items-center justify-between px-4 pt-3 print:hidden">
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

                {/* Title row */}
                <div className="shrink-0 relative flex items-center justify-center px-4 pt-9 pb-3">
                    <button
                        onClick={() => navigate('/')}
                        className="absolute left-4 text-gray-500 hover:text-white transition-colors text-lg print:hidden"
                    >
                        ←
                    </button>
                    <h1 className="font-bold text-lg">
                        {jobData?.filename?.replace(/\.[^/.]+$/, '') ?? 'Lecture Notes'}
                    </h1>

                    {/* Export dropdown */}
                    <div ref={exportMenuRef} className="absolute right-4 print:hidden">
                        <button
                            onClick={() => setExportMenuOpen(o => !o)}
                            disabled={!jobData?.result?.notes_structured}
                            title="Export"
                            className="text-gray-500 hover:text-white transition-colors p-1
                                    disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                                stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                <polyline points="7 10 12 15 17 10" />
                                <line x1="12" y1="15" x2="12" y2="3" />
                            </svg>
                        </button>

                        {exportMenuOpen && (
                            <div className="absolute right-0 top-full mt-1 w-40 bg-gray-900 border border-gray-700
                                            rounded-lg shadow-lg overflow-hidden z-30">
                                <button
                                    onClick={() => {
                                        if (jobData) downloadMarkdown(jobData)
                                        setExportMenuOpen(false)
                                    }}
                                    className="w-full text-left px-3 py-2 text-sm text-gray-300
                                            hover:bg-gray-800 hover:text-white transition-colors flex items-center gap-2"
                                >
                                    <span className="text-gray-300">Markdown (.md)</span>
                                </button>
                                <button
                                    onClick={() => {
                                        printToPdf()
                                        setExportMenuOpen(false)
                                    }}
                                    className="w-full text-left px-3 py-2 text-sm text-gray-300
                                            hover:bg-gray-800 hover:text-white transition-colors flex items-center gap-2"
                                >
                                    <span className="text-gray-300">PDF (.pdf)</span>
                                </button>
                            </div>
                        )}
                    </div>
                </div>

                {/* Notes content */}
                <main className="flex-1 overflow-y-auto p-6">
                    <div className="max-w-4xl mx-auto">
                        {sections.length === 0 ? (
                            <p className="text-gray-600 mt-8 text-center">No notes available.</p>
                        ) : (
                            sections.map((s, i) => <SectionCard key={i} section={s} />)
                        )}
                    </div>
                </main>
            </div>

            {/* RIGHT SIDEBAR - Announcements for this note */}
            <div
                className={`transition-all duration-300 overflow-hidden shrink-0 border-l border-gray-800 print:hidden
                    ${rightOpen ? 'w-64' : 'w-0'}`}
            >
                <div className="w-64 h-full flex flex-col">
                    <div className="p-4 border-b border-gray-800 shrink-0">
                        <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-widest">
                            Announcements
                        </h2>
                    </div>
                    <div className="flex-1 overflow-y-auto p-4">
                        {announcements.length === 0 ? (
                            <p className="text-gray-700 text-sm">None detected.</p>
                        ) : (
                            announcements.map((a, i) => <AnnouncementCard key={i} item={a} />)
                        )}
                    </div>
                </div>
            </div>
        </div>
    )
}