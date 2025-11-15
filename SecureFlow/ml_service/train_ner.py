"""
Fine-tune a spaCy NER model to better recognize lowercase person introductions.

This script will:
 - load `en_core_web_trf` if available (recommended), otherwise `en_core_web_sm`
 - add PERSON labels from provided examples (with lowercase names)
 - run a small number of update iterations and save the model to `models/ner_lowercase`

Usage:
  python train_ner.py

Notes:
 - Transformer models require `spacy[transformers]` and a backend like PyTorch.
 - Training a transformer model can be slow. For quick experiments you can
   set `base_model = "en_core_web_sm"` to speed things up.
"""
import random
from pathlib import Path

import spacy
from spacy.util import minibatch, compounding


BASE_MODEL = "en_core_web_trf"
OUT_DIR = Path("models/ner_lowercase")


TRAIN_DATA = [
    ("my name is rishit and i study cse", {"entities": [(11, 17, "PERSON")] }),
    ("hi i'm rishit", {"entities": [(4, 10, "PERSON")] }),
    ("i am rishit", {"entities": [(5, 11, "PERSON")] }),
    ("call me rishit", {"entities": [(8, 14, "PERSON")] }),
    ("my name is alice", {"entities": [(11, 16, "PERSON")] }),
    ("hey i'm alice", {"entities": [(4, 9, "PERSON")] }),
    ("my name is john doe", {"entities": [(11, 19, "PERSON")] }),
    ("i am john", {"entities": [(5, 9, "PERSON")] }),
]


def load_base_model():
    try:
        nlp = spacy.load(BASE_MODEL)
        print(f"Loaded base model: {BASE_MODEL}")
    except Exception as e:
        print(f"Could not load {BASE_MODEL}: {e}. Falling back to en_core_web_sm")
        nlp = spacy.load("en_core_web_sm")
    return nlp


def ensure_ner(nlp):
    if "ner" not in nlp.pipe_names:
        ner = nlp.add_pipe("ner")
    else:
        ner = nlp.get_pipe("ner")
    return ner


def train(n_iter=20):
    nlp = load_base_model()
    ner = ensure_ner(nlp)

    # Add PERSON label
    ner.add_label("PERSON")

    # Disable other pipes for training
    pipe_exceptions = ["ner", "trf_wordpiecer", "trf_tok2vec"]
    other_pipes = [p for p in nlp.pipe_names if p not in pipe_exceptions]

    with nlp.disable_pipes(*other_pipes):
        optimizer = nlp.resume_training()
        for itn in range(n_iter):
            random.shuffle(TRAIN_DATA)
            losses = {}
            batches = minibatch(TRAIN_DATA, size=compounding(2.0, 8.0, 1.5))
            for batch in batches:
                texts = [t[0] for t in batch]
                annotations = [t[1] for t in batch]
                nlp.update(texts, annotations, sgd=optimizer, drop=0.2, losses=losses)
            print(f"Iteration {itn+1}/{n_iter} Losses: {losses}")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    nlp.to_disk(OUT_DIR)
    print(f"Saved fine-tuned model to {OUT_DIR}")


if __name__ == "__main__":
    train(n_iter=30)
