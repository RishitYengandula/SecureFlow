"""
contextual_detector.py

Contextual Sensitive Information Detector

Provides:
- SENSITIVE_KEYWORDS: dictionary of keyword lists by category
- detect_contextual_sensitivity(text, ...): analyze text and return structured detection result
- sanitize_contextual_info(text, detection_result): return a sanitized version of the text with redaction tokens

Optional semantic similarity support using sentence-transformers. If the package is not
available or model loading fails, the semantic path is skipped and detection falls back
to keyword matching.

Designed to be modular and easily extendable.
"""
from typing import List, Dict, Any, Optional, Set
import os
import re
import logging

logger = logging.getLogger(__name__)


# -------------------------------
# Keyword dictionaries
# -------------------------------
SENSITIVE_KEYWORDS: Dict[str, List[str]] = {
    "health": [
        "insulin",
        "glucose",
        "diabetes",
        "hiv",
        "cancer",
        "therapy",
        "blood pressure",
        "depression",
        "insulin dosage",
    ],
    "finance": [
        "bankruptcy",
        "loan default",
        "credit score",
        "financial loss",
    ],
    "religion": [
        "hindu",
        "muslim",
        "christian",
        "temple",
        "church",
    ],
    "politics": [
        "election",
        "left-wing",
        "right-wing",
        "bjp",
        "congress",
    ],
    "corporate": [
        "layoff",
        "layoffs",
        "ceo",
        "hyderabad",
        "roadmap",
        "contract",
        "NDA",
        "internal",
        "confidential",
        "project falcon",
    ],
    "defense": [
        "missile",
        "air force",
        "classified",
        "military test",
        "defense contract",
    ],
    "inferential": [
        "pattern indicates",
        "predict risk",
        "likely fraud",
        "behavior anomaly",
    ],
}


# Redaction tokens by category
REDACTION_TOKENS = {
    "health": "[HEALTH_INFO_REDACTED]",
    "finance": "[FINANCIAL_INFO_REDACTED]",
    "politics": "[POLITICAL_INFO_REDACTED]",
    "religion": "[RELIGIOUS_INFO_REDACTED]",
    "corporate": "[CORPORATE_INFO_REDACTED]",
    "defense": "[DEFENSE_INFO_REDACTED]",
    "inferential": "[INFERENCE_REDACTED]",
}


def _compile_keyword_patterns(keywords: List[str]) -> List[re.Pattern]:
    """Compile a list of regex patterns (word-boundary aware) for given keywords."""
    patterns = []
    for kw in keywords:
        # Use word boundaries to avoid matching substrings unintentionally.
        # For keywords that contain non-word characters or are short, still escape safely.
        pat = re.compile(r"\b" + re.escape(kw) + r"\b", flags=re.IGNORECASE)
        patterns.append(pat)
    return patterns


def _find_keyword_matches(text: str) -> Dict[str, Set[str]]:
    """Scan text for literal keyword matches.

    Returns a mapping category -> set(matched_keyword)
    """
    lower_text = text.lower()
    matches: Dict[str, Set[str]] = {}
    for category, kws in SENSITIVE_KEYWORDS.items():
        pats = _compile_keyword_patterns(kws)
        found: Set[str] = set()
        for kw, pat in zip(kws, pats):
            if pat.search(text):
                found.add(kw)
        if found:
            matches[category] = found
    return matches


# Optional semantic similarity support
_has_embeddings = False
_st_model = None
try:
    from sentence_transformers import SentenceTransformer, util

    _has_embeddings = True
except Exception:
    _has_embeddings = False


def _semantic_keyword_matches(
    text: str, threshold: float = 0.72, model_name: str = "all-MiniLM-L6-v2"
) -> Dict[str, Set[str]]:
    """Use sentence-transformers to find semantically similar keywords.

    Returns category -> set(matched_keyword)
    If sentence-transformers is not available, returns empty dict.
    """
    global _has_embeddings, _st_model
    if not _has_embeddings:
        return {}

    try:
        if _st_model is None:
            _st_model = SentenceTransformer(model_name)
    except Exception as ex:
        logger.warning("Failed to load embedding model '%s': %s", model_name, ex)
        return {}

    try:
        text_emb = _st_model.encode(text, convert_to_tensor=True)
    except Exception as ex:
        logger.warning("Failed to encode text for semantic matching: %s", ex)
        return {}

    matches: Dict[str, Set[str]] = {}
    for category, kws in SENSITIVE_KEYWORDS.items():
        found: Set[str] = set()
        # encode keywords in batch
        try:
            kw_embs = _st_model.encode(kws, convert_to_tensor=True)
            sims = util.cos_sim(text_emb, kw_embs)[0]  # similarities
            for kw, sim_val in zip(kws, sims):
                if float(sim_val) >= threshold:
                    found.add(kw)
        except Exception as ex:
            logger.debug("Semantic similarity compute skipped for %s: %s", category, ex)
            continue
        if found:
            matches[category] = found
    return matches


