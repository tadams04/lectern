from __future__ import annotations

from dotenv import load_dotenv
from pathlib import Path
load_dotenv(Path(__file__).resolve().parents[1] / ".env")

from uuid import uuid4
from fastapi import BackgroundTasks, FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from .models import JobResponse
from .processor import process_job
from .storage import create_job, get_job, get_all_jobs, delete_job, create_folder, get_all_folders, rename_folder, delete_folder, move_job_to_folder


# "app" is the web server brain
# it keeps a list of all the endpoints (routes)
# knows how to validate inputs and outputs using pydnatic
app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

BASE_DIR = Path(__file__).resolve().parents[1]  # .../backend
UPLOAD_DIR = BASE_DIR / "data" / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


# Endpoint 1 - Health check
@app.get("/health")
def health():
    return {"ok": True}


# Endpoint 2 - Upload audio and start processing video
@app.post("/upload")
async def upload_file(background_tasks: BackgroundTasks, file: UploadFile = File(...)):
    job_id = uuid4().hex

    # Create safe file name + file path
    safe_name = Path(file.filename or "uploaded_file").name
    file_path = UPLOAD_DIR / f"{job_id}_{safe_name}"

    # Read file content and save it
    contents = await file.read()
    file_path.write_bytes(contents)

    # Create job record in storage
    create_job(str(file_path), job_id=job_id, filename=safe_name)

    # Start processing in the background
    background_tasks.add_task(process_job, job_id, str(file_path))

    # Return job id straight away
    return {"job_id": job_id}


# Endpoint 3
@app.get("/jobs/{job_id}", response_model=JobResponse)
def read_job(job_id: str):

    # Fetch the job
    job = get_job(job_id)

    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")

    return JobResponse(
        job_id=job_id,
        status=job["status"],
        filename=job.get("filename"),
        folder_id=job.get("folder_id"),
        created_at=job["created_at"],
        started_at=job["started_at"],
        finished_at=job["finished_at"],
        duration_seconds=job["duration_seconds"],
        result=job["result"],
        error=job["error"],
    )


# Endpoint 4
@app.get("/jobs")
def list_jobs():
    jobs = get_all_jobs()
    return [JobResponse(
        job_id=j["job_id"],
        status=j["status"],
        filename=j.get("filename"),
        folder_id=j.get("folder_id"),
        created_at=j["created_at"],
        started_at=j.get("started_at"),
        finished_at=j.get("finished_at"),
        duration_seconds=j.get("duration_seconds"),
        result=j.get("result"),
        error=j.get("error"),
    ) for j in jobs]

# Delete a job
@app.delete("/jobs/{job_id}")
def remove_job(job_id: str):
    delete_job(job_id)
    return {"ok": True}


# Move job to folder
@app.patch("/jobs/{job_id}/folder")
def assign_folder(job_id: str, body: dict):
    move_job_to_folder(job_id, body.get("folder_id"))
    return {"ok": True}


# Folder endpoints
@app.get("/folders")
def list_folders():
    return get_all_folders()


@app.post("/folders")
def add_folder(body: dict):
    folder_id = create_folder(body["name"], body.get("parent_id"))
    return {"folder_id": folder_id}


@app.patch("/folders/{folder_id}")
def update_folder(folder_id: str, body: dict):
    rename_folder(folder_id, body["name"])
    return {"ok": True}


@app.delete("/folders/{folder_id}")
def remove_folder(folder_id: str):
    delete_folder(folder_id)
    return {"ok": True}