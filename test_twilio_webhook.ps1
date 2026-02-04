# Test the Twilio webhook endpoint
$url = "https://app-voice-agent.bluefield-9f0e7247.uksouth.azurecontainerapps.io/api/incoming-call"

# Simulate a Twilio POST request
$body = @{
    From    = "+447970809518"
    To      = "+441156473116"
    CallSid = "CAtest123"
} | ConvertTo-Json

Write-Host "Testing Twilio webhook at: $url"
Write-Host "Request body: $body"

try {
    $response = Invoke-WebRequest -Uri $url -Method POST -Body $body -ContentType "application/x-www-form-urlencoded" -UseBasicParsing
    Write-Host "`nResponse Status: $($response.StatusCode)"
    Write-Host "Response Content:"
    Write-Host $response.Content
}
catch {
    Write-Host "`nError: $_"
    Write-Host "Status Code: $($_.Exception.Response.StatusCode.value__)"
}
