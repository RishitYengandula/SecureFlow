"""semantic_sanitizer.py

Provides semantic sanitization: rewrite sensitive text to an abstract,
non-identifying paraphrase while preserving high-level meaning.

Function: sanitize_context_semantic(text: str) -> Dict[str, Any]
 - returns {'sanitized_text': str, 'removed_details': List[Dict]} where each removed detail
   contains the original term and its category.

Implementation: rule-based templates plus contextual detection. If sentence-transformers
is available, optional paraphrasing can be added later; currently we focus on deterministic
template-based rewriting with careful removal of sensitive tokens.
"""
from typing import List, Dict, Any
import os
import re
import logging

logger = logging.getLogger(__name__)

try:
    from contextual_detector import detect_contextual_sensitivity, sanitize_contextual_info
except Exception:
    # allow imports when invoked from different working directories
    from .contextual_detector import detect_contextual_sensitivity, sanitize_contextual_info

# Optional paraphraser (uses transformers). Loaded lazily to avoid heavy imports when not needed.
_has_paraphraser = False
_paraphrase_pipeline = None
try:
    # attempt lazy import; actual model loading happens in _paraphrase_text
    import transformers  # type: ignore
    _has_paraphraser = True
except Exception:
    _has_paraphraser = False


GENERIC_TEMPLATES = {
    "health": [
        "Someone's health measurements were concerning.",
        "A person was reported to have a health issue.",
    ],
    "finance": [
        "There are indications of personal financial difficulties.",
        "The situation involves non-specific financial issues.",
    ],
    "religion": [
        "The text references a person's religious affiliation.",
    ],
    "politics": [
        "The passage contains political viewpoints or affiliations.",
    ],
    "corporate": [
        "A confidential internal initiative is being discussed.",
        "An internal business matter is referenced.",
    ],
    "defense": [
        "A sensitive defense-related activity is mentioned.",
        "A classified or security-related matter is referenced.",
    ],
    "inferential": [
        "There are inferred behavioral or risk indicators in the report.",
        "The content suggests possible risk or suspicious patterns.",
        "The note implies inferred patterns or potential risk without naming individuals.",
    ],
}


# Subject templates and pronouns for replacing redaction tokens in context-preserving paraphrases
SUBJECT_TEMPLATES = {
    "health": "A patient",
    "finance": "An individual",
    "religion": "A person",
    "politics": "A person",
    "corporate": "An internal initiative",
    "defense": "A defense-related activity",
    "inferential": "The report",
}

SUBJECT_PRONOUNS = {
    "health": "their",
    "finance": "their",
    "religion": "their",
    "politics": "their",
    "corporate": "it",
    "defense": "it",
    "inferential": "it",
}


# Phrase-level replacements to prefer more generic wording for readability/privacy.
# Keys are category -> mapping of pattern (regex-like) -> replacement.
PHRASE_REPLACEMENTS = {
    "health": {
        r"\bmedication(s)?\b": "medical treatment",
        r"\bblood measurements\b": "health measures",
        r"\bglucose\b": "health measurements",
        r"\binsulin\b": "medical treatment",
        r"\bhiv\b": "a serious health condition",
        r"\bcancer\b": "a serious health condition",
    },
}


def _apply_phrase_replacements(text: str, category: str) -> str:
    if not text or not category:
        return text
    repl_map = PHRASE_REPLACEMENTS.get(category, {})
    out = text
    for pat, rep in repl_map.items():
        try:
            out = re.sub(pat, rep, out, flags=re.IGNORECASE)
        except re.error:
            out = out.replace(pat, rep)
    # cleanup spacing
    out = re.sub(r"\s+", " ", out).strip()
    return out


