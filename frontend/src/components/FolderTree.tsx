import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
    DndContext, useDraggable, useDroppable, DragOverlay,
    PointerSensor, useSensor, useSensors,
    type DragStartEvent, type DragEndEvent,
} from '@dnd-kit/core'
import {
    createFolder, deleteFolder, renameFolder,
    moveJobToFolder, getAllFolders, getAllJobs,
} from '../api/client'
import { useAppStore } from '../store/useAppStore'
import { buildFolderTree, buildFolderPaths, RECENTS_ID, type TreeNode }
    from '../utils/buildFolderTree'
import type { JobResponse } from '../types/api'
import { getFolderColor, type FolderColor } from '../utils/folderColours'

// icons
function Chevron({ open }: { open: boolean }) {
    return (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"
            style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 120ms' }}>
            <polyline points="9 18 15 12 9 6" />
        </svg>
    )
}

function FolderIcon() {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2z" />
        </svg>
    )
}

function NoteIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
        </svg>
    )
}

function RecentsIcon() {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
        </svg>
    )
}

// move to menu
function MoveToMenu({
    job, onClose, onMoved,
}: {
    job: JobResponse
    onClose: () => void
    onMoved: () => void
}) {
    const { folders } = useAppStore()
    const ref = useRef<HTMLDivElement>(null)
    const paths = buildFolderPaths(folders)
        .filter(({ folder }) => folder.folder_id !== job.folder_id)

    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) onClose()
        }
        document.addEventListener('mousedown', handler)
        return () => document.removeEventListener('mousedown', handler)
    }, [onClose])

    const move = async (folderId: string | null) => {
        await moveJobToFolder(job.job_id, folderId)
        onMoved()
        onClose()
    }

    return (
        <div ref={ref} className="absolute right-0 top-full mt-1 w-48 bg-gray-900
                                  border border-gray-700 rounded-lg shadow-lg overflow-hidden z-30">
            <div className="px-3 py-1.5 text-xs text-gray-500 uppercase tracking-wider
                            border-b border-gray-800">Move to</div>
            <div className="max-h-64 overflow-y-auto">
                {job.folder_id !== null && (
                    <button onClick={() => move(null)}
                        className="w-full text-left px-3 py-1.5 text-sm text-gray-300
                                   hover:bg-gray-800 hover:text-white transition-colors">
                        Recents
                    </button>
                )}
                {paths.map(({ folder, path }) => (
                    <button key={folder.folder_id} onClick={() => move(folder.folder_id)}
                        className="w-full text-left px-3 py-1.5 text-sm text-gray-300
                                   hover:bg-gray-800 hover:text-white transition-colors truncate">
                        {path}
                    </button>
                ))}
                {paths.length === 0 && job.folder_id === null && (
                    <div className="px-3 py-2 text-xs text-gray-600">No folders yet</div>
                )}
            </div>
        </div>
    )
}

// single note row
function NoteRow({
    job, depth, onMoved, inRecents = false, rootColor,
}: {
    job: JobResponse
    depth: number
    onMoved: () => void
    inRecents?: boolean
    rootColor: FolderColor | null
}) {
    const navigate = useNavigate()
    const { jobId: activeJobId } = useParams<{ jobId: string }>()
    const [menuOpen, setMenuOpen] = useState(false)
    const isActive = job.job_id === activeJobId

    const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
        id: `job:${job.job_id}`,
        data: { jobId: job.job_id },
    })

    // Notes inside a coloured group take the dim tint; Recents and loose notes stay grey.
    const iconClass = rootColor ? rootColor.subIcon : 'text-gray-600'
    const textClass = 'text-gray-400'   // file name stays grey as you wanted

    return (
        <div
            ref={setNodeRef} {...attributes} {...listeners}
            onClick={() => navigate(`/jobs/${job.job_id}/notes`)}
            style={{
                paddingLeft: inRecents ? '12px' : `${12 + depth * 16}px`,
                opacity: isDragging ? 0.4 : 1,
            }}
            className={`group flex items-center gap-2 pr-2 py-1 rounded cursor-pointer text-sm
                ${isActive
                    ? 'bg-gray-800 text-white'
                    : `${textClass} hover:text-white hover:bg-gray-800`}`}
        >
            <span className={`shrink-0 ${iconClass}`}><NoteIcon /></span>
            <span className="truncate flex-1">{job.filename ?? job.job_id}</span>
            <div className="relative shrink-0">
                <button onClick={(e) => { e.stopPropagation(); setMenuOpen(o => !o) }}
                    className="opacity-0 group-hover:opacity-100 text-gray-600 hover:text-white
                            transition-opacity px-1">
                    ⋯
                </button>
                {menuOpen && (
                    <MoveToMenu job={job} onClose={() => setMenuOpen(false)} onMoved={onMoved} />
                )}
            </div>
        </div>
    )
}

