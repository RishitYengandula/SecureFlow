# ML Service (spaCy NER)

This folder contains a small FastAPI app (`app.py`) that provides:

- `POST /analyze` (fallback example)
- `POST /ner` spaCy-based NER returning PERSON, LOCATION, ORG, DATE, MONEY, CARDINAL

Quick setup (PowerShell):

```powershell
cd "C:\Users\rosha\OneDrive\Desktop\SecureFlow\SecureFlow\ml_service"
# Recreate venv, install deps, and download the spaCy model
.\
lsetup_and_run.ps1    # or use: .\setup_and_run.ps1 -PythonPath "C:\Path\To\python.exe"
```

Or manually:

```powershell
python -m venv venv
.\venv\Scripts\Activate
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
python -m spacy download en_core_web_sm
uvicorn app:app --reload --host 127.0.0.1 --port 8000
```

Test the NER endpoint:

```powershell
python test_ner.py
# or
curl -X POST http://127.0.0.1:8000/ner -H "Content-Type: application/json" -d '{"text":"Google was founded by Larry Page and Sergey Brin in 1998 in California."}'
```

Troubleshooting:

- If you see errors like `Fatal error in launcher: Unable to create process`, the venv may have been created under a different path; remove `venv` and recreate it, then use `python -m pip` instead of `pip.exe`.
- If the machine has no internet access, you must manually install `en_core_web_sm` and ensure `spacy` is installed in the active venv.
