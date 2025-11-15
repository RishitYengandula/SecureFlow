import os
import pytest

from contextual_detector import (
    detect_contextual_sensitivity,
    sanitize_contextual_info,
    SENSITIVE_KEYWORDS,
)


def test_health_detection_and_sanitization():
    text = "Patient has diabetes and needs insulin dosage adjustment."
    # Ensure default env var doesn't break tests; detect handles absence of embeddings.
    os.environ.pop("USE_EMBEDDINGS", None)

    detection = detect_contextual_sensitivity(text, use_embeddings=False)
    assert detection["level"] == 2
    assert detection["category"] == "health"
    assert detection["is_sensitive"] is True
    # Expect both 'diabetes' and 'insulin' or 'insulin dosage' to be matched
    assert any(k in ("diabetes", "insulin", "insulin dosage") for k in detection["matched_terms"])

    sanitized = sanitize_contextual_info(text, detection)
    assert "[HEALTH_INFO_REDACTED]" in sanitized
    assert "diabetes" not in sanitized.lower()


def test_corporate_detection():
    text = "We will discuss Project Falcon and the product roadmap in the next meeting."
    detection = detect_contextual_sensitivity(text, use_embeddings=False)
    assert detection["level"] == 3
    assert detection["category"] == "corporate"
    assert "project falcon" in [t.lower() for t in detection["matched_terms"]] or "roadmap" in [t.lower() for t in detection["matched_terms"]]

    sanitized = sanitize_contextual_info(text, detection)
    # corporate tokens should be present
    assert "[CORPORATE_INFO_REDACTED]" in sanitized


def test_inferential_detection():
    text = "The pattern indicates likely fraud and behavior anomaly in the transaction logs."
    detection = detect_contextual_sensitivity(text, use_embeddings=False)
    assert detection["level"] == 4
    assert detection["category"] == "inferential"
    assert any("pattern" in t or "likely fraud" in t or "behavior anomaly" in t for t in detection["matched_terms"])


def test_non_sensitive_text():
    text = "This is a generic sentence with no sensitive content."
    detection = detect_contextual_sensitivity(text, use_embeddings=False)
    assert detection["level"] == 0
    assert detection["is_sensitive"] is False
    assert detection["matched_terms"] == []
import os
import sys
import pytest

# Ensure ml_service directory is importable (tests run from repo root or ml_service)
TEST_DIR = os.path.dirname(__file__)
ROOT = os.path.abspath(os.path.join(TEST_DIR, ".."))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from contextual_detector import (
    detect_contextual_sensitivity,
    sanitize_contextual_info,
    SENSITIVE_KEYWORDS,
)


def test_health_detection_and_sanitization():
    text = "The patient was diagnosed with diabetes and prescribed insulin."
    res = detect_contextual_sensitivity(text, use_embeddings=False)
    assert res["level"] == 2
    assert res["category"] == "health"
    assert res["is_sensitive"] is True
    # matched terms should include diabetes and insulin
    assert any("diabetes" in t.lower() for t in res["matched_terms"]) 
    assert any("insulin" in t.lower() for t in res["matched_terms"]) 

    sanitized = sanitize_contextual_info(text, res)
    assert "[HEALTH_INFO_REDACTED]" in sanitized


def test_corporate_detection_and_sanitization():
    text = "Do not leak the Project Falcon roadmap or any confidential contract details."
    res = detect_contextual_sensitivity(text, use_embeddings=False)
    assert res["level"] == 3
    assert res["category"] == "corporate"
    assert res["is_sensitive"] is True
    assert any("project falcon" in t.lower() for t in res["matched_terms"]) or any("roadmap" in t.lower() for t in res["matched_terms"]) 

    sanitized = sanitize_contextual_info(text, res)
    assert "[CORPORATE_INFO_REDACTED]" in sanitized


def test_inferential_detection_and_sanitization():
    text = "The pattern indicates likely fraud and a behavior anomaly across accounts."
    res = detect_contextual_sensitivity(text, use_embeddings=False)
    # Level 4 should be flagged for inferential indicators
    assert res["level"] == 4
    assert res["category"] == "inferential"
    assert res["is_sensitive"] is True
    assert any("likely fraud" in t.lower() or "pattern indicates" in t.lower() for t in res["matched_terms"]) 

    sanitized = sanitize_contextual_info(text, res)
    assert "[INFERENCE_REDACTED]" in sanitized


if __name__ == "__main__":
    pytest.main([os.path.abspath(__file__)])