def detect_contextual_sensitivity(
    text: str,
    use_embeddings: Optional[bool] = None,
    embedding_threshold: float = 0.72,
 ) -> Dict[str, Any]:
    """Detect contextual sensitive information within a text.

    Args:
        text: input text to analyze
        use_embeddings: if True and sentence-transformers is available, use semantic matching
        embedding_threshold: similarity threshold for semantic matches

    Returns:
        A dict with keys: level, category, is_sensitive, matched_terms, reason
    """
    if not text or not isinstance(text, str):
        return {
            "level": 0,
            "category": "none",
            "is_sensitive": False,
            "matched_terms": [],
            "reason": "No text provided or invalid input",
        }

    # Normalize
    normalized = text.strip()

    # Find literal keyword matches
    literal_matches = _find_keyword_matches(normalized)

    # Determine whether to use embeddings. Default: read environment variable
    # `USE_EMBEDDINGS`. If not set, default to True. Function parameter `use_embeddings`
    # overrides the environment variable when explicitly provided.
    if use_embeddings is None:
        use_embeddings_env = os.getenv("USE_EMBEDDINGS", "true").lower()
        use_embeddings = use_embeddings_env in ("1", "true", "yes", "y")

    semantic_matches: Dict[str, Set[str]] = {}
    if use_embeddings and _has_embeddings:
        semantic_matches = _semantic_keyword_matches(
            normalized, threshold=embedding_threshold
        )

    # Merge matches: literal wins if present; otherwise include semantic
    merged: Dict[str, Set[str]] = {}
    for cat in set(list(literal_matches.keys()) + list(semantic_matches.keys())):
        merged[cat] = set()
        if cat in literal_matches:
            merged[cat].update(literal_matches[cat])
        if cat in semantic_matches:
            # add semantic-only matches (avoid duplication)
            merged[cat].update(semantic_matches[cat])

    # Build matched terms list
    matched_terms: List[str] = []
    for cat, terms in merged.items():
        for t in terms:
            matched_terms.append(t)

    # Determine primary category and level according to rules
    level = 0
    primary_category = "none"

    # Priority: inferential (4) > defense/corporate (3) > health/finance/politics/religion (2)
    if "inferential" in merged and merged.get("inferential"):
        level = 4
        primary_category = "inferential"
    elif any(c in merged for c in ("defense", "corporate")):
        level = 3
        # prefer defense if present
        if "defense" in merged and merged.get("defense"):
            primary_category = "defense"
        else:
            primary_category = "corporate"
    elif any(c in merged for c in ("health", "finance", "politics", "religion")):
        level = 2
        # choose the category with the most matches as primary
        candidate = None
        best_count = 0
        for c in ("health", "finance", "politics", "religion"):
            cnt = len(merged.get(c, []))
            if cnt > best_count:
                best_count = cnt
                candidate = c
        primary_category = candidate or "health"
    else:
        level = 0
        primary_category = "none"

    is_sensitive = level >= 2

    # Compose reason
    if not is_sensitive:
        reason = "No contextual sensitive terms detected"
    else:
        reason = f"Detected contextual sensitive content in category '{primary_category}' with {len(matched_terms)} matched term(s)"

    result = {
        "level": level,
        "category": primary_category,
        "is_sensitive": is_sensitive,
        "matched_terms": sorted(list(set(matched_terms))),
        "reason": reason,
    }
    return result


def sanitize_contextual_info(text: str, detection_result: Dict[str, Any]) -> str:
    """Sanitize the provided `text` using matches found in `detection_result`.

    Replaces each matched term with a category-specific redaction token.
    The replacement is case-insensitive and respects word boundaries.
    """
    if not text or not detection_result:
        return text

    matched = detection_result.get("matched_terms", [])
    if not matched:
        return text

    sanitized = text

    # To determine the appropriate replacement token for each matched term, map
    # back to the category that contains it. If multiple categories contain the
    # same term, prefer the highest-level one using the same priority as detection.
    term_to_category: Dict[str, str] = {}
    # Build reverse map from keywords -> categories
    for cat, kws in SENSITIVE_KEYWORDS.items():
        for kw in kws:
            term_to_category.setdefault(kw.lower(), cat)

    # Sort matched terms by length descending to avoid partial replacements
    for term in sorted(matched, key=lambda s: len(s), reverse=True):
        if not term:
            continue
        cat = term_to_category.get(term.lower())
        if not cat:
            # If category unknown (e.g., semantic match not exactly equal), try fuzzy lookup
            # by checking which category's pattern matches in the original text
            found_cat = None
            for c, kws in SENSITIVE_KEYWORDS.items():
                for kw in kws:
                    if re.search(r"\b" + re.escape(kw) + r"\b", sanitized, flags=re.IGNORECASE):
                        found_cat = c
                        break
                if found_cat:
                    break
            cat = found_cat or "inferential"

        token = REDACTION_TOKENS.get(cat, "[SENSITIVE_REDACTED]")

        # Replace all case-insensitive occurrences of the exact term with token
        try:
            pattern = re.compile(r"\b" + re.escape(term) + r"\b", flags=re.IGNORECASE)
            sanitized = pattern.sub(token, sanitized)
        except re.error:
            # Fallback: simple replace, case-insensitive
            sanitized = re.sub(re.escape(term), token, sanitized, flags=re.IGNORECASE)

    return sanitized


__all__ = [
    "SENSITIVE_KEYWORDS",
    "detect_contextual_sensitivity",
    "sanitize_contextual_info",
]
