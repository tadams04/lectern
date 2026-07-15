from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Optional
from uuid import uuid4
from supabase import create_client, Client

from .models import JobStatus, ResultPayload


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# Client setup
def get_client() -> Client:
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_KEY")
    if not url or not key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_KEY must be set in .env")
    return create_client(url, key)


# Create job
def create_job(file_path: str, job_id: Optional[str] = None, filename: Optional[str] = None, folder_id: Optional[str] = None) -> str:
    if job_id is None:
        job_id = uuid4().hex

    get_client().table("jobs").insert({
        "job_id": job_id,
        "file_path": file_path,
        "filename": filename,
        "folder_id": folder_id,
        "status": JobStatus.queued.value,
        "result": None,
        "error": None,
        "created_at": utc_now_iso(),
        "started_at": None,
        "finished_at": None,
        "duration_seconds": None,
    }).execute()

    return job_id


# Get job
def get_job(job_id: str) -> Optional[dict]:
    response = get_client().table("jobs").select("*").eq("job_id", job_id).execute()

    if not response.data:
        return None

    row = response.data[0]

    if row.get("result") is not None:
        row["result"] = ResultPayload.model_validate(row["result"])

    return row


def set_status(job_id: str, status: JobStatus) -> None:
    get_client().table("jobs").update({
        "status": status.value
    }).eq("job_id", job_id).execute()


def set_result(job_id: str, result: ResultPayload) -> None:
    get_client().table("jobs").update({
        "result": result.model_dump()
    }).eq("job_id", job_id).execute()


def set_error(job_id: str, error: str) -> None:
    get_client().table("jobs").update({
        "error": error
    }).eq("job_id", job_id).execute()


def mark_started(job_id: str) -> None:
    get_client().table("jobs").update({
        "started_at": utc_now_iso()
    }).eq("job_id", job_id).execute()


def mark_finished(job_id:str) -> None:
    finished = datetime.now(timezone.utc)
    finished_iso = finished.isoformat()

    response = get_client().table("jobs").select("started_at").eq("job_id", job_id).execute()

    duration = None

    if response.data and response.data[0].get("started_at"):
        started = datetime.fromisoformat(response.data[0]["started_at"])
        duration = (finished - started).total_seconds()

    get_client().table("jobs").update({
        "finished_at": finished_iso,
        "duration_seconds": duration,
    }).eq("job_id",job_id).execute()


def delete_job(job_id: str) -> None:
    get_client().table("jobs").delete().eq("job_id", job_id).execute()


def get_all_jobs() -> list:
    response = get_client().table("jobs").select(
        "job_id, filename, status, created_at, duration_seconds, folder_id, result"
    ).order("created_at", desc=True).execute()

    rows = response.data or []
    for row in rows:
        if row.get("result") is not None:
            row["result"] = ResultPayload.model_validate(row["result"])
    return rows


# File/folder storage addition


def create_folder(name: str, parent_id: Optional[str] = None) -> str:
    folder_id = uuid4().hex
    get_client().table("folders").insert({
        "folder_id": folder_id,
        "name": name,
        "parent_id": parent_id,
        "created_at": utc_now_iso(),
    }).execute()
    return folder_id


def get_all_folders() -> list:
    response = get_client().table("folders").select("*").order("name").execute()
    return response.data or []


def rename_folder(folder_id: str, name: str) -> None:
    get_client().table("folders").update({
        "name": name
    }).eq("folder_id", folder_id).execute()


def delete_folder(folder_id: str) -> None:
    # Unassign jobs from this folder first
    get_client().table("jobs").update({
        "folder_id": None
    }).eq("folder_id", folder_id).execute()
    # Then delete folder
    get_client().table("folders").delete().eq("folder_id", folder_id).execute()


def move_job_to_folder(job_id: str, folder_id: Optional[str]) -> None:
    get_client().table("jobs").update({
        "folder_id": folder_id
    }).eq("job_id", job_id).execute()