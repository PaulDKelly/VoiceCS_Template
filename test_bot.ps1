# Quick Bot Framework Test Script
# Tests your local bot endpoint

$BASE_URL = "http://localhost:8000"

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "BOT FRAMEWORK ENDPOINT TESTS" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "Testing URL: $BASE_URL" -ForegroundColor Yellow
Write-Host ""

# Test 1: Health Check
Write-Host "Test 1: Health Endpoint..." -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri "$BASE_URL/health" -UseBasicParsing -Method Get
    if ($response.StatusCode -eq 200) {
        Write-Host "[PASS] Health Check" -ForegroundColor Green
        Write-Host "Response: $($response.Content)" -ForegroundColor Gray
    }
    else {
        Write-Host "[FAIL] Health Check (Status: $($response.StatusCode))" -ForegroundColor Red
    }
}
catch {
    Write-Host "[FAIL] Health Check" -ForegroundColor Red
    Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host ""

# Test 2: Bot Messages Endpoint
Write-Host "Test 2: Bot Messages Endpoint..." -ForegroundColor Yellow

$activity = @{
    type         = "message"
    id           = "test-001"
    timestamp    = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
    channelId    = "emulator"
    from         = @{
        id   = "user123"
        name = "Test User"
    }
    conversation = @{
        id = "test-conversation-001"
    }
    recipient    = @{
        id   = "bot"
        name = "VoiceCS Bot"
    }
    text         = "Hello"
    locale       = "en-GB"
} | ConvertTo-Json -Depth 10

try {
    $response = Invoke-WebRequest -Uri "$BASE_URL/api/messages" -Method Post -Body $activity -ContentType "application/json" -UseBasicParsing
    
    if ($response.StatusCode -eq 200) {
        Write-Host "[PASS] Bot Messages Endpoint" -ForegroundColor Green
        Write-Host "Bot is accepting messages!" -ForegroundColor Gray
    }
    else {
        Write-Host "[FAIL] Bot Messages (Status: $($response.StatusCode))" -ForegroundColor Red
    }
}
catch {
    Write-Host "[FAIL] Bot Messages Endpoint" -ForegroundColor Red
    Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
    if ($_.Exception.Response) {
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        $responseBody = $reader.ReadToEnd()
        Write-Host "Response: $responseBody" -ForegroundColor Red
    }
}

Write-Host ""

# Summary
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "TESTING COMPLETE" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next Steps:" -ForegroundColor Yellow
Write-Host "1. Check server logs for 'REPLY:' to see agent responses" -ForegroundColor White
Write-Host "2. Use Bot Framework Emulator for interactive testing" -ForegroundColor White
Write-Host "   Download: https://github.com/Microsoft/BotFramework-Emulator/releases" -ForegroundColor Cyan
Write-Host ""