// folder row + recursive subtree
function FolderNode({
    node, depth, refetch,
    renamingId, setRenamingId,
    creatingUnder, setCreatingUnder,
    rootColor,
}: {
    node: TreeNode
    depth: number
    refetch: () => void
    renamingId: string | null
    setRenamingId: (id: string | null) => void
    creatingUnder: string | null
    setCreatingUnder: (id: string | null) => void
    rootColor: FolderColor | null
}) {
    const { expandedFolderIds, toggleFolderExpanded } = useAppStore()
    const [menuOpen, setMenuOpen] = useState(false)
    const [renameValue, setRenameValue] = useState(node.folder.name)
    const [newName, setNewName] = useState('')
    const menuRef = useRef<HTMLDivElement>(null)

    const isOpen = expandedFolderIds.has(node.folder.folder_id)
    const isRenaming = renamingId === node.folder.folder_id
    const isCreatingHere = creatingUnder === node.folder.folder_id
    const totalCount = countNotes(node)

    useEffect(() => {
        if (!menuOpen) return
        const handler = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
        }
        document.addEventListener('mousedown', handler)
        return () => document.removeEventListener('mousedown', handler)
    }, [menuOpen])

    const commitRename = async () => {
        const v = renameValue.trim()
        if (v && v !== node.folder.name) {
            await renameFolder(node.folder.folder_id, v)
            refetch()
        }
        setRenamingId(null)
    }

    const commitCreate = async () => {
        const v = newName.trim()
        if (v) {
            await createFolder(v, node.folder.folder_id)
            refetch()
        }
        setNewName('')
        setCreatingUnder(null)
    }

    const handleDelete = async () => {
        await deleteFolder(node.folder.folder_id)
        refetch()
        setMenuOpen(false)
    }

    const dropTargetId = node.isRecents ? RECENTS_ID : node.folder.folder_id
    const { setNodeRef: setDropRef, isOver } = useDroppable({
        id: `folder:${dropTargetId}`,
        data: { folderId: node.isRecents ? null : node.folder.folder_id },
    })

    useEffect(() => {
        if (!isOver || isOpen || node.isRecents) return
        const t = setTimeout(() => toggleFolderExpanded(node.folder.folder_id), 600)
        return () => clearTimeout(t)
    }, [isOver, isOpen])

    // Folder name: always the text tint, at every depth.
    const ownTextClass = rootColor?.text ?? 'text-gray-300'

    // Folder icon: matches the name at depth 0 (top-level), switches to the darker
    // subIcon tint at depth > 0 (nested folders).
    const ownIconClass = rootColor
        ? (depth === 0 ? rootColor.text : rootColor.subIcon)
        : 'text-gray-600'

    // Chevron + count: small utility bits. Using subIcon keeps them quieter than
    // the folder name - the name stays the focal point.
    const chevronClass = rootColor?.subIcon ?? 'text-gray-600'
    const countClass = rootColor?.subIcon ?? 'text-gray-500'

    // Bar: only the outermost wrapper gets it, inset from the sidebar edge, softly rounded.
    const wrapperClass = node.isRecents
        ? 'border-b border-gray-800 pb-3 mb-3 mx-3'
        : depth === 0 && rootColor
            ? `border-l-2 ${rootColor.bar} ml-2 rounded-l`
            : ''

    return (
        <div className={wrapperClass}>
            <div
                ref={setDropRef}
                onClick={() => {
                    if (node.isRecents) return
                    toggleFolderExpanded(node.folder.folder_id)
                }}
                onDoubleClick={(e) => {
                    if (node.isRecents) return
                    e.stopPropagation()
                    setRenameValue(node.folder.name)
                    setRenamingId(node.folder.folder_id)
                }}
                style={node.isRecents ? undefined : { paddingLeft: `${12 + depth * 16}px` }}
                className={`group flex items-center py-1.5 rounded cursor-pointer text-sm
                            hover:bg-gray-800
                            ${node.isRecents ? 'justify-center gap-2 text-gray-400' : 'gap-1.5 pr-2'}
                            ${isOver ? 'bg-gray-800 ring-1 ring-white/50' : ''}`}
            >
                {!node.isRecents && (
                    <span className={`shrink-0 w-3 flex justify-center ${chevronClass}`}>
                        <Chevron open={isOpen} />
                    </span>
                )}
                <span className={`shrink-0 ${node.isRecents ? 'text-gray-400' : ownIconClass}`}>
                    {node.isRecents ? <RecentsIcon /> : <FolderIcon />}
                </span>

                {isRenaming ? (
                    <input autoFocus
                        value={renameValue}
                        onChange={e => setRenameValue(e.target.value)}
                        onClick={e => e.stopPropagation()}
                        onKeyDown={e => {
                            e.stopPropagation()
                            if (e.key === 'Enter') commitRename()
                            if (e.key === 'Escape') setRenamingId(null)
                        }}
                        onBlur={commitRename}
                        className="flex-1 bg-gray-800 text-white text-sm px-1.5 py-0
                                   rounded border border-gray-600 outline-none min-w-0"
                    />
                ) : (
                    <>
                        <span className={`truncate font-semibold ${node.isRecents ? '' : 'flex-1'} ${ownTextClass}`}>
                            {node.folder.name}
                        </span>
                        {!node.isRecents && totalCount > 0 && (
                            <span className={`text-xs shrink-0 ${countClass}`}>{totalCount}</span>
                        )}
                    </>
                )}

                {!node.isRecents && !isRenaming && (
                    <div className="relative shrink-0" ref={menuRef}>
                        <button onClick={(e) => { e.stopPropagation(); setMenuOpen(o => !o) }}
                            className="opacity-0 group-hover:opacity-100 text-gray-600 hover:text-white
                                       transition-opacity px-1">
                            ⋯
                        </button>
                        {menuOpen && (
                            <div className="absolute right-0 top-full mt-1 w-44 bg-gray-900 border
                                            border-gray-700 rounded-lg shadow-lg overflow-hidden z-30">
                                <button onClick={(e) => {
                                    e.stopPropagation()
                                    setMenuOpen(false)
                                    setCreatingUnder(node.folder.folder_id)
                                    if (!isOpen) toggleFolderExpanded(node.folder.folder_id)
                                }}
                                    className="w-full text-left px-3 py-1.5 text-sm text-gray-300
                                               hover:bg-gray-800 hover:text-white transition-colors">
                                    New subfolder
                                </button>
                                <button onClick={(e) => {
                                    e.stopPropagation()
                                    setMenuOpen(false)
                                    setRenameValue(node.folder.name)
                                    setRenamingId(node.folder.folder_id)
                                }}
                                    className="w-full text-left px-3 py-1.5 text-sm text-gray-300
                                               hover:bg-gray-800 hover:text-white transition-colors">
                                    Rename
                                </button>
                                <button onClick={(e) => { e.stopPropagation(); handleDelete() }}
                                    className="w-full text-left px-3 py-1.5 text-sm text-red-400
                                               hover:bg-gray-800 hover:text-red-300 transition-colors">
                                    Delete
                                </button>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {isOpen && (
                <div>
                    {node.children.map(child => (
                        <FolderNode key={child.folder.folder_id} node={child} depth={depth + 1}
                            refetch={refetch}
                            renamingId={renamingId} setRenamingId={setRenamingId}
                            creatingUnder={creatingUnder} setCreatingUnder={setCreatingUnder}
                            rootColor={rootColor} />
                    ))}
                    {isCreatingHere && (
                        <div style={{ paddingLeft: `${12 + (depth + 1) * 16}px` }}
                            className="py-1 pr-2">
                            <input autoFocus
                                value={newName}
                                onChange={e => setNewName(e.target.value)}
                                onKeyDown={e => {
                                    if (e.key === 'Enter') commitCreate()
                                    if (e.key === 'Escape') { setNewName(''); setCreatingUnder(null) }
                                }}
                                onBlur={() => { if (!newName.trim()) setCreatingUnder(null); else commitCreate() }}
                                placeholder="Folder name..."
                                className="w-full bg-gray-800 text-white text-sm px-1.5 py-0.5
                                           rounded border border-gray-600 outline-none"
                            />
                        </div>
                    )}
                    {node.jobs.map(job => (
                        <NoteRow key={job.job_id} job={job} depth={depth + 1}
                            onMoved={refetch} inRecents={node.isRecents}
                            rootColor={rootColor} />
                    ))}
                </div>
            )}
        </div>
    )
}

// helpers
function countNotes(node: TreeNode): number {
    return node.jobs.length + node.children.reduce((sum, c) => sum + countNotes(c), 0)
}

// main export
export default function FolderTree() {
    const { folders, allJobs, setFolders, setAllJobs } = useAppStore()
    const [renamingId, setRenamingId] = useState<string | null>(null)
    const [creatingUnder, setCreatingUnder] = useState<string | null>(null)
    const [creatingRootName, setCreatingRootName] = useState('')
    const [creatingRoot, setCreatingRoot] = useState(false)
    const [draggingJob, setDraggingJob] = useState<JobResponse | null>(null)

    const expandFolders = useAppStore(s => s.expandFolders)

    useEffect(() => {
        expandFolders([RECENTS_ID])
    }, [])

    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
    )

    const refetch = async () => {
        const [foldersData, jobs] = await Promise.all([getAllFolders(), getAllJobs()])
        setFolders(foldersData)
        setAllJobs(jobs)
    }

    const tree = buildFolderTree(folders, allJobs)

    const commitCreateRoot = async () => {
        const v = creatingRootName.trim()
        if (v) {
            await createFolder(v)
            await refetch()
        }
        setCreatingRootName('')
        setCreatingRoot(false)
    }

    const handleDragStart = (e: DragStartEvent) => {
        const jobId = e.active.data.current?.jobId
        if (!jobId) return
        const job = allJobs.find(j => j.job_id === jobId)
        setDraggingJob(job ?? null)
    }

    const handleDragEnd = async (e: DragEndEvent) => {
        setDraggingJob(null)
        if (!e.over) return
        const jobId = e.active.data.current?.jobId
        const targetFolderId = e.over.data.current?.folderId  // null for Recents
        if (!jobId) return
        const job = allJobs.find(j => j.job_id === jobId)
        // No-op if dropped onto current parent
        if (job && job.folder_id === (targetFolderId ?? null)) return
        await moveJobToFolder(jobId, targetFolderId ?? null)
        await refetch()
    }

    return (
        <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
            <div className="w-64 border-r border-gray-800 flex flex-col h-full bg-gray-950 shrink-0">
                <div className="p-3 border-b border-gray-800 flex items-center justify-between">
                    <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-widest">
                        Folders
                    </h2>
                    <button onClick={() => setCreatingRoot(true)}
                        title="New folder"
                        className="text-gray-500 hover:text-white transition-colors text-lg leading-none">
                        +
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto py-2">
                    {creatingRoot && (
                        <div style={{ paddingLeft: '12px' }} className="py-1 pr-3">
                            <input autoFocus
                                value={creatingRootName}
                                onChange={e => setCreatingRootName(e.target.value)}
                                onKeyDown={e => {
                                    if (e.key === 'Enter') commitCreateRoot()
                                    if (e.key === 'Escape') {
                                        setCreatingRootName('')
                                        setCreatingRoot(false)
                                    }
                                }}
                                onBlur={() => {
                                    if (!creatingRootName.trim()) setCreatingRoot(false)
                                    else commitCreateRoot()
                                }}
                                placeholder="Folder name..."
                                className="w-full bg-gray-800 text-white text-sm px-1.5 py-0.5
                                           rounded border border-gray-600 outline-none"
                            />
                        </div>
                    )}
                    {(() => {
                        let colorIndex = 0
                        return tree.map(node => {
                            const rootColor = node.isRecents
                                ? null
                                : getFolderColor(colorIndex++)
                            return (
                                <FolderNode key={node.folder.folder_id} node={node} depth={0}
                                    refetch={refetch}
                                    renamingId={renamingId} setRenamingId={setRenamingId}
                                    creatingUnder={creatingUnder} setCreatingUnder={setCreatingUnder}
                                    rootColor={rootColor} />
                            )
                        })
                    })()}
                </div>
            </div>

            <DragOverlay>
                {draggingJob && (
                    <div className="bg-gray-800 text-white text-sm px-3 py-1.5 rounded border
                                    border-gray-600 shadow-lg flex items-center gap-2 max-w-xs">
                        <span className="text-gray-500"><NoteIcon /></span>
                        <span className="truncate">{draggingJob.filename ?? draggingJob.job_id}</span>
                    </div>
                )}
            </DragOverlay>
        </DndContext>
    )
}