"""Data governance's seven files, read once at start-up, and the read-only lookups on them.

Every answer carries its sources: the file it came from with that file's system, owner and
review date. A search that finds nothing has no sources.
"""

import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal, cast

import yaml

FOLDER = Path(__file__).parent / "data"

DocumentName = Literal["policy_wording", "claims_manual"]
RecordName = Literal["claim", "policy", "previous_claim"]
PlanName = Literal["economy", "premium", "first"]

TITLES: dict[DocumentName, str] = {
    "policy_wording": "Policy wording",
    "claims_manual": "Claims manual",
}
GLOSSARY = "glossary.yaml"
DATA_DICTIONARY = "data_dictionary.yaml"
PLANS = "plans.yaml"
CLAIM_RULES = "claim_rules.yaml"
REFERENCE_DATA = "reference_data.yaml"
YAML_FILES = (GLOSSARY, DATA_DICTIONARY, PLANS, CLAIM_RULES, REFERENCE_DATA)

# A document's front matter (its source and version) sits between two "---" lines.
FRONT_MATTER = "---\n"
HEADING = re.compile(r"^## (\d+)\. (.+)$", re.MULTILINE)
PARAGRAPH_BREAK = re.compile(r"\n\s*\n")

Json = dict[str, Any]
Source = dict[str, str]


class NotFoundError(Exception):
    """A lookup that names something the files don't hold."""


@dataclass(frozen=True)
class Section:
    """One numbered section of a document."""

    number: int
    title: str
    text: str


@dataclass(frozen=True)
class Document:
    """A document's version, its file's source and its numbered sections."""

    name: DocumentName
    version: str
    source: Source
    sections: dict[int, Section]


def named_source(file: str, source: Source) -> Source:
    """A file's source as answers name it: the file, then its system, owner and review date."""
    return {"file": file} | source


def read_yaml(file: str) -> Json:
    """Read one YAML file, with its source named."""
    data = cast(Json, yaml.safe_load((FOLDER / file).read_text(encoding="utf-8")))
    return data | {"source": named_source(file, data["source"])}


def split_sections(body: str) -> dict[int, Section]:
    """Split a document's body at its numbered "## N. Title" headings."""
    headings = list(HEADING.finditer(body))
    ends = [heading.start() for heading in headings[1:]] + [len(body)]
    return {
        int(heading[1]): Section(int(heading[1]), heading[2], body[heading.end() : end].strip())
        for heading, end in zip(headings, ends, strict=True)
    }


def read_document(name: DocumentName) -> Document:
    """Read a markdown document, its front matter apart from its sections."""
    file = f"{name}.md"
    _, front, body = (FOLDER / file).read_text(encoding="utf-8").split(FRONT_MATTER, 2)
    about = cast(Json, yaml.safe_load(front))
    return Document(
        name, str(about["version"]), named_source(file, about["source"]), split_sections(body)
    )


FILES: dict[str, Json] = {file: read_yaml(file) for file in YAML_FILES}
DOCUMENTS: dict[DocumentName, Document] = {name: read_document(name) for name in TITLES}


def sources_of(file: str) -> list[Source]:
    """The sources of an answer drawn from one YAML file."""
    return [FILES[file]["source"]]


def entries(file: str, key: str) -> list[Json]:
    """The list of entries a YAML file holds under a key."""
    return cast(list[Json], FILES[file][key])


def lookup_term(term: str) -> Json:
    """A term the policy wording defines, in any case, or the terms it does define."""
    for entry in entries(GLOSSARY, "terms"):
        if str(entry["term"]).lower() == term.strip().lower():
            return entry | {"sources": sources_of(GLOSSARY)}
    return {
        "answer": f'The glossary doesn\'t define "{term}". These are the terms it does.',
        "terms": [entry["term"] for entry in entries(GLOSSARY, "terms")],
        "sources": sources_of(GLOSSARY),
    }


def describe_fields(record: RecordName) -> Json:
    """A record's description and what each of its fields means."""
    found = next(r for r in entries(DATA_DICTIONARY, "records") if r["record"] == record)
    return found | {"sources": sources_of(DATA_DICTIONARY)}


def get_plan(plan: PlanName) -> Json:
    """A plan's limits, waiting periods and deductible, what the deductible applies to,
    and the add-ons."""
    found = next(p for p in entries(PLANS, "plans") if p["plan"] == plan)
    return {
        "plan": found,
        "deductible_applies_to": FILES[PLANS]["deductible_applies_to"],
        "add_ons": FILES[PLANS]["add_ons"],
        "sources": sources_of(PLANS),
    }


def get_claim_rules() -> Json:
    """The rules claims operations applies to every claim."""
    return {"rules": FILES[CLAIM_RULES]["rules"], "sources": sources_of(CLAIM_RULES)}


def search_reference_data(query: str) -> Json:
    """Outside facts holding every word of the query as a whole word, in any case, each with
    its topic."""
    patterns = [re.compile(rf"\b{re.escape(word)}\b", re.IGNORECASE) for word in query.split()]
    facts = [
        {"topic": topic["topic"], "fact": fact}
        for topic in entries(REFERENCE_DATA, "topics")
        for fact in cast(list[str], topic["facts"])
        if all(pattern.search(fact) for pattern in patterns)
    ]
    return {"facts": facts, "sources": sources_of(REFERENCE_DATA) if facts else []}


def search_documents(query: str) -> Json:
    """Sections of the wording and the manual whose title or text holds the query, in any
    case, with the paragraphs that mention it (none when only the title matches)."""
    wanted = query.strip().lower()
    sections: list[Json] = []
    sources: list[Source] = []
    for document in DOCUMENTS.values():
        for section in document.sections.values():
            excerpts = [p for p in PARAGRAPH_BREAK.split(section.text) if wanted in p.lower()]
            if not excerpts and wanted not in section.title.lower():
                continue
            sections.append(
                {
                    "document": document.name,
                    "file": document.source["file"],
                    "number": section.number,
                    "title": section.title,
                    "excerpts": excerpts,
                }
            )
            if document.source not in sources:
                sources.append(document.source)
    return {"sections": sections, "sources": sources}


def read_section(document: DocumentName, number: int) -> Json:
    """One section of the wording or the manual in full, with the document's version."""
    read = DOCUMENTS[document]
    section = read.sections.get(number)
    if section is None:
        raise NotFoundError(f"Section {number} of the {TITLES[document].lower()} not found")
    return {
        "document": document,
        "document_title": TITLES[document],
        "version": read.version,
        "number": number,
        "title": section.title,
        "text": section.text,
        "sources": [read.source],
    }
