import re
from typing import List, Dict

try:
    import spacy
    # Prefer a fine-tuned local model if available, then the transformer model,
    # otherwise fall back to the small pipeline.
    try:
        # local fine-tuned model directory
        _nlp = spacy.load("models/ner_lowercase")
    except Exception:
        try:
            _nlp = spacy.load("en_core_web_trf")
        except Exception:
            _nlp = spacy.load("en_core_web_sm")
except Exception:
    _nlp = None

EMAIL = re.compile(r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b')
PHONE = re.compile(r'(?:(?:\+?\d{1,3}[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)?\d{3}[-.\s]?\d{4})')
CREDIT_CARD = re.compile(r'\b(?:\d[ -]*?){13,19}\b')
IPV4 = re.compile(r'\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d?\d)(?:\.|$)){4}\b')
SSN = re.compile(r'\b\d{3}-\d{2}-\d{4}\b')
DOB = re.compile(r'\b(?:\d{1,2}[/\-]\d{1,2}[/\-]\d{2,4})\b')
ACCOUNT = re.compile(r'\b(?:ACCT|ACCOUNT|ACC)[ :\-]?\d{6,}\b', re.I)

def _regex_entities(text: str) -> List[Dict]:
    ents = []
    for regex, etype in [
        (EMAIL, "EMAIL"),
        (PHONE, "PHONE"),
        (CREDIT_CARD, "CREDIT_CARD"),
        (IPV4, "IP_ADDRESS"),
        (SSN, "SSN"),
        (DOB, "DATE"),
        (ACCOUNT, "ACCOUNT")
    ]:
        for m in regex.finditer(text):
            ents.append({"type": etype, "start": m.start(), "end": m.end(), "text": m.group(0)})
    return ents


def _intro_name_entities(text: str) -> List[Dict]:
    """Detect name introductions like 'my name is rishit' or "I'm Rishit" (case-insensitive)
    and return PERSON entities for the captured name spans.
    This heuristic helps when NER models miss lowercase names.
    """
    ents = []
    # Capture patterns: my name is <name>, i am <name>, i'm <name>, call me <name>
    patterns = [
        r"\bmy name is\s+([A-Za-z][A-Za-z'`\-]+(?:\s+[A-Za-z][A-Za-z'`\-]+)*)",
        r"\bi am\s+([A-Za-z][A-Za-z'`\-]+(?:\s+[A-Za-z][A-Za-z'`\-]+)*)",
        r"\bi'm\s+([A-Za-z][A-Za-z'`\-]+(?:\s+[A-Za-z][A-Za-z'`\-]+)*)",
        r"\bcall me\s+([A-Za-z][A-Za-z'`\-]+(?:\s+[A-Za-z][A-Za-z'`\-]+)*)",
    ]

    for p in patterns:
        for m in re.finditer(p, text, re.IGNORECASE):
            name = m.group(1)
            # Compute start/end of the captured name within the whole text
            # m.start(1) and m.end(1) give the indices for group 1
            ents.append({"type": "PERSON", "start": m.start(1), "end": m.end(1), "text": name})

    return ents

def detect_entities(text: str) -> Dict:
    entities: List[Dict] = []

    if _nlp is not None:
        doc = _nlp(text)
        for ent in doc.ents:
            entities.append({
                "type": ent.label_,
                "start": ent.start_char,
                "end": ent.end_char,
                "text": ent.text
            })

    # Add spaCy entities first (if available)

    # Add heuristic-introduced name entities (e.g., "my name is rishit") which
    # help when models miss lowercase names. We'll keep them separately so we
    # can prefer them when they overlap with model detections.
    intro_names = _intro_name_entities(text)
    entities.extend(intro_names)

    # Then add regex-based detections (emails, phones, dates, etc.)
    entities.extend(_regex_entities(text))

    entities.sort(key=lambda x: (x["start"], -(x["end"]-x["start"])))
    filtered = []
    last_end = -1
    for e in entities:
        if e["start"] >= last_end:
            filtered.append(e)
            last_end = e["end"]

    # If an intro-name heuristic matched a span, prefer PERSON type for that
    # span even if a model labeled it differently (e.g., GPE/LOC).
    if intro_names:
        for fn in filtered:
            for iname in intro_names:
                if fn["start"] == iname["start"] and fn["end"] == iname["end"]:
                    fn["type"] = "PERSON"

    summary = {}
    for e in filtered:
        summary[e["type"]] = summary.get(e["type"], 0) + 1

    return {"entities": filtered, "summary": summary}
