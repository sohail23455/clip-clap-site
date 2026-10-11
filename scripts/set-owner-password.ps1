# Run locally in PowerShell. Never pass a password or service key as an argument.
# This script is excluded from the website's static build and has no HTTP route.
Set-StrictMode -Version Latest

function Invoke-OwnerAdminRequest {
    param([string]$Url, [string]$Key, [string]$Method, [string]$Body)
    $request = @{
        Uri = $Url
        Method = $Method
        Headers = @{ apikey = $Key; Authorization = "Bearer $Key" }
        ContentType = 'application/json'
        TimeoutSec = 20
        MaximumRedirection = 0
        ErrorAction = 'Stop'
    }
    if ($Body) { $request.Body = [Text.Encoding]::UTF8.GetBytes($Body) }
    try { return Invoke-RestMethod @request }
    catch { throw 'Supabase Admin request failed. Check the project, service-role key, user UUID, and password policy locally. Request details are intentionally hidden.' }
}

function Assert-ExistingOwner {
    param($User, [string]$OwnerId, [string]$OwnerEmail)
    if (-not $User -or $User.id -cne $OwnerId -or $User.email -ine $OwnerEmail -or -not $User.email_confirmed_at) {
        throw 'Stopped: the existing user must match the configured owner UUID and confirmed email.'
    }
}

function Set-ExistingOwnerPassword {
    [CmdletBinding()]
    param()
    $ErrorActionPreference = 'Stop'
    $key = $null; $password = $null; $confirmation = $null; $body = $null
    $keySecure = $null; $passwordSecure = $null; $confirmationSecure = $null
    try {
        Write-Host 'Clip Clap: set a password on the EXISTING confirmed owner account.'
        Write-Host 'Use the existing Production values from Vercel. No account or UUID will be created or changed.'
        $url = $env:SUPABASE_URL
        if (-not $url) { $url = Read-Host 'Existing SUPABASE_URL (https://project-ref.supabase.co)' }
        if ($url -cnotmatch '^https://[a-z0-9-]+\.supabase\.co$') { throw 'Invalid Supabase project URL.' }
        $ownerEmail = $env:OWNER_EMAIL
        if (-not $ownerEmail) { $ownerEmail = Read-Host 'Existing OWNER_EMAIL (copy exactly from Vercel)' }
        if ([string]::IsNullOrWhiteSpace($ownerEmail)) { throw 'The existing OWNER_EMAIL is required.' }
        $ownerId = $env:OWNER_USER_ID
        if (-not $ownerId) { $ownerId = Read-Host 'Existing OWNER_USER_ID (copy exactly from Vercel)' }
        if ($ownerId -cnotmatch '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') { throw 'Invalid owner UUID.' }
        $key = $env:SUPABASE_SERVICE_ROLE_KEY
        if (-not $key) {
            $keySecure = Read-Host 'SUPABASE_SERVICE_ROLE_KEY (hidden; local use only)' -AsSecureString
            $key = [Net.NetworkCredential]::new('', $keySecure).Password
        }
        if ([string]::IsNullOrWhiteSpace($key)) { throw 'A service-role key is required.' }
        $endpoint = "$url/auth/v1/admin/users/$ownerId"
        $existing = Invoke-OwnerAdminRequest -Url $endpoint -Key $key -Method 'GET'
        Assert-ExistingOwner -User $existing -OwnerId $ownerId -OwnerEmail $ownerEmail
        Write-Host "Verified existing confirmed owner: $ownerEmail ($ownerId)"
        $passwordSecure = Read-Host 'New owner password (hidden; at least 12 characters)' -AsSecureString
        $confirmationSecure = Read-Host 'Confirm new password (hidden)' -AsSecureString
        $password = [Net.NetworkCredential]::new('', $passwordSecure).Password
        $confirmation = [Net.NetworkCredential]::new('', $confirmationSecure).Password
        if ($password.Length -lt 12 -or $password.Length -gt 1024) { throw 'Use a password between 12 and 1024 characters.' }
        if ($password -cne $confirmation) { throw 'Passwords do not match. No update was sent.' }
        # Intentionally update ONLY password. Never email, confirmation, UUID, or metadata.
        $body = @{ password = $password } | ConvertTo-Json -Compress
        $updated = Invoke-OwnerAdminRequest -Url $endpoint -Key $key -Method 'PUT' -Body $body
        Assert-ExistingOwner -User $updated -OwnerId $ownerId -OwnerEmail $ownerEmail
        Write-Host 'Password updated. Sign in at https://clipclap.mskmpt.pro/admin. No recovery email or OTP was requested.'
    }
    finally {
        $key = $null; $password = $null; $confirmation = $null; $body = $null
        if ($keySecure) { $keySecure.Dispose() }
        if ($passwordSecure) { $passwordSecure.Dispose() }
        if ($confirmationSecure) { $confirmationSecure.Dispose() }
    }
}

if ($MyInvocation.InvocationName -ne '.') {
    try { Set-ExistingOwnerPassword }
    catch { Write-Host ('Stopped: ' + $_.Exception.Message) -ForegroundColor Red; exit 1 }
}
