param(
    [string]$SearchEndpoint = $env:AZURE_SEARCH_ENDPOINT,
    [string]$SearchAdminKey = $env:AZURE_SEARCH_ADMIN_KEY,
    [string]$IndexName = "kb-test-pnj",
    [string]$ApiVersion = "2023-11-01"
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($SearchEndpoint)) {
    Write-Error "Missing AZURE_SEARCH_ENDPOINT."
    exit 1
}
if ([string]::IsNullOrWhiteSpace($SearchAdminKey)) {
    Write-Error "Missing AZURE_SEARCH_ADMIN_KEY."
    exit 1
}
if ($SearchEndpoint -match "<your-search-service>" -or $SearchEndpoint -match "^https://<") {
    Write-Error "AZURE_SEARCH_ENDPOINT is still a placeholder. Use your real endpoint, e.g. https://my-search.search.windows.net"
    exit 1
}

$base = $SearchEndpoint.TrimEnd("/")
$headers = @{
    "Content-Type" = "application/json"
    "api-key" = $SearchAdminKey
}

$schemaPath = Join-Path $PSScriptRoot "kb_test_pack\azure_index_schema.json"
$docsPath = Join-Path $PSScriptRoot "kb_test_pack\azure_docs_upload.json"

if (!(Test-Path $schemaPath)) {
    Write-Error "Schema file not found: $schemaPath"
    exit 1
}
if (!(Test-Path $docsPath)) {
    Write-Error "Docs file not found: $docsPath"
    exit 1
}

$schemaObj = Get-Content $schemaPath -Raw | ConvertFrom-Json
$schemaObj.name = $IndexName
$schemaJson = $schemaObj | ConvertTo-Json -Depth 20

Write-Host "Creating/updating index '$IndexName'..."
$indexUrl = "{0}/indexes/{1}?api-version={2}" -f $base, $IndexName, $ApiVersion
Invoke-RestMethod -Method Put -Uri $indexUrl -Headers $headers -Body $schemaJson | Out-Null

Write-Host "Uploading sample documents..."
$docsJson = Get-Content $docsPath -Raw
$docsUrl = "{0}/indexes/{1}/docs/index?api-version={2}" -f $base, $IndexName, $ApiVersion
Invoke-RestMethod -Method Post -Uri $docsUrl -Headers $headers -Body $docsJson | Out-Null

Write-Host "KB test pack ready."
Write-Host "Endpoint: $base"
Write-Host "Index:    $IndexName"
Write-Host "Now configure the Knowledge Search node with:"
Write-Host "  endpoint      = $base"
Write-Host "  index_name    = $IndexName"
Write-Host "  api_key_env   = AZURE_SEARCH_API_KEY (query key recommended in app env)"
