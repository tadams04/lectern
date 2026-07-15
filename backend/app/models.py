from enum import Enum
from typing import List, Optional

from pydantic import BaseModel, Field


class JobStatus(str, Enum):
    queued = "queued"
    processing = "processing"
    done = "done"
    failed = "failed"


class NoteSource(str, Enum):
    transcript = "transcript"
    unverified_llm = "unverified_llm"


class NoteBullet(BaseModel):
    text: str
    source: NoteSource
    segment_start: Optional[float] = None
    segment_end: Optional[float] = None


class NoteSection(BaseModel):
    title: str
    start: float
    end: float
    summary: Optional[str] = None
    # Added as mutable [] as default risky as shares same instance
    bullets: List[NoteBullet] = Field(default_factory=list)


class AnnouncementItem(BaseModel):
    text: str
    timestamp: float
    type: Optional[str] = None


class TranscriptSegment(BaseModel):
    start: float
    end: float
    text: str


class NotesPayload(BaseModel):
    sections: List[NoteSection] = Field(default_factory=list)
    announcements: List[AnnouncementItem] = Field(default_factory=list)


class AnnouncementExtractionPayload(BaseModel):
    announcements: List[AnnouncementItem] = Field(default_factory=list)


class ResultPayload(BaseModel):
    transcript_segments: List[TranscriptSegment]
    notes_structured: Optional[NotesPayload] = None
    notes_error: Optional[str] = None


class JobResponse(BaseModel):
    job_id: str
    status: JobStatus
    filename: Optional[str] = None
    folder_id: Optional[str] = None

    # timing data
    created_at: str
    started_at: Optional[str] = None
    finished_at: Optional[str] = None
    duration_seconds: Optional[float] = None

    result: Optional[ResultPayload] = None
    error: Optional[str] = None
