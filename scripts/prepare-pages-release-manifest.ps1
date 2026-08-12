[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$OutputDirectory,
  [Parameter(Mandatory = $true)]
  [string]$PagesUrl,
  [string]$ExpectedSourceCommit = ''
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

function Invoke-Gh([string[]]$Arguments, [string]$Label) {
  & gh @Arguments
  if ($LASTEXITCODE -ne 0) { Stop-WithMessage "$Label failed with exit code $LASTEXITCODE." }
}

$inventory = @(Invoke-GhJson @('release', 'list', '--repo', $env:GITHUB_REPOSITORY, '--limit', '1000', '--json', 'tagName,isDraft,isPrerelease,publishedAt') 'Stable release inventory')
$stableCandidates = @(
  $inventory |
    Where-Object { -not [bool]$_.isDraft -and -not [bool]$_.isPrerelease -and -not [string]::IsNullOrWhiteSpace([string]$_.publishedAt) } |
    Sort-Object { [DateTimeOffset]::Parse([string]$_.publishedAt) } -Descending
)

$manifest = $null
if ($stableCandidates.Count -gt 0) {
  $release = $null
  foreach ($candidate in $stableCandidates) {
    $candidateRelease = Invoke-GhJson @('release', 'view', [string]$candidate.tagName, '--repo', $env:GITHUB_REPOSITORY, '--json', 'tagName,targetCommitish,isDraft,isPrerelease,publishedAt,assets,body,url') 'Stable release details'
    if ([string]::IsNullOrWhiteSpace($ExpectedSourceCommit) -or [string]$candidateRelease.targetCommitish -eq $ExpectedSourceCommit) {
      $release = $candidateRelease
      break
    }
  }
  if ($null -eq $release) {
    Stop-WithMessage "No published stable release targets the completed release-workflow commit $ExpectedSourceCommit."
  }
  if ([bool]$release.isDraft -or [bool]$release.isPrerelease) {
    Stop-WithMessage 'The selected release is not a stable non-draft, non-prerelease record.'
  }
  $assets = @($release.assets)
  $assetNames = @($assets | ForEach-Object { [string]$_.name })
  $setup = $assets | Where-Object { [string]$_.name -ieq 'Setup.exe' } | Select-Object -First 1
  $releaseIndex = $assets | Where-Object { [string]$_.name -ieq 'RELEASES' } | Select-Object -First 1
  $fullPackage = $assets | Where-Object { [string]$_.name -match '(?i)-full\.nupkg$' } | Select-Object -First 1
  $extensionZipCandidates = @($assets | Where-Object { [string]$_.name -match '(?i)^material-download-manager-extension-\d+\.\d+\.\d+\.zip$' })
  if ($null -eq $setup -or $null -eq $releaseIndex -or $null -eq $fullPackage) {
    Stop-WithMessage 'The latest stable release is missing Setup.exe, RELEASES, or a full .nupkg.'
  }
  if ($extensionZipCandidates.Count -ne 1) {
    Stop-WithMessage "The latest stable release must contain exactly one canonical Load unpacked browser-extension ZIP; found $($extensionZipCandidates.Count)."
  }
  if (@($assets | Where-Object { [string]$_.name -match '(?i)\.crx$' }).Count -gt 0) {
    Stop-WithMessage 'The latest stable release unexpectedly contains a CRX without an authorized signing path.'
  }
  # `gh release view --json assets` exposes the browser download URL as `url`.
  # `downloadUrl` is not a GitHub CLI field, so using it would silently remove
  # the stable installer button from the deployed site.
  $installerUrl = [string]$setup.url
  if ($installerUrl -notmatch '^https://') {
    Stop-WithMessage 'The verified Setup.exe asset did not provide an HTTPS download URL.'
  }
  $extensionZip = $extensionZipCandidates[0]
  $extensionUrl = [string]$extensionZip.url
  $extensionDigest = [string]$extensionZip.digest
  if ($extensionUrl -notmatch '^https://' -or [int64]$extensionZip.size -le 0 -or $extensionDigest -notmatch '^sha256:[a-f0-9]{64}$') {
    Stop-WithMessage 'The browser-extension ZIP lacks a verified HTTPS URL, positive size, or GitHub SHA-256 digest.'
  }
  $body = [string]$release.body
  foreach ($marker in @('UNSIGNED', 'Workflow started', 'Workflow completed', 'Workflow duration', 'Load unpacked', [string]$release.targetCommitish, [string]$extensionZip.name, $extensionDigest.Substring(7))) {
    if ($body.IndexOf($marker, [System.StringComparison]::Ordinal) -lt 0) {
      Stop-WithMessage "The stable release notes are missing required marker: $marker"
    }
  }
  $version = [string]$release.tagName
  if ($version.StartsWith('v', [System.StringComparison]::OrdinalIgnoreCase)) { $version = $version.Substring(1) }
  if ([string]$extensionZip.name -ne "material-download-manager-extension-$version.zip") {
    Stop-WithMessage 'The browser-extension ZIP name does not match the stable release version.'
  }
  $extensionVerificationDirectory = Join-Path ([System.IO.Path]::GetTempPath()) "pages-extension-verify-$([guid]::NewGuid().ToString('N'))"
  New-Item -ItemType Directory -Path $extensionVerificationDirectory -Force | Out-Null
  try {
    Invoke-Gh @(
      'release', 'download', [string]$release.tagName,
      '--repo', $env:GITHUB_REPOSITORY,
      '--dir', $extensionVerificationDirectory
    ) 'Stable release asset download verification'
    foreach ($releaseAsset in $assets) {
      $releaseAssetName = [string]$releaseAsset.name
      $releaseAssetDigest = [string]$releaseAsset.digest
      $releaseAssetPath = Join-Path $extensionVerificationDirectory $releaseAssetName
      if ([System.IO.Path]::GetFileName($releaseAssetName) -ne $releaseAssetName -or
          [int64]$releaseAsset.size -le 0 -or
          $releaseAssetDigest -notmatch '^sha256:[a-f0-9]{64}$' -or
          -not (Test-Path -LiteralPath $releaseAssetPath -PathType Leaf)) {
        Stop-WithMessage "Release asset has no safe filename, size, digest, or downloaded file: $releaseAssetName"
      }
      $releaseAssetInfo = Get-Item -LiteralPath $releaseAssetPath
      $releaseAssetHash = (Get-FileHash -LiteralPath $releaseAssetPath -Algorithm SHA256).Hash.ToLowerInvariant()
      if ([int64]$releaseAssetInfo.Length -ne [int64]$releaseAsset.size -or $releaseAssetHash -ne $releaseAssetDigest.Substring(7)) {
        Stop-WithMessage "Downloaded release asset differs from its size or SHA-256 digest: $releaseAssetName"
      }
    }
    $downloadedExtensionPath = Join-Path $extensionVerificationDirectory ([string]$extensionZip.name)
    if (-not (Test-Path -LiteralPath $downloadedExtensionPath -PathType Leaf)) {
      Stop-WithMessage 'The browser-extension ZIP could not be downloaded for Pages verification.'
    }
    $downloadedExtension = Get-Item -LiteralPath $downloadedExtensionPath
    $downloadedExtensionHash = (Get-FileHash -LiteralPath $downloadedExtensionPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ([int64]$downloadedExtension.Length -ne [int64]$extensionZip.size -or $downloadedExtensionHash -ne $extensionDigest.Substring(7)) {
      Stop-WithMessage 'The downloaded browser-extension ZIP differs from the release size or SHA-256 digest.'
    }

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [System.IO.Compression.ZipFile]::OpenRead($downloadedExtensionPath)
    try {
      if ($archive.Entries.Count -eq 0 -or $archive.Entries.Count -gt 1024) {
        Stop-WithMessage 'The browser-extension ZIP has an invalid entry count.'
      }
      $entryNames = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
      foreach ($entry in $archive.Entries) {
        $entryName = $entry.FullName.Replace('\', '/')
        if ([string]::IsNullOrWhiteSpace($entryName) -or $entryName.StartsWith('/') -or $entryName -match '(^|/)\.\.(/|$)' -or $entryName.Contains(':')) {
          Stop-WithMessage "The browser-extension ZIP contains an unsafe entry path: $entryName"
        }
        if (-not $entryNames.Add($entryName)) {
          Stop-WithMessage "The browser-extension ZIP contains a duplicate entry path: $entryName"
        }
        if ($entryName -match '(?i)\.(?:pem|key|pfx|p12|cer|crt|der|jks|keystore|pk8|crx)$') {
          Stop-WithMessage "The browser-extension ZIP contains forbidden signing or CRX material: $entryName"
        }
      }
      $manifestEntry = $archive.GetEntry('manifest.json')
      if ($null -eq $manifestEntry -or $manifestEntry.Length -le 0 -or $manifestEntry.Length -gt 16384) {
        Stop-WithMessage 'The browser-extension ZIP has no bounded root manifest.json.'
      }
      $reader = [System.IO.StreamReader]::new($manifestEntry.Open(), [System.Text.Encoding]::UTF8, $true)
      try {
        $embeddedManifest = $reader.ReadToEnd() | ConvertFrom-Json -Depth 20
      } catch {
        Stop-WithMessage 'The browser-extension ZIP manifest.json is malformed.'
      } finally {
        $reader.Dispose()
      }
      if ([int]$embeddedManifest.manifest_version -ne 3 -or [string]$embeddedManifest.version -ne $version -or $embeddedManifest.PSObject.Properties.Name -contains 'key') {
        Stop-WithMessage 'The browser-extension ZIP is not the expected unsigned, version-matched Manifest V3 payload.'
      }
      $pairingEntry = $archive.GetEntry('src/shared/pairing.js')
      if ($null -eq $pairingEntry -or $pairingEntry.Length -le 0 -or $pairingEntry.Length -gt 4096) {
        Stop-WithMessage 'The browser-extension ZIP has no bounded empty pairing capability module.'
      }
      $pairingReader = [System.IO.StreamReader]::new($pairingEntry.Open(), [System.Text.Encoding]::UTF8, $true)
      try {
        $pairingSource = $pairingReader.ReadToEnd()
      } finally {
        $pairingReader.Dispose()
      }
      if ($pairingSource -notmatch '(?m)^\s*export const HANDOFF_CAPABILITY = "";\s*$' -or
          $pairingSource -match '[A-Za-z0-9_-]{43}') {
        Stop-WithMessage 'The public browser-extension ZIP contains an installed handoff capability.'
      }
      foreach ($requiredPath in @(
          'manifest.json',
          'src/shared/pairing.js',
          [string]$embeddedManifest.background.service_worker,
          [string]$embeddedManifest.action.default_popup,
          [string]$embeddedManifest.options_page
        ) | Select-Object -Unique) {
        if ([string]::IsNullOrWhiteSpace($requiredPath) -or -not $entryNames.Contains($requiredPath.Replace('\', '/'))) {
          Stop-WithMessage "The browser-extension ZIP is missing a manifest-referenced file: $requiredPath"
        }
      }
    } finally {
      $archive.Dispose()
    }
  } finally {
    Remove-Item -LiteralPath $extensionVerificationDirectory -Recurse -Force -ErrorAction SilentlyContinue
  }
  $extensionArtifact = [pscustomobject]@{
    kind = 'chromium-extension-load-unpacked'
    format = 'zip'
    name = [string]$extensionZip.name
    version = $version
    sizeBytes = [int64]$extensionZip.size
    sha256 = $extensionDigest.Substring(7)
    manifestVersion = 3
    installMethod = 'load-unpacked'
    signed = $false
    downloadUrl = $extensionUrl
  }
  $manifest = [pscustomobject]@{
    schemaVersion = 1
    stable = [pscustomobject]@{
      version = $version
      channel = 'stable'
      isDraft = $false
      isPrerelease = $false
      verified = $true
      unsigned = $true
      installerUrl = $installerUrl
      releaseUrl = [string]$release.url
      sourceCommit = [string]$release.targetCommitish
      publishedAt = [string]$release.publishedAt
      assets = $assetNames
      extensionAsset = [string]$extensionZip.name
      extensionArtifact = $extensionArtifact
    }
    testPrereleases = $historicalTestReleases
    status = 'Stable release verified from the immutable GitHub release record.'
    publication = [pscustomobject]@{ pages = 'verified'; url = $PagesUrl; source = 'GitHub-hosted Pages workflow' }
  }
} else {
  $manifest = [pscustomobject]@{
    schemaVersion = 1
    stable = $null
    testPrereleases = $historicalTestReleases
    status = 'No stable production installer has been proven. The site must not render an installer button until a stable record with verified assets is added.'
    publication = [pscustomobject]@{ pages = 'unverified'; url = $PagesUrl; source = 'GitHub-hosted Pages workflow' }
  }
}

$json = $manifest | ConvertTo-Json -Depth 50
$json | Set-Content -LiteralPath $jsonPath -Encoding utf8NoBOM
"window.MDM_RELEASE_MANIFEST = $json;" | Set-Content -LiteralPath $scriptPath -Encoding utf8NoBOM
Write-Output "Prepared Pages release manifest for $env:GITHUB_REPOSITORY: $([string]$manifest.status)"
