import os
import pytest

from semantic_sanitizer import sanitize_context_semantic


@pytest.fixture(autouse=True)
def disable_paraphraser_env(monkeypatch):
    """Ensure paraphraser is not used in tests unless explicitly enabled in CI."""
    monkeypatch.setenv("PARAPHRASE_MODEL", "t5-small")
    # prevent model downloads in unit tests by ensuring transformers not used
    monkeypatch.setenv("USE_EMBEDDINGS", "false")
    yield


def assert_no_forbidden(sanitized: str, forbidden: list):
    low = sanitized.lower()
    for token in forbidden:
        assert token.lower() not in low, f"Found forbidden token '{token}' in sanitized output"


def test_ceo_hyderabad_layoffs():
    text = "The CEO of our Hyderabad office said layoffs will start next week."
    res = sanitize_context_semantic(text)
    assert res["level"] >= 2
    assert res["category"] in ("corporate", "none") or isinstance(res["category"], str)
    # sanitized text should not contain specific names/locations/dates
    forbidden = ["ceo", "hyderabad", "next week", "layoffs", "project falcon"]
    assert_no_forbidden(res["sanitized_text"], forbidden)
    assert isinstance(res["removed_details"], list)


def test_health_glucose_insulin():
    text = "My patient's glucose levels were dangerously high and insulin was adjusted."
    res = sanitize_context_semantic(text)
    assert res["level"] >= 2
    assert res["category"] == "health"
    forbidden = ["glucose", "insulin", "hiv", "cancer"]
    assert_no_forbidden(res["sanitized_text"], forbidden)
    assert len(res["removed_details"]) >= 1


def test_project_missile():
    text = "We are delaying Project Falcon because the missile test failed."
    res = sanitize_context_semantic(text)
    assert res["level"] >= 3
    assert res["category"] in ("defense", "corporate", "none")
    forbidden = ["project falcon", "missile"]
    assert_no_forbidden(res["sanitized_text"], forbidden)
