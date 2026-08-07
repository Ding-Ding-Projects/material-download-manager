[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$OutputPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Stop-WithMessage([string]$Message) {
  throw "Release version resolution failed: $Message"
}

function Parse-Semver([string]$Value) {
  if ([string]::IsNullOrWhiteSpace($Value) -or $Value -notmatch '^(?:v)?(?<major>0|[1-9]\d*)\.(?<minor>0|[1-9]\d*)\.(?<patch>0|[1-9]\d*)$') {
    return $null
  }
  return [pscustomobject]@{
    Major = [int64]$Matches.major
    Minor = [int64]$Matches.minor
    Patch = [int64]$Matches.patch
  }
}

function Compare-Semver($Left, $Right) {
  foreach ($field in @('Major', 'Minor', 'Patch')) {
    if ($Left.$field -gt $Right.$field) { return 1 }
    if ($Left.$field -lt $Right.$field) { return -1 }
  }
  return 0
}

function Normalize-Tag($Version) {
  return "v$($Version.Major).$($Version.Minor).$($Version.Patch)"
}

if ([string]::IsNullOrWhiteSpace($env:GITHUB_REPOSITORY) -or [string]::IsNullOrWhiteSpace($env:GITHUB_SHA)) {
  Stop-WithMessage 'GITHUB_REPOSITORY and GITHUB_SHA are required.'
}

$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$packagePath = Join-Path $repositoryRoot 'design/package.json'
try {
  $package = Get-Content -LiteralPath $packagePath -Raw | ConvertFrom-Json -Depth 30
} catch {
  Stop-WithMessage 'design/package.json is malformed JSON.'
}
$packageVersion = Parse-Semver ([string]$package.version)
if ($null -eq $packageVersion) {
  Stop-WithMessage 'design/package.json must contain a stable MAJOR.MINOR.PATCH version.'
}

$releaseJson = & gh release list --repo $env:GITHUB_REPOSITORY --limit 1000 --json tagName,isDraft,isPrerelease 2>&1 | Out-String
if ($LASTEXITCODE -ne 0) {
  Stop-WithMessage 'gh release list could not enumerate existing release tags.'
}
try {
  $releaseInventory = @($releaseJson | ConvertFrom-Json -Depth 20)
} catch {
  Stop-WithMessage 'gh release list returned malformed JSON.'
}

$usedTags = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
$publishedVersions = @()
foreach ($release in $releaseInventory) {
  if ($null -eq $release -or [string]::IsNullOrWhiteSpace([string]$release.tagName)) {
    Stop-WithMessage 'gh release list returned an entry without tagName.'
  }
  $parsed = Parse-Semver ([string]$release.tagName)
  if ($null -eq $parsed) {
    continue
  }
  $normalized = Normalize-Tag $parsed
  [void]$usedTags.Add($normalized)
  if (-not [bool]$release.isDraft) {
    $publishedVersions += $parsed
  }
}

$maxPublished = $null
foreach ($published in $publishedVersions) {
  if ($null -eq $maxPublished -or (Compare-Semver $published $maxPublished) -gt 0) {
    $maxPublished = $published
  }
}

if ($null -eq $maxPublished -or (Compare-Semver $packageVersion $maxPublished) -gt 0) {
  $candidate = $packageVersion
} else {
  $candidate = [pscustomobject]@{
    Major = $maxPublished.Major
    Minor = $maxPublished.Minor
    Patch = $maxPublished.Patch + 1
  }
}

$reservationRef = $null
while ($true) {
  while ($usedTags.Contains((Normalize-Tag $candidate))) {
    $candidate = [pscustomobject]@{
      Major = $candidate.Major
      Minor = $candidate.Minor
      Patch = $candidate.Patch + 1
    }
  }

  $releaseTag = Normalize-Tag $candidate
  $null = & gh api --method POST "repos/$env:GITHUB_REPOSITORY/git/refs" -f "ref=refs/tags/$releaseTag" -f "sha=$env:GITHUB_SHA" 2>$null
  if ($LASTEXITCODE -eq 0) {
    $reservationRef = "refs/tags/$releaseTag"
    break
  }

  $existingRef = & gh api "repos/$env:GITHUB_REPOSITORY/git/ref/tags/$releaseTag" 2>$null | Out-String
  if ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace($existingRef)) {
    [void]$usedTags.Add($releaseTag)
    $candidate = [pscustomobject]@{
      Major = $candidate.Major
      Minor = $candidate.Minor
      Patch = $candidate.Patch + 1
    }
    continue
  }
  Stop-WithMessage "Could not reserve unique release tag $releaseTag."
}

$releaseVersion = "$($candidate.Major).$($candidate.Minor).$($candidate.Patch)"
$outputDirectory = Split-Path -Parent ([System.IO.Path]::GetFullPath($OutputPath))
if (-not (Test-Path -LiteralPath $outputDirectory -PathType Container)) {
  New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
}
[pscustomobject]@{
  tag = $releaseTag
  version = $releaseVersion
  reservationRef = $reservationRef
  sourceCommit = $env:GITHUB_SHA
} | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $OutputPath -Encoding utf8NoBOM

Write-Output "Reserved unique stable release tag $releaseTag for $env:GITHUB_SHA."