def _vague_paraphrase(sanitized_text: str, category: str, matched_terms: List[str]) -> str:
    """Attempt to generate a vague paraphrase using the paraphraser.

    Falls back to a deterministic subject+action combination when paraphraser
    is unavailable or fails.
    """
    if not sanitized_text or not isinstance(sanitized_text, str):
        return ""

    # Try model-based paraphrase first
    vague = None
    try:
        # Use tone "vague" to hint the model; preserve length moderately
        vague = _paraphrase_text(sanitized_text, max_length=128, tone="vague")
    except Exception:
        vague = None

    if vague and isinstance(vague, str) and vague.strip() and vague.strip().lower() not in ("false", "none"):
        # Ensure no matched terms remain
        vague = _remove_sensitive_terms_from_text(vague, matched_terms)
        vague = _apply_phrase_replacements(vague, category)
        return vague.strip()

    # Fallback deterministic rewrite: replace redaction tokens with subject and keep the action
    subj = SUBJECT_TEMPLATES.get(category, "The content")
    action = _extract_action_phrase(sanitized_text, matched_terms)
    if not action:
        # try extracting from original sanitized_text by splitting
        parts = re.split(r"[\.\n]", sanitized_text)
        action = parts[-1].strip() if parts else ""

    out = f"{subj} {action}".strip()
    out = _apply_phrase_replacements(out, category)
    out = _remove_sensitive_terms_from_text(out, matched_terms)
    if out and out[-1] not in ".!?":
        out = out + "."
    return out


def _paraphrase_text(text: str, max_length: int = 128, tone: str = None) -> str:
    """Paraphrase text using a small transformer model when available.

    This function loads a lightweight `t5-small` text2text pipeline on first use.
    If model loading or generation fails, returns None so caller can fall back to templates.

    `tone` is optional and will be included in the paraphrase prompt when provided
    to encourage tone-specific rewrites (e.g., 'friendly', 'formal', 'terse').
    """
    global _paraphrase_pipeline, _has_paraphraser
    if not _has_paraphraser:
        return None

    try:
        if _paraphrase_pipeline is None:
            from transformers import pipeline
            # Prefer GPU when available. Determine device automatically if torch is present.
            device = -1
            try:
                import torch
                if torch.cuda.is_available():
                    device = 0
            except Exception:
                device = -1

            # Use a text2text-generation pipeline. Default to a stronger paraphrase model
            # tuned for paraphrasing unless overridden via the PARAPHRASE_MODEL env var.
            model_name = os.getenv("PARAPHRASE_MODEL", "Vamsi/T5_Paraphrase_Paws")
            logger.info("Loading paraphrase pipeline model=%s device=%s", model_name, device)
            _paraphrase_pipeline = pipeline("text2text-generation", model=model_name, device=device)

        # Build a prompt that optionally includes tone guidance
        prefix = "paraphrase"
        if tone:
            prefix = f"paraphrase ({tone})"
        prompt = f"{prefix}: {text}"

        outputs = _paraphrase_pipeline(prompt, max_length=max_length, do_sample=False)
        if outputs and isinstance(outputs, list) and outputs[0].get("generated_text"):
            return outputs[0]["generated_text"].strip()
        # Some pipeline variants return 'text'
        if outputs and isinstance(outputs, list) and outputs[0].get("text"):
            return outputs[0]["text"].strip()
    except Exception as ex:
        logger.warning("Paraphrase generation failed: %s", ex)
        return None



def _choose_template_for_category(category: str, text: str) -> str:
    c = category or ""
    if c in GENERIC_TEMPLATES:
        # simple heuristic: pick first template, could randomize or pick based on keywords
        return GENERIC_TEMPLATES[c][0]

    # fallback: general abstraction
    return "The content refers to a sensitive, non-public matter."


def _remove_sensitive_terms_from_text(text: str, matched_terms: List[str]) -> str:
    """Remove or replace sensitive literal terms with generic placeholders."""
    sanitized = text
    for term in sorted(set(matched_terms or []), key=lambda s: len(s), reverse=True):
        if not term:
            continue
        try:
            pattern = re.compile(r"\b" + re.escape(term) + r"\b", flags=re.IGNORECASE)
            sanitized = pattern.sub("[REDACTED]", sanitized)
        except re.error:
            sanitized = re.sub(re.escape(term), "[REDACTED]", sanitized, flags=re.IGNORECASE)
    return sanitized


