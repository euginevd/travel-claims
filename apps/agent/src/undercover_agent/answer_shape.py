"""The shape every Wattle answer takes, so the apps can lay it out without rendering anything the
model wrote as markup: a one-sentence headline, up to three short points each citing one of the
sources by number, and one most likely next question. The plain answer, which the grounding and
reasoning checks read and the conversation keeps, is the headline and the points joined."""

import re
from typing import Annotated, cast

from pydantic import BaseModel, Field, StringConstraints

from undercover_agent.models import Json

MAX_POINTS = 3
MAX_SOURCES = 6
# The only formatting a point may carry: **bold** around a figure or a few words.
BOLD = re.compile(r"\*\*(.+?)\*\*")

TEXT = {"type": "string"}
# The reply tool's fields, shared by Ask UnderCover and the engineers' Wattle.
REPLY_FIELDS: Json = {
    "headline": TEXT | {"description": "The answer in one plain sentence, under 20 words"},
    "points": {
        "type": "array",
        "description": "Up to three supporting points, each under 15 words: one fact, the "
        "key figure in **bold**. No more than the reader needs; leave it empty when the "
        "headline says it all.",
        "items": {
            "type": "object",
            "properties": {
                "text": TEXT,
                "source": {
                    "type": "integer",
                    "description": "Which of your sources this rests on, 1 for the first; "
                    "0 for none",
                },
            },
            "required": ["text", "source"],
            "additionalProperties": False,
        },
    },
    "sources": {
        "type": "array",
        "items": TEXT,
        "description": "What you relied on, e.g. 'Policy wording section 6'",
    },
    "next": TEXT
    | {
        "description": "The one question the reader is most likely to ask next, in their "
        "words, under ten words; '' for none"
    },
}


class Point(BaseModel):
    text: Annotated[str, StringConstraints(max_length=300)]
    source: int = Field(default=0, ge=0, le=MAX_SOURCES)


class Shaped(BaseModel):
    headline: str
    points: list[Point]
    sources: list[str]
    next: str
    answer: str


def plain(text: str) -> str:
    """A point without its bold markers, as the checks and the conversation read it."""
    return BOLD.sub(r"\1", text)


def shape(args: Json, fallback: str) -> Shaped:
    """The reply tool's arguments, bounded: an older reply with only `answer` becomes the
    headline, a citation past the sources is dropped, and nothing is longer than it may be."""
    sources = [str(s)[:200] for s in cast(list[object], args.get("sources") or [])][:MAX_SOURCES]
    headline = str(args.get("headline") or args.get("answer") or "").strip()[:400] or fallback
    points: list[Point] = []
    for raw in cast(list[object], args.get("points") or [])[:MAX_POINTS]:
        if not isinstance(raw, dict):
            continue
        item = cast(Json, raw)
        text = str(item.get("text", "")).strip()[:300]
        if not text:
            continue
        cited = item.get("source", 0)
        source = cited if isinstance(cited, int) and 0 < cited <= len(sources) else 0
        points.append(Point(text=text, source=source))
    following = str(args.get("next") or "").strip()[:100]
    answer = " ".join([headline, *(plain(p.text) for p in points)])[:2000]
    return Shaped(headline=headline, points=points, sources=sources, next=following, answer=answer)
