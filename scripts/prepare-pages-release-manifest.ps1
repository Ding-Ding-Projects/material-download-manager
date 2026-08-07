[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$OutputDirectory,
  [Parameter(Mandatory = $true)]
  [string]$PagesUrl
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Stop-WithMessage([string]$Message) {
  throw "Pages release-manifest preparation failed: $Message"
}

if ([string]::IsNullOrWhiteSpace($env:GITHUB_REPOSITORY)) {
  Stop-WithMessage 'GITHUB_REPOSITORY is required.'
}

$outputDirectoryFull = [System.IO.Path]::GetFullPath($OutputDirectory)
$jsonPath = Join-Path $outputDirectoryFull 'data/release-manifest.json'
$scriptPath = Join-Path $outputDirectoryFull 'data/release-manifest.js'
$jsonParent = Split-Path -Parent $jsonPath
if (-not (Test-Path -LiteralPath $jsonParent -PathType Container)) {
  Stop-WithMessage "The built Pages data directory is missing: $jsonParent"
}
$sourceManifest = Get-Content -LiteralPath $jsonPath -Raw | ConvertFrom-Json -Depth 50
$historicalTestReleases = @($sourceManifest.testPrereleases)

function Invoke-GhJson([string[]]$Arguments, [string]$Label) {
  $raw = & gh @Arguments 2>&1 | Out-String
  if ($LASTEXITCODE -ne 0) { Stop-WithMessage "$Label failed." }
  try { return $raw | ConvertFrom-Json -Depth 50 } catch { Stop-WithMessage "$Label returned malformed JSON." }
}

$inventory = @(Invoke-GhJson @('release', 'list', '--repo', $env:GITHUB_REPOSITORY, '--limit', '1000', '--json', 'tagName,isDraft,isPrerelease,publishedAt') 'Stable release inventory')
$stableCandidates = @(
  $inventory |
    Where-Object { -not [bool]$_.isDraft -and -not [bool]$_.isPrerelease -and -not [string]::IsNullOrWhiteSpace([string]$_.publishedAt) } |
    Sort-Object { [DateTimeOffset]::Parse([string]$_.publishedAt) } -Descending
)

$manifest = $null
if ($stableCandidates.Count -gt 0) {
  $release = Invoke-GhJson @('release', 'view', [string]$stableCandidates[0].tagName, '--repo', $env:GITHUB_REPOSITORY, '--json', 'tagName,targetCommitish,isDraft,isPrerelease,publishedAt,assets,body,url') 'Stable release details'
  if ([bool]$release.isDraft -or [bool]$release.isPrerelease) {
    Stop-WithMessage 'The selected release is not a stable non-draft, non-prerelease record.'
  }
  $assets = @($release.assets)
  $assetNames = @($assets | ForEach-Object { [string]$_.name })
  $setup = $assets | Where-Object { [string]$_.name -ieq 'Setup.exe' } | Select-Object -First 1
  $releaseIndex = $assets | Where-Object { [string]$_.name -ieq 'RELEASES' } | Select-Object -First 1
  $fullPackage = $assets | Where-Object { [string]$_.name -match '(?i)-full\.nupkg$' } | Select-Object -First 1
  if ($null -eq $setup -or $null -eq $releaseIndex -or $null -eq $fullPackage) {
    Stop-WithMessage 'The latest stable release is missing Setup.exe, RELEASES, or a full .nupkg.'
  }
  # `gh release view --json assets` exposes the browser download URL as `url`.
  # `downloadUrl` is not a GitHub CLI field, so using it would silently remove
  # the stable installer button from the deployed site.
  $installerUrl = [string]$setup.url
  if ($installerUrl -notmatch '^https://') {
    Stop-WithMessage 'The verified Setup.exe asset did not provide an HTTPS download URL.'
  }
  $body = [string]$release.body
  foreach ($marker in @('UNSIGNED', 'Workflow started', 'Workflow completed', 'Workflow duration', [string]$release.targetCommitish)) {
    if ($body.IndexOf($marker, [System.StringComparison]::Ordinal) -lt 0) {
      Stop-WithMessage "The stable release notes are missing required marker: $marker"
    }
  }
  $version = [string]$release.tagName
  if ($version.StartsWith('v', [System.StringComparison]::OrdinalIgnoreCase)) { $version = $version.Substring(1) }
  $manifest = [pscustomobject]@{
    schemaVersion = 1
    stable = [pscustomobject]@{
      version = $version
      channel = 'stable'
      verified = $true
      unsigned = $true
      installerUrl = $installerUrl
      releaseUrl = [string]$release.url
      sourceCommit = [string]$release.targetCommitish
      publishedAt = [string]$release.publishedAt
      assets = $assetNames
    }
    testPrereleases = $historicalTestReleases
    status = 'Stable release verified from the immutable GitHub release record.'
    publication = [pscustomobject]@{ pages = 'workflow-deployed'; url = $PagesUrl; source = 'self-hosted Pages workflow' }
  }
} else {
  $manifest = [pscustomobject]@{
    schemaVersion = 1
    stable = $null
    testPrereleases = $historicalTestReleases
    status = 'No stable production installer has been proven. The site must not render an installer button until a stable record with verified assets is added.'
    publication = [pscustomobject]@{ pages = 'workflow-deployed'; url = $PagesUrl; source = 'self-hosted Pages workflow' }
  }
}

$json = $manifest | ConvertTo-Json -Depth 50
$json | Set-Content -LiteralPath $jsonPath -Encoding utf8NoBOM
"window.MDM_RELEASE_MANIFEST = $json;" | Set-Content -LiteralPath $scriptPath -Encoding utf8NoBOM
Write-Output "Prepared Pages release manifest for $env:GITHUB_REPOSITORY: $([string]$manifest.status)"
