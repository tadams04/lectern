from __future__ import annotations

import traceback

import json
import os
import re
from typing import List, Optional

from difflib import SequenceMatcher

import requests


from .models import NotesPayload, TranscriptSegment, AnnouncementItem, AnnouncementExtractionPayload


OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434/api/generate")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "qwen2.5:14b")

# Good starting values on a 24GB Mac:
OLLAMA_NUM_CTX = 12288 # try 16384 if slow or 32768 (working)
OLLAMA_NUM_PREDICT = 6000 # max output tokens (raise if notes cut off)
OLLAMA_TEMPERATURE = 0

LATEX_BS = "＼"      # U+FF3C FULLWIDTH REVERSE SOLIDUS (safe in JSON)
NL_TOKEN = "<NL>"   # newline token safe in JSON
# \b  ->  \x08  (backspace)
# \f  ->  \x0c  (formfeed)

_MATH_SPAN_RE = re.compile(r"\$\$.*?\$\$|\$.*?\$", re.DOTALL)


def _repair_math_spans(markdown: str) -> str:
    """
    Repairs the rare case where the model still emitted single-backslash LaTeX
    that got corrupted by json.loads into control chars (\b, \f, \t, \r, \n).
    Only touches content inside $...$ / $$...$$ to avoid breaking normal text.
    """
    def repl(m: re.Match) -> str:
        s = m.group(0)

        # undo JSON control-char escapes if they happened
        s = s.replace("\x08", r"\b")   # backspace -> \b  (so \begin)
        s = s.replace("\x0c", r"\f")   # formfeed -> \f  (so \frac)
        s = s.replace("\t",  r"\t")    # tab -> \t       (so \theta)
        s = s.replace("\r",  r"\r")    # CR -> \r        (so \right, etc)

        # newline only when it likely came from \n<letters> (e.g. \nabla)
        s = re.sub(r"\n(?=[A-Za-z])", r"\\n", s)

        # normalize the common runaway pattern without deleting row breaks:
        # turn \\[6pt] into \\   (keep the newline, drop the spacing)
        s = re.sub(r"\\\\\s*\[\s*\d+(?:\.\d+)?pt\s*\]", r"\\\\", s)

        return s

    return _MATH_SPAN_RE.sub(repl, markdown)


# Change this for announcement detection parameter changes
ANNOUNCEMENT_KEYWORDS = [
    "deadline", "due", "submit", "submission", "exam", "test", "quiz",
    "coursework", "assignment", "assessment",
    "next week", "week", "tutorial", "lecture", "seminar",
    "office hours", "email", "link", "moodle", "blackboard",
    "room", "location", "schedule", "rescheduled", "cancelled", "canceled",
    "canvas", "on teams", "microsoft teams", "%", "marks", "available at", "syllabus",

    # announcement and admin signals
    "announcement", "announce", "announcing", "notice", "important", "update", "reminder", "alert",
    "please note", "note that", "heads up", "fyi",

    # timing and date language
    "tomorrow", "this week", "this friday", "this monday", "tonight",
    "date", "time", "timeslot", "timezone",
    "start", "starts", "begin", "begins", "end", "ends",
    "opening", "closing", "closes",
    "extension", "extended", "postponed",

    # changes and disruptions
    "changed", "change", "updates", "moved", "move", "moved to",
    "replacement", "instead", "no class", "class is cancelled", "class is canceled",
    "strike", "closure", "closed",

    # access and resources
    "slides", "recording", "recorded", "notes", "materials", "resources",
    "upload", "uploaded", "available", "released", "published",
    "handout", "worksheet",
    "zoom", "teams", "google meet", "meeting link", "join link", "passcode", "password",

    # admin and assessment logistics
    "grading", "marks", "marking", "feedback", "rubric", "criteria",
    "late penalty", "late submission", "mitigating circumstances", "extenuating circumstances",
    "turnitin", "plagiarism", "academic integrity",
    "resit", "reassessment", "retake",

    # action words that often precede announcements
    "remember", "make sure", "don't forget", "ensure", "required", "mandatory", "optional",
]


def _fix_latex_in_text(text: str) -> str:
    if not text:
        return text

    # Decode the safe placeholders first (these are deterministic)
    text = text.replace(NL_TOKEN, "\n").replace(LATEX_BS, "\\")

    # Repair any control-char corruption that still sneaks in (rare)
    text = _repair_math_spans(text)

    return text


