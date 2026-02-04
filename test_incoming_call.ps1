# Test the incoming call endpoint with proper form data
$url = "https://app-voice-agent.bluefield-9f0e7247.uksouth.azurecontainerapps.io/api/incoming-call"

# Twilio sends form data, not JSON
$formData = @{
    From       = "+447970809518"
    To         = "+441156473116"
    CallSid    = "CAtest123456"
    CallStatus = "ringing"
}

Write-Host "Testing incoming call endpoint..."
Write-Host "URL: $url"
Write-Host "From: $($formData.From)"
Write-Host "To: $($formData.To)"
Write-Host ""

try {
    $response = Invoke-WebRequest -Uri $url -Method POST -Body $formData -ContentType "application/x-www-form-urlencoded" -UseBasicParsing
    Write-Host "Status: $($response.StatusCode) $($response.StatusDescription)"
    Write-Host ""
    Write-Host "Response Content:"
    Write-Host $response.Content
    Write-Host ""
    
    # Parse the TwiML to check for errors
    if ($response.Content -match "error|Error|ERROR") {
        Write-Host "WARNING: Response contains error text!" -ForegroundColor Yellow
    }
    
}
catch {
    Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
    if ($_.Exception.Response) {
        Write-Host "Status Code: $($_.Exception.Response.StatusCode.value__)"
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        $responseBody = $reader.ReadToEnd()
        Write-Host "Response Body: $responseBody"
    }
}
