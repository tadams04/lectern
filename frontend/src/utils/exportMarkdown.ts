import type { JobResponse, NoteSection, NoteBullet, AnnouncementItem } from '../types/api'

function formatTimestamp(seconds: number): string {
    const m = Math.floor(seconds / 60)
    const s = Math.floor(seconds % 60).toString().padStart(2, '0')
    return `${m}:${s}`
}


function bulletToMarkdown(bullet: NoteBullet): string {
    const aiSuffix = bullet.source === 'unverified_llm' ? ' *(AI — unverified)*' : ''
    return `- ${bullet.text}${aiSuffix}`
}


function sectionToMarkdown(section: NoteSection): string {
    const lines: string[] = []

    lines.push(`## ${section.title}`)
    lines.push('')

    if (section.summary) {
        lines.push(`*${section.summary}*`)
        lines.push('')
    }

    for (const bullet of section.bullets) {
        lines.push(bulletToMarkdown(bullet))
    }

    lines.push('')
    return lines.join('\n')
}


function announcementToMarkdown(a: AnnouncementItem): string {
    const type = a.type ? `**[${a.type}]** ` : ''
    return `- ${type}\`${formatTimestamp(a.timestamp)}\` — ${a.text}`
}


export function jobToMarkdown(job: JobResponse): string {
    const notes = job.result?.notes_structured
    const sections = notes?.sections ?? []
    const announcements = notes?.announcements ?? []

    const lines: string[] = []

    // Document header
    lines.push(`# ${job.filename ?? 'Lecture Notes'}`)
    lines.push('')
    lines.push(`*Generated ${new Date(job.created_at).toLocaleString()}*`)
    lines.push('')
    lines.push('---')
    lines.push('')

    // Sections
    for (const section of sections) {
        lines.push(sectionToMarkdown(section))
    }

    // Announcements (only if there are any)
    if (announcements.length > 0) {
        lines.push('---')
        lines.push('')
        lines.push('## Announcements')
        lines.push('')
        for (const a of announcements) {
            lines.push(announcementToMarkdown(a))
        }
        lines.push('')
    }

    return lines.join('\n')
}


export function downloadMarkdown(job: JobResponse): void {
    const markdown = jobToMarkdown(job)
    const baseName = (job.filename ?? 'lecture-notes').replace(/\.[^/.]+$/, '')
    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)

    const a = document.createElement('a')
    a.href = url
    a.download = `${baseName}.md`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
}