# Normalises text for similarity score
def _norm_text(s: str) -> str:
    s = (s or "").strip().lower()
    s = re.sub(r"\s+", " ", s)
    s = re.sub(r"[^\w\s]", "", s)
    return s


def _looks_like_announcement(text: str) -> bool:
    norm_str = _norm_text(text)
    for keyword in ANNOUNCEMENT_KEYWORDS:
        norm_keyword = _norm_text(keyword)
        if norm_keyword in norm_str:
            return True
    return False


def _collect_announcement_candidates(segments, context_before=1, context_after=2, max_candidates=80):

    candidate_set = set()

    for i, segment in enumerate(segments):
        if _looks_like_announcement(segment.text):
            start_index = max(0, i - context_before)
            end_index = min(len(segments), i + context_after + 1)

            for j in range(start_index, end_index):
                candidate_set.add(j)

        else:
            continue

    sorted_indices = sorted(candidate_set)

    if max_candidates is not None:
        sorted_indices = sorted_indices[:max_candidates]

    selected_segments = []

    for index in sorted_indices:
        selected_segments.append(segments[index])

    return selected_segments


# Uses SequenceMatcher to compute a similarity score, adjust threshold through testing
def _similar(a: str, b: str, threshold: float = 0.85):
    norm_a = _norm_text(a)
    norm_b = _norm_text(b)

    similarity_score = SequenceMatcher(None, norm_a, norm_b).ratio()

    if similarity_score >= threshold:
        return True
    else:
        return False


def _cap_bullets_per_section(section, max_bullets=10):
    # Keep bullets in chronological order by their anchor timestamps when available
    def _anchor(b):
        return (b.segment_start if b.segment_start is not None else float("inf"))
    section.bullets = sorted(section.bullets, key=_anchor)[:max_bullets]
    return section


def _dedupe_bullets_soft(bullets, text_similarity=0.92):
    """
    Dedupes bullets even if timestamps differ.
    Strategy: keep the first bullet, drop later bullets with very similar text+source.
    """
    kept = []
    for b in bullets:
        b_norm = _norm_text(b.text)
        duplicate = False
        for k in kept:
            if str(b.source) != str(k.source):
                continue
            if _similar(b.text, k.text, threshold=text_similarity):
                duplicate = True
                break
        if not duplicate:
            kept.append(b)
    return kept


def _merge_two_sections(a, b, *, title_similarity=0.88, min_overlap_s=15.0):
    """
    Merge only when sections truly overlap in time AND titles are similar enough.
    This stops mega-sections.
    """
    overlap = min(a.end, b.end) - max(a.start,
                                      b.start)  # positive = real overlap
    if overlap < min_overlap_s:
        return None

    if not _similar(a.title, b.title, threshold=title_similarity):
        return None

    title = a.title if len(a.title) >= len(b.title) else b.title
    start = min(a.start, b.start)
    end = max(a.end, b.end)
    bullets = _dedupe_bullets_soft(list(a.bullets) + list(b.bullets))
    summary = a.summary or b.summary

    from .models import NoteSection
    return NoteSection(title=title, start=start, end=end, summary=summary, bullets=bullets)


def chunk_segments_by_time(
    segments: List[TranscriptSegment],
    *,
    chunk_seconds: float = 10 * 60,
    overlap_seconds: float = 30,
) -> List[List[TranscriptSegment]]:
    if not segments:
        return []

    chunks: List[List[TranscriptSegment]] = []
    current: List[TranscriptSegment] = []

    chunk_start = segments[0].start
    chunk_end = chunk_start + chunk_seconds

    for seg in segments:
        if seg.end <= chunk_end:
            current.append(seg)
            continue

        # close current chunk
        if current:
            chunks.append(current)

        # build the next chunk with overlap: keep tail of previous chunk
        next_start = max(seg.start - overlap_seconds, 0.0)
        tail = [s for s in current if s.end >= next_start]

        chunk_start = next_start
        chunk_end = chunk_start + chunk_seconds

        current = tail + [seg]

    if current:
        chunks.append(current)

    return chunks


