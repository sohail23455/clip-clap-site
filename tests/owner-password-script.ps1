# Offline tests: intercept every prompt and HTTP request; never contact Supabase.
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/../scripts/set-owner-password.ps1"
$script:ownerId = '11223344-5566-4788-9900-112233445566'
$script:ownerEmail = 'owner@example.test'
$script:secret = 'offline-test-service-key'
$script:password = 'Offline-test-password-123'
function Assert($Value, $Message) { if (-not $Value) { throw $Message } }
function Write-Host { param($Object, $ForegroundColor) $script:messages.Add([string]$Object) }
function Read-Host {
    param($Prompt, [switch]$AsSecureString)
    Assert $AsSecureString 'All requested secrets must use masked input'
    if ($Prompt -like 'SUPABASE_SERVICE_ROLE_KEY*') { return ConvertTo-SecureString $script:secret -AsPlainText -Force }
    if ($Prompt -like 'Confirm*' -and $script:mode -eq 'mismatch') { return ConvertTo-SecureString 'Different-password-123' -AsPlainText -Force }
    $value = if ($script:mode -eq 'short') { 'short' } else { $script:password }
    return ConvertTo-SecureString $value -AsPlainText -Force
}
function Invoke-RestMethod {
    param($Uri,$Method,$Headers,$ContentType,$TimeoutSec,$MaximumRedirection,$ErrorAction,$Body)
    Assert ($Uri -ceq "https://offline-test.supabase.co/auth/v1/admin/users/$script:ownerId") 'Only the existing UUID endpoint is permitted'
    Assert ($Headers.apikey -ceq $script:secret) 'Admin API key missing'
    Assert ($MaximumRedirection -eq 0) 'Redirects must be disabled'
    $user = [pscustomobject]@{ id=$script:ownerId; email=$script:ownerEmail; email_confirmed_at='2026-01-01' }
    if ($Method -eq 'GET') {
        if ($script:mode -eq 'wrong-id') { $user.id = '00000000-0000-0000-0000-000000000000' }
        if ($script:mode -eq 'wrong-email') { $user.email = 'other@example.test' }
        if ($script:mode -eq 'unconfirmed') { $user.email_confirmed_at = $null }
        return $user
    }
    Assert ($Method -eq 'PUT') 'Never create a user or send recovery email'
    $script:updates++
    $data = [Text.Encoding]::UTF8.GetString($Body) | ConvertFrom-Json
    Assert (@($data.PSObject.Properties.Name).Count -eq 1) 'Must update only the password'
    Assert ($data.password -ceq $script:password) 'Wrong password update'
    if ($script:mode -eq 'api-error') { throw "DO NOT PRINT: $script:secret $script:password" }
    return $user
}
$env:SUPABASE_URL = 'https://offline-test.supabase.co'
$env:OWNER_EMAIL = $script:ownerEmail
$env:OWNER_USER_ID = $script:ownerId
$env:SUPABASE_SERVICE_ROLE_KEY = ''
$passed = 0
foreach ($case in @('success','wrong-id','wrong-email','unconfirmed','mismatch','short','api-error','wrong-config')) {
    $script:mode = $case; $script:updates = 0
    $script:messages = [Collections.Generic.List[string]]::new()
    $env:OWNER_EMAIL = if ($case -eq 'wrong-config') { 'other@example.test' } else { $script:ownerEmail }
    $failure = $null
    try { Set-ExistingOwnerPassword } catch { $failure = $_.Exception.Message }
    if ($case -eq 'success') { Assert (-not $failure) 'Successful update should complete'; Assert ($script:updates -eq 1) 'Expected one update' }
    else { Assert ($null -ne $failure) "Expected rejection: $case"; Assert ($script:updates -eq $(if ($case -eq 'api-error') {1} else {0})) 'Rejected input must not update the user' }
    $output = ($script:messages -join ' ') + $failure
    Assert (-not $output.Contains($script:secret) -and -not $output.Contains($script:password)) 'Secret leaked into output'
    $passed++
}
Write-Output "$passed secure owner-password script checks passed. All requests were mocked."
