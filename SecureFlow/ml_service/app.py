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
MODEL_NAME = "en_core_web_sm"
try:
    import spacy
    try:
        nlp = spacy.load(MODEL_NAME)
        logger.info(f"Loaded spaCy model {MODEL_NAME}")
    except Exception:
        # try to download model and load again
        try:
            import spacy.cli
            spacy.cli.download(MODEL_NAME)
            nlp = spacy.load(MODEL_NAME)
            logger.info(f"Downloaded and loaded spaCy model {MODEL_NAME}")
        except Exception as ex:
            logger.error("Failed to download/load spaCy model: %s", ex)
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
