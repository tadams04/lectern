from __future__ import annotations

import os

from .asr import transcribe_to_segments
from .models import JobStatus, ResultPayload
from .storage import set_error, set_result, set_status, mark_finished, mark_started
from .preprocessor import preprocess_audio

from .note_generator import generate_structured_notes_chunked


def process_job(job_id: str, file_path: str) -> None:
    """
    Processor for jobs
    """

    try:
        # First, mark job as processing and started
        set_status(job_id, JobStatus.processing)
        mark_started(job_id)

        compressed_path = preprocess_audio(file_path)

        transcript_segments, info = transcribe_to_segments(compressed_path)

        notes_structured = None
        notes_error = None

        try:
            notes_structured = generate_structured_notes_chunked(
                transcript_segments, chunk_seconds=10 * 60, overlap_seconds=30)
        except Exception as e:
            notes_error = str(e)

        payload = ResultPayload(
            transcript_segments=transcript_segments,
            notes_structured=notes_structured,
            notes_error=notes_error,
        )

        set_result(job_id, payload)
        set_status(job_id, JobStatus.done)

    except Exception as e:
        set_error(job_id, str(e))
        set_status(job_id, JobStatus.failed)

    finally:
        mark_finished(job_id)
        try:
            if os.path.exists(file_path):
                os.remove(file_path)
            if os.path.exists(compressed_path):
                os.remove(compressed_path)
        except Exception:
            pass
