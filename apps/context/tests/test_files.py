import pytest

from undercover_context import files


def test_every_lookup_names_its_sources_in_full() -> None:
    for answer in (
        files.lookup_term("Carrier"),
        files.describe_fields("claim"),
        files.describe_fields("previous_claim"),
        files.get_plan("economy"),
        files.get_claim_rules(),
        files.search_reference_data("storm"),
        files.search_documents("deductible"),
        files.read_section("policy_wording", 1),
    ):
        assert answer["sources"]
        for source in answer["sources"]:
            assert set(source) >= {"file", "system", "owner", "reviewed"}


def test_lookup_term_ignores_case() -> None:
    answer = files.lookup_term("  carrier ")
    assert answer["term"] == "Carrier"
    assert answer["sources"][0]["file"] == "glossary.yaml"


def test_lookup_term_lists_the_terms_for_an_unknown_one() -> None:
    answer = files.lookup_term("Teleporter")
    assert "doesn't define" in answer["answer"]
    assert "Carrier" in answer["terms"]


def test_describe_fields_gives_the_record() -> None:
    assert files.describe_fields("policy")["record"] == "policy"


def test_get_plan_gives_the_plan_and_add_ons() -> None:
    answer = files.get_plan("first")
    assert answer["plan"]["plan"] == "first"
    assert answer["add_ons"]
    assert answer["deductible_applies_to"]


def test_claim_rules_include_the_filing_window() -> None:
    rules = files.get_claim_rules()["rules"]
    assert any(rule["rule"] == "filing_window" for rule in rules)


def test_reference_search_needs_every_word() -> None:
    found = files.search_reference_data("storm")
    assert found["facts"]
    assert found["sources"][0]["file"] == "reference_data.yaml"
    nothing = files.search_reference_data("storm zzzz-not-a-word")
    assert nothing == {"facts": [], "sources": []}


def test_reference_search_matches_whole_words_only() -> None:
    assert files.search_reference_data("stor") == {"facts": [], "sources": []}


def test_document_search_finds_sections_with_their_files() -> None:
    found = files.search_documents("deductible")
    assert found["sections"]
    assert {s["file"] for s in found["sections"]} <= {"policy_wording.md", "claims_manual.md"}
    assert files.search_documents("zzzz-not-a-word") == {"sections": [], "sources": []}


def test_read_section_gives_the_text_and_version() -> None:
    section = files.read_section("claims_manual", 14)
    assert section["document_title"] == "Claims manual"
    assert section["version"] == "2026.2"
    assert section["text"]
    assert section["sources"][0]["file"] == "claims_manual.md"


def test_read_section_refuses_a_missing_section() -> None:
    with pytest.raises(files.NotFoundError, match="Section 999 of the policy wording"):
        files.read_section("policy_wording", 999)
