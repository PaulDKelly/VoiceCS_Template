# Deploy Workflow Manager Dashboard to ACA (Cloud Build)
# Usage: .\deploy_dashboard_to_aca.ps1

$ErrorActionPreference = "Stop"

# --- CONFIGURATION ---
$RESOURCE_GROUP = "rg-voice-bot"
$LOCATION = "uksouth"
$ACA_ENV_NAME = "env-voice-bot"
$APP_NAME = "app-workflow-manager"
$IMAGE_TAG = "v2"

# --- ACR ---
$ACR_NAME = az acr list --resource-group $RESOURCE_GROUP --query "[0].name" -o tsv
if (-not $ACR_NAME) {
    Write-Error "No ACR found in resource group $RESOURCE_GROUP"
}

Write-Host "Using ACR: $ACR_NAME" -ForegroundColor Green

# --- Build Dashboard Image (Cloud Build) ---
Write-Host "Building dashboard image in ACR..." -ForegroundColor Cyan
az acr build --registry $ACR_NAME --image "dashboard:$IMAGE_TAG" --file dashboard/Dockerfile dashboard --no-logs

$ACR_LOGIN_SERVER = az acr show --name $ACR_NAME --query loginServer --output tsv
$IMAGE_URI = "$ACR_LOGIN_SERVER/dashboard:$IMAGE_TAG"

# --- Pull current NEXTAUTH settings from existing app (fallback) ---
$CURRENT_ENV = az containerapp show --name $APP_NAME --resource-group $RESOURCE_GROUP --query properties.template.containers[0].env -o json | ConvertFrom-Json
$NEXTAUTH_SECRET = ($CURRENT_ENV | Where-Object { $_.name -eq "NEXTAUTH_SECRET" }).value
$NEXTAUTH_URL = ($CURRENT_ENV | Where-Object { $_.name -eq "NEXTAUTH_URL" }).value

if (-not $NEXTAUTH_SECRET) {
    $NEXTAUTH_SECRET = "super-secret-key-change-me"
}
if (-not $NEXTAUTH_URL) {
    $NEXTAUTH_URL = "https://$((az containerapp show --name $APP_NAME --resource-group $RESOURCE_GROUP --query properties.configuration.ingress.fqdn -o tsv))"
}

# --- Prepare YAML ---
$templatePath = "deployment/dashboard.yaml.template"
$outputPath = "deployment/dashboard.yaml"
$content = Get-Content $templatePath -Raw
$content = $content.Replace("ACR_LOGIN_SERVER_PLACEHOLDER", $ACR_LOGIN_SERVER)
$content = $content.Replace("ACR_NAME_PLACEHOLDER", $ACR_NAME)
$content = $content.Replace("IMAGE_URI_PLACEHOLDER", $IMAGE_URI)
$content = $content.Replace("NEXTAUTH_SECRET_PLACEHOLDER", $NEXTAUTH_SECRET)
$content = $content.Replace("NEXTAUTH_URL_PLACEHOLDER", $NEXTAUTH_URL)
$content | Out-File -FilePath $outputPath -Encoding utf8

# --- Update app ---
$ACR_PASSWORD = az acr credential show --name $ACR_NAME --query "passwords[0].value" -o tsv
az containerapp secret set --name $APP_NAME --resource-group $RESOURCE_GROUP --secrets "acr-password=$ACR_PASSWORD"
az containerapp update --name $APP_NAME --resource-group $RESOURCE_GROUP --yaml $outputPath

$FQDN = az containerapp show --name $APP_NAME --resource-group $RESOURCE_GROUP --query properties.configuration.ingress.fqdn -o tsv
Write-Host "`nSUCCESS! Dashboard Deployed." -ForegroundColor Green
Write-Host "Dashboard URL: https://$FQDN" -ForegroundColor Green