def _extract_action_phrase(full_text: str, matched_terms: List[str]) -> str:
    if not matched_terms:
        # fallback: return the last clause or sentence
        parts = re.split(r"[\.\n]", full_text)
        return parts[-1].strip() if parts else ""

    for term in matched_terms:
        if not term:
            continue
        idx = full_text.lower().find(term.lower())
        if idx >= 0:
            end = idx + len(term)
            # return the remainder of the sentence after the term
            remainder = full_text[end:].strip()
            # if remainder empty, try the sentence where the term appeared
            if remainder:
                # trim leading punctuation
                remainder = re.sub(r"^[,;:\-\s]+", "", remainder)
                # cut at sentence end
                m = re.search(r"([\s\S]*?[\.\!\?])", remainder)
                return (m.group(1).strip() if m else remainder).strip()
    # fallback
    parts = re.split(r"[\.\n]", full_text)
    return parts[-1].strip() if parts else ""


def sanitize_context_semantic(text: str) -> Dict[str, Any]:
    """Perform semantic sanitization of `text`.

    Returns a dict with keys:
      - sanitized_text: rewritten, abstracted sentence
      - removed_details: list of {"term": str, "category": str}
      - level: detected sensitivity level
      - category: primary category
    """
    if not text or not isinstance(text, str):
        return {"sanitized_text": text or "", "removed_details": [], "level": 0, "category": "none"}

    # Run contextual detection (allow embeddings as configured by detector)
    detection = detect_contextual_sensitivity(text, use_embeddings=None)
    level = detection.get("level", 0)
    category = detection.get("category", "none")
    matched = detection.get("matched_terms", []) or []

    removed_details = []
    for t in matched:
        removed_details.append({"term": t, "category": category})

    # Build rewritten text
    if level == 0:
        # No sensitive context detected; return original text but ensure no explicit PII remains
        sanitized = text
    else:
        # Prefer category-specific template
        primary = category if category and category != "none" else "inferential"

        # Try paraphraser first (when available) to preserve fluency but redact specifics
        paraphrased = None
        try:
            paraphrased = _paraphrase_text(text)
        except Exception:
            paraphrased = None

        if paraphrased and isinstance(paraphrased, str) and paraphrased.strip() and paraphrased.strip().lower() not in ("false", "none"):
            # safety: remove any matched terms from paraphrased output
            sanitized = _remove_sensitive_terms_from_text(paraphrased, matched)
        else:
            # Prefer to produce a context-preserving paraphrase by using the detector's
            # redacted preview and swapping redaction tokens for a category-aware subject.
            try:
                redacted_local = sanitize_contextual_info(text, detection) or ""
            except Exception:
                redacted_local = ""

            def _replace_redactions_with_subject(redacted_str: str, cat: str) -> str:
                if not redacted_str:
                    return _choose_template_for_category(cat, text)

                subj = SUBJECT_TEMPLATES.get(cat, "The content")
                pron = SUBJECT_PRONOUNS.get(cat, "it")

                # Replace each redaction token sequentially: first -> subject, subsequent -> pronoun
                out = redacted_str
                # find tokens like [HEALTH_INFO_REDACTED] or [SENSITIVE_REDACTED]
                tokens = re.findall(r"\[[A-Z_]+\]", out)
                if not tokens:
                    return out

                # Replace first occurrence
                out = re.sub(re.escape(tokens[0]), subj, out, count=1)
                # Replace remaining occurrences with pronoun or possessive for health
                possessive = "'s" if cat == "health" else ""
                replace_with = pron if not possessive else (pron)
                for t in tokens[1:]:
                    out = re.sub(re.escape(t), replace_with, out, count=1)

                # Minor cleanups: fix double spaces and punctuation
                out = re.sub(r"\s+", " ", out).strip()
                out = re.sub(r"\s+\.", ".", out)
                return out

            if redacted_local and "[" in redacted_local:
                sanitized = _replace_redactions_with_subject(redacted_local, primary)
            else:
                # Fallback: combine a subject template with the original action phrase
                template = _choose_template_for_category(primary, text)
                action = _extract_action_phrase(text, matched)
                sanitized = (template + " " + action).strip()

    # Final safety pass: ensure matched terms are not present in sanitized text
    sanitized = _remove_sensitive_terms_from_text(sanitized, matched)

    # Also include a redacted fallback produced by the detector's sanitizer for auditing
    try:
        redacted = sanitize_contextual_info(text, detection)
    except Exception:
        redacted = None

    result = {
        "sanitized_text": sanitized,
        "removed_details": removed_details,
        "level": level,
        "category": category,
        "redacted_preview": redacted,
    }

    # Helper: extract the action/event phrase following the first matched sensitive term.
    def _extract_action_phrase(full_text: str, matched_terms: List[str]) -> str:
        if not matched_terms:
            # fallback: return the last clause or sentence
            parts = re.split(r"[\.\n]", full_text)
            return parts[-1].strip() if parts else ""

        for term in matched_terms:
            if not term:
                continue
            idx = full_text.lower().find(term.lower())
            if idx >= 0:
                end = idx + len(term)
                # return the remainder of the sentence after the term
                remainder = full_text[end:].strip()
                # if remainder empty, try the sentence where the term appeared
                if remainder:
                    # trim leading punctuation
                    remainder = re.sub(r"^[,;:\-\s]+", "", remainder)
                    # cut at sentence end
                    m = re.search(r"([\s\S]*?[\.\!\?])", remainder)
                    return (m.group(1).strip() if m else remainder).strip()
        # fallback
        parts = re.split(r"[\.\n]", full_text)
        return parts[-1].strip() if parts else ""


    # Produce tone-specific variants to give callers multiple sanitized phrasing options.
    # Only produce variants when sensitivity is detected (level > 0). For non-sensitive
    # text we still provide a minimal set of variants derived from the original.
    def _generate_variants(src_text: str, matched_terms: List[str], cat: str, lvl: int) -> Dict[str, str]:
        tones = ["friendly", "formal", "terse"]
        variants: Dict[str, str] = {}
        action = _extract_action_phrase(src_text, matched_terms)

        # Build a subject for the sanitized sentence using category template
        subj_template = _choose_template_for_category(cat if cat and cat != "none" else "inferential", src_text)

        for tone in tones:
            v = None
            # Try paraphraser with tone guidance when available
            try:
                v = _paraphrase_text(src_text, tone=tone)
            except Exception:
                v = None

            if v and isinstance(v, str) and v.strip() and v.strip().lower() not in ("false", "none"):
                # Remove any literal matched terms from paraphrased output
                v = _remove_sensitive_terms_from_text(v, matched_terms)
            else:
                # Fallback: combine the subject with the original action to preserve meaning
                subj = subj_template
                if tone == "friendly":
                    # friendly: soften subject
                    subj = subj.replace("A ", "A ")
                    v = f"{subj} {action}".strip()
                elif tone == "formal":
                    v = f"{subj} {action}".strip()
                else:  # terse
                    # terse: keep subject short and append key action fragment
                    terse_subj = subj.split('.')[0]
                    v = f"{terse_subj} {action}".strip()

            # Final safety pass: remove matched terms if any slipped through
            v = _remove_sensitive_terms_from_text(v, matched_terms)
            # Normalize whitespace and punctuation
            v = re.sub(r"\s+", " ", v).strip()
            # Ensure sentence ends with punctuation
            if v and v[-1] not in ".!?":
                v = v + "."

            variants[tone] = v

        return variants

    try:
        result["variants"] = _generate_variants(text if level == 0 else sanitized, matched, category, level)
    except Exception:
        result["variants"] = {}

    # Apply phrase-level replacements (e.g., avoid 'medication' -> prefer 'medical treatment')
    try:
        result["sanitized_text"] = _apply_phrase_replacements(result.get("sanitized_text", ""), category)
    except Exception:
        pass

    # Apply replacements to variants as well
    try:
        if isinstance(result.get("variants"), dict):
            for k, v in list(result["variants"].items()):
                try:
                    result["variants"][k] = _apply_phrase_replacements(v, category)
                except Exception:
                    pass
    except Exception:
        pass

    # Harden sanitized_text: ensure it's a readable string and not a non-string token
    if not isinstance(result.get("sanitized_text"), str) or not result.get("sanitized_text").strip() or str(result.get("sanitized_text")).lower() in ("false", "none"):
        # fallback to formal variant or category template
        fallback = (result.get("variants", {}).get("formal") or _choose_template_for_category(category if category and category != "none" else "inferential", text))
        fallback = _remove_sensitive_terms_from_text(fallback, matched)
        fallback = _apply_phrase_replacements(fallback, category)
        result["sanitized_text"] = fallback

    return result


if __name__ == "__main__":
    # quick manual test
    sample = "The CEO of our Hyderabad office said layoffs will start next week."
    print(sanitize_context_semantic(sample))
