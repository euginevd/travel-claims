"""The policy wording as the Bedrock Knowledge Base reads it (tier 2): one file per section, with
its number and title as metadata, so a search cites the section exactly as the context layer does.
Only the policy wording: the claims manual is internal.

Regenerate after the wording changes: uv run -m undercover_context.knowledge
"""

import json
from pathlib import Path

from undercover_context.files import DOCUMENTS

FOLDER = Path(__file__).resolve().parents[4] / "data" / "knowledge" / "policy_wording"


def knowledge_files() -> dict[str, str]:
    """Each section's file and its metadata file, by name."""
    wording = DOCUMENTS["policy_wording"]
    files: dict[str, str] = {}
    for section in wording.sections.values():
        name = f"section-{section.number:02d}.md"
        files[name] = f"# {section.number}. {section.title}\n\n{section.text}\n"
        about = {
            "metadataAttributes": {
                "document": "policy_wording",
                "number": section.number,
                "title": section.title,
                "version": wording.version,
            }
        }
        files[f"{name}.metadata.json"] = json.dumps(about, indent=2) + "\n"
    return files


def main() -> None:
    FOLDER.mkdir(parents=True, exist_ok=True)
    for stale in FOLDER.iterdir():
        stale.unlink()
    for name, text in knowledge_files().items():
        (FOLDER / name).write_text(text, encoding="utf-8", newline="\n")
    print(f"Wrote {len(knowledge_files())} files to {FOLDER}")


if __name__ == "__main__":
    main()