def merge_notes_payloads(payloads):

    merged = NotesPayload(sections=[], announcements=[])

    # 1) Merge announcements (dedupe)
    seen_ann = set()
    for p in payloads:
        for a in p.announcements:
            key = (round(a.timestamp, 2), _norm_text(a.text))
            if key in seen_ann:
                continue
            seen_ann.add(key)
            merged.announcements.append(a)

    # 2) Collect sections and sort
    all_sections = []
    for p in payloads:
        all_sections.extend(p.sections)
    all_sections.sort(key=lambda s: s.start)

    # 3) Sweep + merge overlaps
    compacted = []
    for sec in all_sections:
        if not compacted:
            sec.bullets = _dedupe_bullets_soft(list(sec.bullets))
            compacted.append(sec)
            continue

        prev = compacted[-1]
        merged_sec = _merge_two_sections(prev, sec)

        if merged_sec is None:
            sec.bullets = _dedupe_bullets_soft(list(sec.bullets))
            compacted.append(sec)
        else:
            compacted[-1] = merged_sec

    for s in compacted:
        _cap_bullets_per_section(s, max_bullets=10)

    # 4) Sort announcements + assign
    merged.sections = compacted
    merged.announcements.sort(key=lambda a: a.timestamp)

    return merged


def _segments_to_compact_text(segments: List[TranscriptSegment], max_chars: int = 50000) -> str:
    lines = [f"[{s.start:.2f}-{s.end:.2f}] {s.text}" for s in segments]
    text = "\n".join(lines)

    return text[:max_chars]


