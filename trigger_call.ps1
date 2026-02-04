# trigger_call.ps1
# Usage: .\trigger_call.ps1

# --- CONFIGURATION ---
$AccountSid = "YOUR_TWILIO_SID"
$AuthToken = "YOUR_TWILIO_AUTH_TOKEN"
$TwilioNumber = "+441156473116"  # Your Twilio Phone Number
$MyMobileNumber = "+447970809518"    # Your Verified Mobile Number
$NgrokUrl = "https://diactinic-goldenly-clelia.ngrok-free.dev/api/incoming-call" 
# Ensure the URL above matches your current ngrok session!

# --- SCRIPT ---
$auth = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("${AccountSid}:${AuthToken}"))
$uri = "https://api.twilio.com/2010-04-01/Accounts/$AccountSid/Calls.json"

$body = @{
    From   = $TwilioNumber
    To     = $MyMobileNumber
    Url    = $NgrokUrl
    Method = "POST"
}

Write-Host "Triggering call from $TwilioNumber to $MyMobileNumber..."
Write-Host "Webhook: $NgrokUrl"

try {
    $response = Invoke-RestMethod -Uri $uri -Method Post -Headers @{Authorization = ("Basic $auth") } -Body $body
    Write-Host "Success! Call SID: $($response.sid)"
    Write-Host "Pick up your phone!"
}
catch {
    Write-Host "Error triggering call:" -ForegroundColor Red
    Write-Host $_.Exception.Message
    
    # Try to read the full error details from the response stream
    if ($_.Exception.Response) {
        $stream = $_.Exception.Response.GetResponseStream()
        if ($stream) {
            $reader = New-Object System.IO.StreamReader($stream)
            $errorBody = $reader.ReadToEnd()
            Write-Host "Twilio Error Details:" -ForegroundColor Yellow
            Write-Host $errorBody
        }
    }
}
