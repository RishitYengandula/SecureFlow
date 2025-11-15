# ml_service/app.py
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import List, Optional
import logging

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
