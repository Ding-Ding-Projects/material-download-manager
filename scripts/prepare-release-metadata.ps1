[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$OutputPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Stop-WithMessage([string]$Message) {
  throw "Release metadata preparation failed: $Message"
}

if ([string]::IsNullOrWhiteSpace($env:GITHUB_REPOSITORY) -or [string]::IsNullOrWhiteSpace($env:GITHUB_SHA)) {
  Stop-WithMessage 'GITHUB_REPOSITORY and GITHUB_SHA are required.'
}

$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$excludedIds = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
$result = $null
$stderrPath = Join-Path ([System.IO.Path]::GetTempPath()) "release-metadata-$([guid]::NewGuid().ToString('N')).stderr.txt"

try {
  while ($true) {
    if ($excludedIds.Count -gt 0) {
      $env:RELEASE_METADATA_EXCLUDE_IDS = $excludedIds -join ','
    } else {
      Remove-Item -Path 'Env:RELEASE_METADATA_EXCLUDE_IDS' -ErrorAction SilentlyContinue
    }

    Push-Location $repositoryRoot
    try {
      $raw = & node scripts/resolve-release-metadata.mjs 2> $stderrPath | Out-String
      $exitCode = $LASTEXITCODE
    } finally {
      Pop-Location
    }
    if (Test-Path -LiteralPath $stderrPath -PathType Leaf) {
      $warnings = Get-Content -LiteralPath $stderrPath -Raw
      if (-not [string]::IsNullOrWhiteSpace($warnings)) {
        Write-Warning $warnings.Trim()
      }
    }
    if ($exitCode -ne 0) {
      Stop-WithMessage 'scripts/resolve-release-metadata.mjs exited with a nonzero status.'
    }
    try {
      $metadata = $raw | ConvertFrom-Json -Depth 50
    } catch {
      Stop-WithMessage 'scripts/resolve-release-metadata.mjs returned malformed JSON.'
    }
    if ($null -eq $metadata -or $metadata -is [array] -or $null -eq $metadata.available) {
      Stop-WithMessage 'Release metadata helper must return one object with available.'
    }

    if (-not [bool]$metadata.available) {
      $result = [pscustomobject]@{
        available = $false
        id = $null
        codeName = 'No public catalog code name was available for this release.'
        en = $null
        zhHant = $null
        assetName = $null
        photoUrl = $null
        catalogReleaseTag = $null
        catalogUrl = $null
        reservationRef = $null
      }
      break
    }

    foreach ($field in @('id', 'en', 'zhHant', 'assetName', 'photoUrl', 'catalogReleaseTag')) {
      if ([string]::IsNullOrWhiteSpace([string]$metadata.$field)) {
        Stop-WithMessage "Available metadata is missing $field."
      }
    }
    if ([string]$metadata.id -notmatch '^[A-Za-z0-9._-]+$') {
      Stop-WithMessage 'Catalog metadata id is not safe for a Git ref.'
    }
    foreach ($field in @('en', 'zhHant', 'assetName', 'catalogReleaseTag')) {
      if ([string]$metadata.$field -match '[\r\n]') {
        Stop-WithMessage "Catalog metadata $field contains a line break."
      }
    }
    if ([string]$metadata.photoUrl -notmatch '^https://[^\s]+$') {
      Stop-WithMessage 'Catalog metadata photoUrl must be HTTPS.'
    }

    $reservationRef = "refs/tags/release-code-name/$($metadata.id)"
    $null = & gh api --method POST "repos/$env:GITHUB_REPOSITORY/git/refs" -f "ref=$reservationRef" -f "sha=$env:GITHUB_SHA" 2>$stderrPath
    if ($LASTEXITCODE -eq 0) {
      $result = [pscustomobject]@{
        available = $true
        id = [string]$metadata.id
        codeName = "$($metadata.en) · $($metadata.zhHant)"
        en = [string]$metadata.en
        zhHant = [string]$metadata.zhHant
        assetName = [string]$metadata.assetName
        photoUrl = [string]$metadata.photoUrl
        catalogReleaseTag = [string]$metadata.catalogReleaseTag
        catalogUrl = 'https://raw.githubusercontent.com/Ding-Ding-Projects/dim-sum-photos/main/catalog/index.json'
        reservationRef = $reservationRef
      }
      break
    }

    $existingRef = & gh api "repos/$env:GITHUB_REPOSITORY/git/ref/tags/release-code-name/$($metadata.id)" 2>$null | Out-String
    if ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace($existingRef)) {
      [void]$excludedIds.Add([string]$metadata.id)
      continue
    }
    Stop-WithMessage "Could not reserve catalog code-name ref $reservationRef."
  }
} finally {
  Remove-Item -LiteralPath $stderrPath -Force -ErrorAction SilentlyContinue
  Remove-Item -Path 'Env:RELEASE_METADATA_EXCLUDE_IDS' -ErrorAction SilentlyContinue
}

if ($null -eq $result) {
  Stop-WithMessage 'No release metadata result was produced.'
}
$outputDirectory = Split-Path -Parent ([System.IO.Path]::GetFullPath($OutputPath))
if (-not (Test-Path -LiteralPath $outputDirectory -PathType Container)) {
  New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
}
$result | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $OutputPath -Encoding utf8NoBOM
Write-Output "Release metadata prepared: $($result.codeName)"
