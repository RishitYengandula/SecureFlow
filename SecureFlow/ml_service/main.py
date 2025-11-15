from fastapi import FastAPI
from pydantic import BaseModel
import re

app = FastAPI()

class InputText(BaseModel):
    text: str

# Simple regex detections for now
def detect_entities(text):
    entities = []

    email_pattern = r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}"
    phone_pattern = r"\b[6-9]\d{9}\b"
    aadhaar_pattern = r"\b\d{4}\s?\d{4}\s?\d{4}\b"
    pan_pattern = r"\b[A-Z]{5}[0-9]{4}[A-Z]\b"

    if re.search(email_pattern, text):
        entities.append("EMAIL")
    if re.search(phone_pattern, text):
        entities.append("PHONE")
    if re.search(aadhaar_pattern, text):
        entities.append("AADHAAR")
    if re.search(pan_pattern, text):
        entities.append("PAN")

    # Heuristic: detect name introductions like "my name is rishit" or "i am rishit"
    intro_name_re = re.compile(r"\b(?:my name is|i am|i'm|call me)\s+([A-Za-z][A-Za-z'`\-]+(?:\s+[A-Za-z][A-Za-z'`\-]+)*)", re.IGNORECASE)
    if intro_name_re.search(text):
        entities.append("PERSON")

    return entities

@app.post("/analyze")
def analyze_text(input: InputText):
    text = input.text
    entities = detect_entities(text)

    return {
        "entities": entities,
        "count": len(entities),
        "sanitized_text": text
    }