# Prompt with defined rules for LLM - Most recent best version
def _build_prompt(compact_transcript: str) -> str:
    return rf"""
# ROLE

You are a careful note-taker turning a lecture transcript chunk into structured,
faithful study notes. You will output ONE JSON object matching the provided
schema. Output nothing else — no prose, no markdown fences around the JSON, no
commentary before or after.

# WHAT GOOD NOTES LOOK LIKE (read this before writing)

Good notes help a student revise WITHOUT having to rewatch the lecture. That means:
- Sections follow the actual teaching structure of the lecture, not your opinion
  of how the topic should be taught.
- Bullets preserve the derivation steps, definitions, and worked examples exactly
  as the lecturer gave them — not summarised away.
- Mathematical content keeps its symbols, equations, and matrices intact as LaTeX.
- Code, algorithms, and pseudocode are preserved as fenced code blocks with
  the correct language tag.
- The student can click a timestamp and land at the moment in the recording
  where that point was made — so bullets sourced from the transcript MUST carry
  accurate segment_start / segment_end.

# HARD CONSTRAINTS (each rule is numbered — a violation of any is a failure)

## R1 — JSON escaping (the ONE escaping rule)

Inside every JSON string value in your output, you MUST NOT emit the ASCII
backslash character `\` (U+005C). This rule applies to titles, summaries,
bullet text, everywhere.

- For any LaTeX command, use this character instead: `{LATEX_BS}` (U+FF3C,
  fullwidth reverse solidus). Our post-processor will replace it with a real
  backslash before rendering.
- For any newline inside a string, use the token `{NL_TOKEN}`. Our post-processor
  will replace it with a real newline.
- Do NOT emit a literal newline character inside a JSON string.

Correct (copy this exactly for patterns you need):
- `"$ {LATEX_BS}lambda $"` renders as $\lambda$
- `"$ {LATEX_BS}frac{{a}}{{b}} $"` renders as a fraction
- `"$ {LATEX_BS}begin{{bmatrix}} 2 & -1 {LATEX_BS}{LATEX_BS} -1 & 2 {LATEX_BS}end{{bmatrix}} $"` is a matrix
- `"Step one.{NL_TOKEN}Step two."` has a newline between the two sentences

Wrong (never do any of these):
- `"$ \lambda $"` — real backslash corrupts JSON parsing
- `"$ \\lambda $"` — double-backslash is wrong; use {LATEX_BS} instead
- A string containing a real line break character
- `\[6pt]`, `\[8pt]`, `\\[6pt]` — NEVER emit LaTeX vertical-spacing commands;
  they cause runaway repetition. Use only plain {LATEX_BS}{LATEX_BS} for
  matrix row breaks, nothing else.

## R2 — Math formatting

- Inline math: `$ ... $`
- Displayed/centred math: `$$ ... $$`
- Use LaTeX only where genuinely needed: equations, Greek letters, matrices,
  summations. Do NOT wrap ordinary words in `$...$`.
- Never begin a bullet point with a LaTeX expression. Use LaTeX only when a bullet contains a genuine mathematical formula or equation.
- Math may appear in section titles, section summaries, and bullet text — the
  same `${LATEX_BS}...$ ` pattern applies in all three.

## R3 — Code blocks

- If the lecturer presents code, an algorithm, or pseudocode, include it as a
  single bullet whose text is a fenced code block.
- Use the correct language tag: ```python, ```java, ```sql, ```bash, ```cpp,
  ```javascript, or ```text for language-agnostic pseudocode.
- Use `{NL_TOKEN}` for every newline inside the code block — between lines of
  code and around the opening/closing fences.
- Keep it to the key lines being taught, not boilerplate. No imports unless
  the lecturer specifically discussed them.

Example of one correct code-block bullet's `text` field:
`"```python{NL_TOKEN}def binary_search(arr, target):{NL_TOKEN}    low, high = 0, len(arr) - 1{NL_TOKEN}    while low <= high:{NL_TOKEN}        mid = (low + high) // 2{NL_TOKEN}    return -1{NL_TOKEN}```"`

## R4 — Bullet sourcing and the `source` field

Every bullet has a `source` field, either `"transcript"` or `"unverified_llm"`.

- `"transcript"` — the bullet's claim is stated in the lecture. This is the
  default. Use it for definitions, derivations, examples, and anything the
  lecturer actually said.
- `"unverified_llm"` — the bullet adds intuition, a common-mistake warning,
  or a sanity check that the lecturer did NOT state. Aim for at least one
  per section where there is a natural opportunity to add context, clarify
  a common misconception, or flag an implication the lecturer did not spell
  out. Maximum two per section.

## R5 — Timestamps on bullets

Every transcript line in the input is prefixed with `[start-end]` in seconds.

- For `source="transcript"` bullets: set `segment_start` and `segment_end` from
  the single transcript line that best supports the bullet. Copy those numbers
  exactly. Do NOT leave them null.
- For `source="unverified_llm"` bullets: set `segment_start` and `segment_end`
  to null.

## R6 — Section boundaries and titling

- `section.start` = the start time of the first transcript line covered by
  that section.
- `section.end` = the end time of the last transcript line covered.
- Section titles should be short (2–6 words) and descriptive of the topic, not
  the lecturer's phrasing. Prefer canonical terminology: "Gradient Descent"
  over "How we find the minimum". Canonical titles help downstream stitching
  of chunks back together.
- Titles may contain math in `$...$` if the topic is inherently mathematical
  (e.g. `"Eigenvalues of $A$"`).

## R7 — Summaries

Every section MUST have a `summary` field — one or two sentences naming the
topic and what is demonstrated or proven. Plain language, no bullet symbols,
no quotes, no leading "In this section...".

## R8 — Bullet count

Target 5–8 bullets per section. Fewer is fine for short sections; more is
acceptable only if every additional bullet carries distinct content.

## R9 — What to EXCLUDE from the notes

- Announcements, deadlines, exam dates, housekeeping chat, room changes,
  reading lists — these are extracted by a separate pipeline and will be
  shown in a dedicated panel. Do NOT repeat them as bullets.
- The lecturer's verbal tics: "um", "you know", "let me see", "hold on".
- False starts and self-corrections — keep only the corrected version.
- Meta-commentary like "we'll come back to this" unless it introduces a
  genuine forward-reference that matters.

## R10 — The input is one CHUNK of a longer lecture

The transcript below may start mid-topic or end mid-topic. That is expected.

- If the first few segments clearly continue a topic already in progress, do
  NOT invent a new section called "Introduction" — begin with a section whose
  title matches the topic being continued. Downstream merging will stitch it
  to the previous chunk's section.
- If the last few segments introduce a new topic that is clearly just
  beginning, still make it a section — even a small one. It will be merged
  with its continuation from the next chunk.

# OUTPUT RULES

1. Return ONE JSON object. It MUST match the provided schema.
2. No surrounding text. No markdown code fence around the JSON. No "Here is
   the JSON:". Just the object.
3. The output object MUST contain a `sections` array populated with the notes.
   Set `announcements` to an empty list `[]`; the announcements field is
   populated by a separate pipeline downstream.

# TRANSCRIPT (chunk)

The lines below are the transcript for this chunk. Each line is prefixed with
`[start-end]` where start and end are in seconds relative to the full lecture.

{compact_transcript}
""".strip()


