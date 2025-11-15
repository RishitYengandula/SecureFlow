param(
  [int]$Epochs = 30
)

$cwd = Split-Path -Parent $MyInvocation.MyCommand.Definition
Set-Location $cwd

Write-Host "Activating venv and running NER training ($Epochs epochs)" -ForegroundColor Cyan
. .\venv\Scripts\Activate

python train_ner.py

Write-Host "Training finished. Model saved to models/ner_lowercase (if successful)." -ForegroundColor Green
