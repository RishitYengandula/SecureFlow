param(
  [string]$PythonPath = "python"
)

# Run from ml_service folder
$cwd = Split-Path -Parent $MyInvocation.MyCommand.Definition
Set-Location $cwd

if (Test-Path .\venv) {
  Write-Host "Removing existing venv..." -ForegroundColor Yellow
  Remove-Item -Recurse -Force .\venv
}

Write-Host "Creating venv..." -ForegroundColor Cyan
& $PythonPath -m venv venv

Write-Host "Activating venv..." -ForegroundColor Cyan
. .\venv\Scripts\Activate

Write-Host "Upgrading pip..." -ForegroundColor Cyan
python -m pip install --upgrade pip

Write-Host "Installing requirements..." -ForegroundColor Cyan
python -m pip install -r requirements.txt

Write-Host "Downloading spaCy model (en_core_web_sm)..." -ForegroundColor Cyan
python -m spacy download en_core_web_sm

Write-Host "Setup complete. Start the ML service with: .\run_ml_service.ps1" -ForegroundColor Green