def _build_announcement_prompt(snips: str) -> str:
    return f"""
# ROLE

You extract actionable announcements from transcript snippets of a lecture.
You will output ONE JSON object matching the provided schema. Output nothing
else — no prose, no markdown fences, no commentary.

# WHAT COUNTS AS AN ANNOUNCEMENT

An announcement is a statement that a student needs to ACT ON, ATTEND, or
BE AWARE OF, separate from the academic content being taught. The five
categories, matching the `type` field:

1. `deadline` — a specific submission date, cutoff time, or "must be done by".
   Example: "Coursework is due Friday at 5 PM."
2. `task` — an action the student must take. Example: "Read chapter 4 before
   next week's tutorial." Also covers mark-split / weighting information
   (e.g. "The exam is worth 60% of the module") — these are actions for
   exam-prep purposes.
3. `meeting` — a scheduled event, tutorial, lab, guest lecture, or office-hours
   change. Example: "Office hours move to Tuesday 2 PM this week."
4. `resource` — a link, handout, slide set, recording, or reading that the
   student should access. Example: "The slides are on Canvas under week 3."
5. `admin` — everything logistical that doesn't fit the above: room changes,
   class cancellations, module structure notes, contact updates, assessment
   policies.

Use `null` only if none of the five types fits and the item is still clearly
an announcement worth surfacing.

# WHAT DOES NOT COUNT

- Academic content: definitions, theorems, worked examples, explanations.
  Those belong in the lecture notes, not in announcements.
- Generic encouragement without a concrete action: "you should really
  understand this before the exam" is not an announcement.
- Rhetorical questions, asides, or verbal filler.

# HARD CONSTRAINTS

## A1 — Faithfulness
Do NOT invent details. If the snippet says "the deadline is next Friday" and
does not give a date, your output must say "next Friday" — not a guessed date.

## A2 — Self-containment
Each announcement's `text` must be understandable on its own, without the
surrounding transcript context. Expand pronouns ("it", "that") into their
referent when possible.

## A3 — Concision
Plain English. No leading bullet symbols, no quotation marks around the whole
item, no backticks. One sentence where possible, two maximum.

## A4 — Timestamp
`timestamp` is the START time of the snippet line that best supports the
announcement (in seconds, as a number, not a string).

## A5 — De-duplication
- If the lecturer repeats the same announcement, include it ONCE, using the
  earliest timestamp.
- If two snippets describe the same announcement with minor wording
  differences, merge them into a single concise item.

## A6 — Empty case
If there are no actionable announcements in these snippets, return exactly
`{{"announcements": []}}`.

# OUTPUT RULES

1. Return ONE JSON object matching the schema.
2. No surrounding text, no markdown fence, no commentary.
3. Each announcement item has exactly these fields: `text`, `timestamp`, `type`.

# SNIPPETS

{snips}
""".strip()


# Single-chunk path - used directly by the chunked entry point for each chunk
def generate_structured_notes(
    transcript_segments: List[TranscriptSegment],
    *,
    timeout_s: int = 4000,
    max_retries: int = 1,
) -> NotesPayload:

    provider = (os.getenv("NOTES_PROVIDER") or "ollama").lower()
    model = OLLAMA_MODEL

    compact = _segments_to_compact_text(transcript_segments)
    prompt = _build_prompt(compact)

    last_err: Optional[Exception] = None

    for _ in range(max_retries + 1):
        try:
            if provider != "ollama":
                raise ValueError(f"Unsupported NOTES_PROVIDER: {provider}")

            schema = NotesPayload.model_json_schema()

            payload = {
                "model": model,
                "prompt": prompt,
                "stream": False,
                "format": schema,
                "options": {
                    "temperature": OLLAMA_TEMPERATURE,
                    "num_ctx": OLLAMA_NUM_CTX,
                    "num_predict": min(6000, OLLAMA_NUM_PREDICT),
                    "repeat_last_n": 512,
                    "repeat_penalty": 1.15,
                },
            }

            print("USING MODEL:", OLLAMA_MODEL, "CTX:",
                  OLLAMA_NUM_CTX, "PREDICT:", OLLAMA_NUM_PREDICT)

            resp = requests.post(
                OLLAMA_URL,
                json=payload,
                timeout=timeout_s,
            )

            resp.raise_for_status()

            raw = resp.json().get("response", "")

            # Strip runaway \[6pt] loops BEFORE parsing - they truncate the JSON
            raw = re.sub(r'(\\\\\s*\[\s*\d+(?:\.\d+)?pt\s*\]\s*){2,}', '', raw)

            data = json.loads(raw)

            for section in data.get("sections", []):
                if isinstance(section.get("summary"), str):
                    section["summary"] = _fix_latex_in_text(section["summary"])

                if isinstance(section.get("title"), str):
                    section["title"] = _fix_latex_in_text(section["title"])

                for bullet in section.get("bullets", []):
                    if isinstance(bullet.get("text"), str):
                        bullet["text"] = _fix_latex_in_text(bullet["text"])
                        # Strip spurious leading "$ \lambda $" artifact, but only when
                        # meaningful content follows so we never produce empty bullets.
                        m = re.match(r'^\$\s*\\lambda\s*\$\s*(.+)', bullet["text"], re.DOTALL)
                        if m:
                            bullet["text"] = m.group(1).strip()

            return NotesPayload.model_validate(data)

        except Exception as e:
            last_err = e

            print(
                f"!!! generate_structured_notes attempt failed: {type(e).__name__}: {e}")
            traceback.print_exc()

    raise RuntimeError(f"Notes generation failed: {last_err}")


