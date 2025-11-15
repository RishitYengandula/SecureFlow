param(
  [int]$Port = 8000,
  [string]$Host = "127.0.0.1"
)

$cwd = Split-Path -Parent $MyInvocation.MyCommand.Definition
Set-Location $cwd

Write-Host "Activating venv and starting ML service on $Host:$Port" -ForegroundColor Cyan
. .\venv\Scripts\Activate

# Use the venv's uvicorn if installed, otherwise rely on PATH
uvicorn app:app --reload --host $Host --port $Port
