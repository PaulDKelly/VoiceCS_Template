# Start the bot with aiohttp (official Microsoft approach)
# This uses bot_main.py instead of main.py

$env:CLIENT_ID = "autonova"
$env:INDUSTRY = "automotive"

Write-Host "Starting bot server (aiohttp version) with environment:" -ForegroundColor Yellow
Write-Host "  CLIENT_ID = $env:CLIENT_ID" -ForegroundColor Gray
Write-Host "  INDUSTRY = $env:INDUSTRY" -ForegroundColor Gray
Write-Host ""

.\.venv\Scripts\python.exe bot_main.py
