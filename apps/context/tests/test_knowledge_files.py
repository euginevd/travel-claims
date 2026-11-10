"""The Knowledge Base's files match the policy wording: one per section, never the manual."""

from undercover_context.knowledge import FOLDER, knowledge_files


def test_the_committed_files_are_the_wording_as_it_is_now() -> None:
    expected = knowledge_files()
    committed = {path.name: path.read_text(encoding="utf-8") for path in FOLDER.iterdir()}
    # Regenerate with: uv run -m undercover_context.knowledge
    assert committed == expected


def test_only_the_policy_wording_goes_in() -> None:
    files = knowledge_files()
    assert "section-03.md" in files
    assert all('"document": "policy_wording"' in t for n, t in files.items() if n.endswith(".json"))
    assert not any("claims manual" in t.lower() and n.endswith(".json") for n, t in files.items())