def generate_structured_notes_chunked(
    transcript_segments: List[TranscriptSegment],
    *,
    chunk_seconds: float = 10 * 60,
    overlap_seconds: float = 30,
    timeout_s: int = 1200,
    max_retries: int = 1,
) -> NotesPayload:
    """
    1) Split transcript into chunks
    2) Generate NotesPayload per chunk using existing generate_structured_notes()
    3) Merge + dedupe overlaps into one clean NotesPayload
    """
    chunks = chunk_segments_by_time(
        transcript_segments,
        chunk_seconds=chunk_seconds,
        overlap_seconds=overlap_seconds,
    )

    payloads: List[NotesPayload] = []
    for chunk in chunks:
        notes = generate_structured_notes(
            chunk,
            timeout_s=timeout_s,
            max_retries=max_retries,
        )
        payloads.append(notes)

    merged = merge_notes_payloads(payloads)
    merged.announcements = extract_announcements_from_transcript(
        transcript_segments)

    return merged


def extract_announcements_from_transcript(
    transcript_segments: List[TranscriptSegment],
    *,
    timeout_s: int = 600,
) -> List[AnnouncementItem]:
    try:
        # 1) Candidates (cheap + deterministic)
        candidates = _collect_announcement_candidates(transcript_segments)
        if not candidates:
            return []

        # 2) Build compact snippet text for the LLM
        # Keep this bounded so prompts don't blow up on long lectures.
        snips = _segments_to_compact_text(candidates, max_chars=12000)

        # 3) Announcements-only prompt
        prompt = _build_announcement_prompt(snips)

        # 4) Call Ollama (structured output)
        provider = (os.getenv("NOTES_PROVIDER") or "ollama").lower()
        if provider != "ollama":
            # You only support Ollama currently, so fail gracefully.
            return []

        schema = AnnouncementExtractionPayload.model_json_schema()

        # Announcements are short therefore use smaller output budget than notes.
        announcements_num_predict = min(
            1200, max(256, OLLAMA_NUM_PREDICT // 5))

        payload = {
            "model": OLLAMA_MODEL,
            "prompt": prompt,
            "stream": False,
            "format": schema,
            "options": {
                "temperature": 0,
                "num_ctx": OLLAMA_NUM_CTX,
                "num_predict": announcements_num_predict,
            },
        }

        resp = requests.post(
            OLLAMA_URL,
            json=payload,
            timeout=timeout_s,
        )

        resp.raise_for_status()
        raw = resp.json().get("response", "")
        data = json.loads(raw)

        # 5) Validate to Pydantic schema
        extracted = AnnouncementExtractionPayload.model_validate(data)
        announcements = extracted.announcements or []

        # 6) Dedupe + sort (reuse your existing _norm_text)
        deduped: List[AnnouncementItem] = []
        seen: set[tuple[float, str]] = set()

        for a in announcements:
            # guard against odd/empty values
            text_norm = _norm_text(getattr(a, "text", "") or "")
            if not text_norm:
                continue

            ts = float(getattr(a, "timestamp", 0.0) or 0.0)
            key = (round(ts, 2), text_norm)

            if key in seen:
                continue

            seen.add(key)
            deduped.append(a)

        deduped.sort(key=lambda x: float(getattr(x, "timestamp", 0.0) or 0.0))
        return deduped

    except Exception as e:
        print("Announcement extraction failed!!!")
        print(repr(e))
        traceback.print_exc()

        return [
            AnnouncementItem(
                text=f"ANNOUNCEMENT EXTRACTION ERROR: {type(e).__name__}: {str(e)[:200]}",
                timestamp=0.0,
                type="error",
            )
        ]
