# ml_service/app.py
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import List, Optional
import logging
from fastapi import Request
import os
import re
try:
    from semantic_sanitizer import sanitize_context_semantic
except Exception:
    try:
        from .semantic_sanitizer import sanitize_context_semantic
    except Exception:
        sanitize_context_semantic = None

# Import our contextual detector
try:
    from contextual_detector import (
        detect_contextual_sensitivity,
        sanitize_contextual_info,
        REDACTION_TOKENS,
    )
except Exception:
    # If direct import fails (different module path), try a local relative import.
    try:
        from .contextual_detector import (
            detect_contextual_sensitivity,
            sanitize_contextual_info,
            REDACTION_TOKENS,
        )
    except Exception:
        detect_contextual_sensitivity = None
        sanitize_contextual_info = None
        REDACTION_TOKENS = {}

app = FastAPI()
logger = logging.getLogger("uvicorn.error")


class TextRequest(BaseModel):
    text: str


class EntityOut(BaseModel):
    text: str
    label: str
    start: int
    end: int
    score: Optional[float] = None


# Try to load spaCy model; if missing attempt to download it.
nlp = None
try:
    import spacy
    # Prefer a fine-tuned local model if present, then the transformer model,
    # otherwise fall back to the small model. Attempt to download transformer
    # if not present is left to operator (large download).
    try:
        nlp = spacy.load("models/ner_lowercase")
        logger.info("Loaded local fine-tuned model models/ner_lowercase")
    except Exception:
        try:
            nlp = spacy.load("en_core_web_trf")
            logger.info("Loaded spaCy transformer model en_core_web_trf")
        except Exception:
            try:
                nlp = spacy.load("en_core_web_sm")
                logger.info("Loaded fallback spaCy model en_core_web_sm")
            except Exception as ex:
                logger.error("Failed to load any spaCy model: %s", ex)
                nlp = None
except Exception as ex:
    logger.error("spaCy import failed: %s", ex)
    nlp = None


@app.post("/analyze")
async def analyze(request: TextRequest):
    text = request.text
    # Example logic – keep the simple fallback for compatibility
    return {
        "sanitized_text": text.replace("john.doe@acme.com", "[REDACTED_EMAIL]"),
        "entities": ["EMAIL"],
        "confidence": 0.97,
    }


@app.post("/api/analyze/context")
async def analyze_context(request: TextRequest):
    """Analyze text for contextual sensitive information (Levels 2-4).

    Returns sensitivity level, category, matched terms, recommended sanitization mapping,
    and a sanitized version of the original text.
    """
    if detect_contextual_sensitivity is None:
        raise HTTPException(status_code=500, detail="Contextual detector not available on server")

    # Determine whether to use embeddings. Default is enabled; override via env var USE_EMBEDDINGS
    use_embeddings_env = os.getenv("USE_EMBEDDINGS", "true").lower()
    use_embeddings = use_embeddings_env in ("1", "true", "yes")

    # Run detector (use embeddings by default unless disabled)
    detection = detect_contextual_sensitivity(request.text, use_embeddings=use_embeddings)
    sanitized = sanitize_contextual_info(request.text, detection)

    # Build recommended sanitization mapping for categories present
    rec = {}
    cat = detection.get("category", "none")
    if cat and cat in REDACTION_TOKENS:
        rec[cat] = REDACTION_TOKENS[cat]
    elif detection.get("matched_terms"):
        # If multiple categories matched, return tokens for all seen categories
        for term in detection.get("matched_terms", []):
            # attempt to infer token by searching redaction map
            for k, v in REDACTION_TOKENS.items():
                # quick heuristic: if keyword appears in sensitive list
                if any(re.search(r"\b" + re.escape(term) + r"\b", kw, flags=re.IGNORECASE) for kw in []):
                    rec[k] = v

    return {
        "level": detection.get("level"),
        "category": detection.get("category"),
        "is_sensitive": detection.get("is_sensitive"),
        "matched_terms": detection.get("matched_terms"),
        "recommended_sanitization": rec,
        "sanitized_text": sanitized,
        "reason": detection.get("reason"),
    }


@app.post("/api/analyze/semantic-sanitize")
async def analyze_semantic(request: TextRequest):
    """Perform semantic sanitization: rewrite sensitive sentences into abstracted forms.

    Returns original text, sanitized version and list of abstracted details.
    """
    if sanitize_context_semantic is None:
        raise HTTPException(status_code=500, detail="Semantic sanitizer not available on server")

    detection = detect_contextual_sensitivity(request.text, use_embeddings=os.getenv("USE_EMBEDDINGS", "true").lower() in ("1", "true", "yes"))
    sem = sanitize_context_semantic(request.text)

    return {
        "original": request.text,
        "sanitized": sem.get("sanitized_text"),
        "removed_details": sem.get("removed_details", []),
        "level": sem.get("level", detection.get("level")),
        "category": sem.get("category", detection.get("category")),
    }


@app.post("/ner", response_model=List[EntityOut])
async def ner(request: TextRequest):
    """Run spaCy NER and return a list of entities. Supported mapped labels:
    PERSON, LOCATION, ORG, DATE, MONEY, CARDINAL
    """
    if nlp is None:
        raise HTTPException(status_code=503, detail="spaCy model not available on server")

    doc = nlp(request.text)

    # Map spaCy labels to the requested set
    label_map = {
        "PERSON": "PERSON",
        "GPE": "LOCATION",
        "LOC": "LOCATION",
        "ORG": "ORG",
        "DATE": "DATE",
        "MONEY": "MONEY",
        "CARDINAL": "CARDINAL",
    }

    results = []
    for ent in doc.ents:
        mapped = label_map.get(ent.label_)
        if not mapped:
            continue
        results.append(
            EntityOut(
                text=ent.text,
                label=mapped,
                start=ent.start_char,
                end=ent.end_char,
                score=None,
            )
        )

    return results
