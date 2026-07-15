from app.models import TranscriptSegment, NoteSection
from app.note_generator import (
    chunk_segments_by_time,
    _merge_two_sections,
    _collect_announcement_candidates,
    _looks_like_announcement,
)


def seg(s, e, text="x"):
    return TranscriptSegment(start=float(s), end=float(e), text=text)


def section(title, start, end):
    return NoteSection(title=title, start=float(start), end=float(end),
                       summary=None, bullets=[])


# chunking

def test_overlap_carries_tail_forward():
    segs = [seg(0, 595, "early"), seg(595, 599, "tail"), seg(601, 605, "late")]
    chunks = chunk_segments_by_time(segs, chunk_seconds=600, overlap_seconds=30)
    assert len(chunks) == 2
    assert any(s.text == "tail" for s in chunks[1])


def test_short_lecture_one_chunk():
    segs = [seg(i * 5, (i + 1) * 5) for i in range(20)]
    chunks = chunk_segments_by_time(segs, chunk_seconds=600, overlap_seconds=30)
    assert len(chunks) == 1


# merge guards

def test_no_merge_when_overlap_too_short():
    a = section("Binary search trees", 0, 100)
    b = section("Binary search trees", 110, 200)
    assert _merge_two_sections(a, b) is None


def test_no_merge_when_titles_differ():
    a = section("Binary search", 0, 200)
    b = section("Project admin", 100, 300)
    assert _merge_two_sections(a, b) is None


def test_merge_when_both_conditions_met():
    a = section("Binary search trees", 0, 150)
    b = section("Binary search tree", 130, 240)
    merged = _merge_two_sections(a, b)
    assert merged is not None
    assert merged.start == 0
    assert merged.end == 240


# announcements

def test_keyword_filter_catches_deadline_language():
    assert _looks_like_announcement("the deadline is Friday at 5pm")
    assert _looks_like_announcement("submit the assignment on Canvas")

def test_candidate_window_pulls_neighbours():
    segs = [
        seg(0,  5, "let's continue"),
        seg(5, 10, "the deadline is Friday"),
        seg(10, 15, "submit on Canvas"),
    ]
    candidates = _collect_announcement_candidates(segs, context_before=1, context_after=1)
    texts = [c.text for c in candidates]
    assert "the deadline is Friday" in texts
    assert "let's continue" in texts
    assert "submit on Canvas" in texts