param(
    [string]$BaseUrl = "http://localhost:3000",
    [string]$Email = $env:DASHBOARD_TEST_EMAIL,
    [string]$Password = $env:DASHBOARD_TEST_PASSWORD,
    [string]$Message = "How do I configure postcode lookup with Supabase?"
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($Email) -or [string]::IsNullOrWhiteSpace($Password)) {
    Write-Error "Set DASHBOARD_TEST_EMAIL and DASHBOARD_TEST_PASSWORD first."
    exit 1
}

$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession

Write-Host "1) Fetching CSRF token..."
$csrfRes = Invoke-RestMethod -Method GET -Uri "$BaseUrl/api/auth/csrf" -WebSession $session
$csrfToken = $csrfRes.csrfToken
if ([string]::IsNullOrWhiteSpace($csrfToken)) {
    Write-Error "Failed to get CSRF token."
    exit 1
}

Write-Host "2) Signing in..."
$loginForm = @{
    csrfToken = $csrfToken
    email = $Email
    password = $Password
    json = "true"
    redirect = "false"
}

$loginRes = Invoke-RestMethod `
    -Method POST `
    -Uri "$BaseUrl/api/auth/callback/credentials" `
    -WebSession $session `
    -ContentType "application/x-www-form-urlencoded" `
    -Body $loginForm

if ($loginRes.url -match "error=") {
    Write-Error "Login failed. Response: $($loginRes | ConvertTo-Json -Compress)"
    exit 1
}

Write-Host "3) Calling copilot endpoint..."
$payload = @{
    message = $Message
    context = @{
        kbAware = $true
        useContext = $true
        selectedWorkflowKey = "first_response"
        configSnapshot = @{
            workflows = @{
                first_response = @{
                    nodes = @(
                        @{
                            id = "1"
                            data = @{
                                label = "Knowledge Base"
                                actionType = "knowledge_search"
                                actionConfig = @{
                                    endpoint = "https://example.search.windows.net"
                                    index_name = "kb-index"
                                    api_key_env = "AZURE_SEARCH_API_KEY"
                                }
                            }
                        }
                    )
                }
            }
            database_connections = @{
                pnj_supabase = @{
                    type = "supabase_rest"
                    supabase_url = "https://example.supabase.co"
                    supabase_key_env = "SUPABASE_SERVICE_ROLE_KEY"
                }
            }
        }
    }
} | ConvertTo-Json -Depth 12

$copilotRes = Invoke-RestMethod `
    -Method POST `
    -Uri "$BaseUrl/api/copilot/workflow-assistant" `
    -WebSession $session `
    -ContentType "application/json" `
    -Body $payload

Write-Host ""
Write-Host "Copilot reply:"
Write-Host "----------------------------------------"
Write-Host $copilotRes.reply
Write-Host "----------------------------------------"
Write-Host "Authenticated copilot smoke test passed."

