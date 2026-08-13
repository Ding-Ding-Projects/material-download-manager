[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$MetadataPath,
  [Parameter(Mandatory = $true)]
  [string]$VersionPath,
  [Parameter(Mandatory = $true)]
  [string]$LineCountPath,
  [Parameter(Mandatory = $true)]
  [string]$ArtifactManifestPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Stop-WithMessage([string]$Message) {
  throw "Stable release publication failed: $Message"
}

function Read-Json([string]$Path, [string]$Label) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    Stop-WithMessage "$Label is missing: $Path"
  }
  try {
    return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json -Depth 50
  } catch {
    Stop-WithMessage "$Label is malformed JSON: $Path"
  }
}

function Invoke-GhJson([string[]]$Arguments, [string]$Label) {
  $raw = & gh @Arguments 2>&1 | Out-String
  if ($LASTEXITCODE -ne 0) {
    Stop-WithMessage "$Label failed."
  }
  try {
    return $raw | ConvertFrom-Json -Depth 50
  } catch {
    Stop-WithMessage "$Label returned malformed JSON."
  }
}

function Write-GhFile([string[]]$Arguments, [string]$Label) {
  & gh @Arguments
  if ($LASTEXITCODE -ne 0) {
    Stop-WithMessage "$Label failed with exit code $LASTEXITCODE."
  }
}

function Assert-ReleaseAssetEvidence([object[]]$Assets, [object[]]$Evidence, [string]$Label) {
  $expected = [System.Collections.Generic.Dictionary[string,object]]::new([System.StringComparer]::OrdinalIgnoreCase)
  foreach ($item in @($Evidence)) {
    $name = [string]$item.name
    if ([string]::IsNullOrWhiteSpace($name) -or $expected.ContainsKey($name)) {
      Stop-WithMessage "$Label expected evidence contains an invalid or duplicate asset name: $name"
    }
    $expected.Add($name, $item)
  }

  $actual = [System.Collections.Generic.Dictionary[string,object]]::new([System.StringComparer]::OrdinalIgnoreCase)
  foreach ($asset in @($Assets)) {
    $name = [string]$asset.name
    if ([string]::IsNullOrWhiteSpace($name) -or $actual.ContainsKey($name)) {
      Stop-WithMessage "$Label contains an invalid or duplicate asset name: $name"
    }
    $actual.Add($name, $asset)
  }
  if ($actual.Count -ne $expected.Count) {
    Stop-WithMessage "$Label asset count differs from the validated artifact set."
  }
  foreach ($entry in $expected.GetEnumerator()) {
    if (-not $actual.ContainsKey($entry.Key)) {
      Stop-WithMessage "$Label is missing validated artifact $($entry.Key)."
    }
    $asset = $actual[$entry.Key]
    $evidence = $entry.Value
    if ([int64]$asset.size -ne [int64]$evidence.sizeBytes -or
        [string]$asset.digest -ne "sha256:$([string]$evidence.sha256)") {
      Stop-WithMessage "$Label artifact $($entry.Key) differs from its validated size or GitHub SHA-256 digest."
    }
  }
}

function Find-ReleaseByTag([string]$Repository, [string]$Tag, [string]$Label) {
  for ($page = 1; $page -le 10; $page += 1) {
    $items = @(Invoke-GhJson @('api', "repos/$Repository/releases?per_page=100&page=$page") "$Label page $page")
    $match = $items | Where-Object { [string]$_.tag_name -eq $Tag } | Select-Object -First 1
    if ($null -ne $match) { return $match }
    if ($items.Count -lt 100) { break }
  }
  return $null
}

function Wait-ForExpectedDraftRelease(
  [string]$Repository,
  [string]$Tag,
  [string]$SourceCommit,
  [int]$Attempts = 20
) {
  $observed = $null
  for ($attempt = 1; $attempt -le $Attempts; $attempt += 1) {
    $observed = Find-ReleaseByTag $Repository $Tag "Draft release inventory attempt $attempt"
    $matches = $null -ne $observed -and
      [string]$observed.tag_name -eq $Tag -and
      [bool]$observed.draft -and
      -not [bool]$observed.prerelease -and
      [string]$observed.target_commitish -eq $SourceCommit
    if ($matches) {
      return $observed
    }
    if ($attempt -lt $Attempts) {
      Start-Sleep -Seconds 1
    }
  }
  Stop-WithMessage "The created draft did not converge to a stable exact-source record within $Attempts seconds."
}

if ([string]::IsNullOrWhiteSpace($env:GITHUB_REPOSITORY) -or [string]::IsNullOrWhiteSpace($env:GITHUB_SHA) -or [string]::IsNullOrWhiteSpace($env:GITHUB_RUN_ID)) {
  Stop-WithMessage 'GITHUB_REPOSITORY, GITHUB_SHA, and GITHUB_RUN_ID are required.'
}

$metadata = Read-Json $MetadataPath 'Release metadata'
$version = Read-Json $VersionPath 'Release version'
$manifest = Read-Json $ArtifactManifestPath 'Artifact manifest'
$lineCount = Get-Content -LiteralPath $LineCountPath -Raw

if ([string]$version.sourceCommit -ne $env:GITHUB_SHA) {
  Stop-WithMessage 'The reserved release tag does not point at the checked-out source commit.'
}
if ([string]$version.tag -notmatch '^v\d+\.\d+\.\d+$') {
  Stop-WithMessage "The release tag is not stable semantic version syntax: $($version.tag)"
}
if (-not [bool]$manifest.unsigned -or [string]$manifest.setupSignatureStatus -ne 'NotSigned') {
  Stop-WithMessage 'The artifact manifest is not an explicitly unsigned, NotSigned artifact set.'
}
if ([string]$lineCount -notmatch '(?m)^record\tscope\tname\tfiles\tlines\tnonBlank\tbytes\tagentLines\thumanOtherLines\tagentNonBlank\thumanOtherNonBlank\s*$') {
  Stop-WithMessage 'The line-count table lacks surviving git-blame attribution columns.'
}
foreach ($requiredLineCountRow in @(
    'summary\tproject\ttotal\t',
    'summary\tproject\thand-written-total\t',
    'attribution\tproject\tall-included\t',
    'attribution\tproject\thand-written\t'
  )) {
  if ($lineCount -notmatch "(?m)^$requiredLineCountRow") {
    Stop-WithMessage "The line-count table is missing row $requiredLineCountRow."
  }
}

$assetDirectory = [string]$manifest.directory
if (-not (Test-Path -LiteralPath $assetDirectory -PathType Container)) {
  Stop-WithMessage "Validated artifact directory is missing: $assetDirectory"
}
$assetFiles = @(Get-ChildItem -LiteralPath $assetDirectory -File | Sort-Object Name)
$assetPaths = @($assetFiles | ForEach-Object { $_.FullName })
if ($assetPaths.Count -lt 3) {
  Stop-WithMessage 'The validated artifact set must include Setup.exe, RELEASES, and at least one .nupkg.'
}

$declaredAssetNames = @($manifest.names | ForEach-Object { [string]$_ })
$declaredAssetNameSet = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
foreach ($assetName in $declaredAssetNames) {
  if ([string]::IsNullOrWhiteSpace($assetName) -or [System.IO.Path]::GetFileName($assetName) -ne $assetName) {
    Stop-WithMessage "The artifact manifest contains an invalid asset filename: $assetName"
  }
  if (-not $declaredAssetNameSet.Add($assetName)) {
    Stop-WithMessage "The artifact manifest contains a duplicate asset filename: $assetName"
  }
  if ($assetName -match '(?i)\.crx$') {
    Stop-WithMessage 'The artifact manifest must not contain a CRX because this release has no authorized signing path.'
  }
}
$actualAssetNameSet = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
foreach ($assetFile in $assetFiles) {
  if ($assetFile.Name -match '(?i)\.crx$') {
    Stop-WithMessage 'The validated asset directory must not contain a CRX because this release has no authorized signing path.'
  }
  [void]$actualAssetNameSet.Add($assetFile.Name)
}
foreach ($assetName in $declaredAssetNameSet) {
  if (-not $actualAssetNameSet.Contains($assetName)) {
    Stop-WithMessage "The validated asset directory is missing declared artifact $assetName."
  }
}
foreach ($assetName in $actualAssetNameSet) {
  if (-not $declaredAssetNameSet.Contains($assetName)) {
    Stop-WithMessage "The validated asset directory contains undeclared artifact $assetName."
  }
}

if (-not ($manifest.PSObject.Properties.Name -contains 'artifacts')) {
  Stop-WithMessage 'The artifact manifest is missing per-file size and SHA-256 evidence.'
}
$artifactEvidence = @($manifest.artifacts)
if ($artifactEvidence.Count -ne $declaredAssetNameSet.Count) {
  Stop-WithMessage 'Per-file artifact evidence does not cover the complete declared asset set.'
}
$artifactEvidenceByName = [System.Collections.Generic.Dictionary[string,object]]::new([System.StringComparer]::OrdinalIgnoreCase)
foreach ($evidence in $artifactEvidence) {
  $evidenceName = [string]$evidence.name
  if ([string]::IsNullOrWhiteSpace($evidenceName) -or -not $declaredAssetNameSet.Contains($evidenceName) -or $artifactEvidenceByName.ContainsKey($evidenceName)) {
    Stop-WithMessage "Per-file artifact evidence contains an invalid, undeclared, or duplicate name: $evidenceName"
  }
  if ([int64]$evidence.sizeBytes -le 0 -or [string]$evidence.sha256 -notmatch '^[a-f0-9]{64}$') {
    Stop-WithMessage "Per-file artifact evidence is incomplete for $evidenceName."
  }
  $evidencePath = Join-Path $assetDirectory $evidenceName
  $evidenceFile = Get-Item -LiteralPath $evidencePath
  $evidenceHash = (Get-FileHash -LiteralPath $evidencePath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ([int64]$evidence.sizeBytes -ne [int64]$evidenceFile.Length -or [string]$evidence.sha256 -ne $evidenceHash) {
    Stop-WithMessage "Artifact $evidenceName no longer matches its recorded size and SHA-256."
  }
  $artifactEvidenceByName.Add($evidenceName, $evidence)
}

$hasExtensionAsset = $manifest.PSObject.Properties.Name -contains 'extensionAsset' -and -not [string]::IsNullOrWhiteSpace([string]$manifest.extensionAsset)
$hasExtensionArtifact = $manifest.PSObject.Properties.Name -contains 'extensionArtifact' -and $null -ne $manifest.extensionArtifact
if (-not $hasExtensionAsset -or -not $hasExtensionArtifact) {
  Stop-WithMessage 'The release requires both compatibility extensionAsset and structured extensionArtifact metadata.'
}
$extensionArtifact = $manifest.extensionArtifact
$extensionAssetName = [string]$manifest.extensionAsset
$canonicalExtensionAssetName = "material-download-manager-extension-$([string]$version.version).zip"
$signedProperty = $extensionArtifact.PSObject.Properties['signed']
$signedIsExplicitBooleanFalse = $null -ne $signedProperty -and
  $null -ne $signedProperty.Value -and
  $signedProperty.Value -is [bool] -and
  $signedProperty.Value -eq $false
if ([string]$extensionArtifact.name -ne $extensionAssetName -or
    $extensionAssetName -ne $canonicalExtensionAssetName -or
    [string]$extensionArtifact.format -ne 'zip' -or
    [string]$extensionArtifact.kind -ne 'chromium-extension-load-unpacked' -or
    [string]$extensionArtifact.installMethod -ne 'load-unpacked' -or
    [int]$extensionArtifact.manifestVersion -ne 3 -or
    -not $signedIsExplicitBooleanFalse) {
  Stop-WithMessage 'The structured extension artifact is not the canonical unsigned Manifest V3 Load unpacked ZIP.'
}
if (-not $declaredAssetNameSet.Contains($extensionAssetName)) {
  Stop-WithMessage 'The structured extension ZIP is absent from manifest.names.'
}
if ([string]$extensionArtifact.version -ne [string]$version.version) {
  Stop-WithMessage "The extension ZIP version '$($extensionArtifact.version)' does not match release version '$($version.version)'."
}
if ([string]$extensionArtifact.sha256 -notmatch '^[a-f0-9]{64}$' -or [int64]$extensionArtifact.sizeBytes -le 0) {
  Stop-WithMessage 'The structured extension artifact has no valid size or SHA-256.'
}
$extensionAssetPath = Join-Path $assetDirectory $extensionAssetName
if (-not (Test-Path -LiteralPath $extensionAssetPath -PathType Leaf)) {
  Stop-WithMessage "The structured extension ZIP is missing: $extensionAssetPath"
}
$extensionAssetInfo = Get-Item -LiteralPath $extensionAssetPath
$extensionAssetHash = (Get-FileHash -LiteralPath $extensionAssetPath -Algorithm SHA256).Hash.ToLowerInvariant()
if ([int64]$extensionArtifact.sizeBytes -ne [int64]$extensionAssetInfo.Length -or
    [string]$extensionArtifact.sha256 -ne $extensionAssetHash) {
  Stop-WithMessage 'The extension ZIP no longer matches its structured size and SHA-256 metadata.'
}

$repository = $env:GITHUB_REPOSITORY
if ($repository -notmatch '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$') {
  Stop-WithMessage "GITHUB_REPOSITORY is not a canonical owner/repository pair: $repository"
}
$releaseTag = [string]$version.tag
$codeName = [string]$metadata.codeName
if ([string]::IsNullOrWhiteSpace($codeName)) {
  $codeName = 'No public catalog code name was available for this release.'
}
$title = "$releaseTag — $codeName"
$initialNotesPath = Join-Path ([System.IO.Path]::GetTempPath()) "release-initial-$([guid]::NewGuid().ToString('N')).md"
$finalNotesPath = Join-Path ([System.IO.Path]::GetTempPath()) "release-final-$([guid]::NewGuid().ToString('N')).md"
$assetVerificationDirectory = Join-Path ([System.IO.Path]::GetTempPath()) "release-assets-verify-$([guid]::NewGuid().ToString('N'))"
$publishedByThisRun = $false

try {
# release note template is deliberately plain Markdown; the release body is the public record.
@"
  # $releaseTag — $codeName

  Source commit: $env:GITHUB_SHA

  Signing status: **UNSIGNED** — code signing is prohibited by project policy. These Squirrel.Windows artifacts are intentionally unsigned and may trigger Windows SmartScreen or unknown-publisher warnings.
  Distribution channel: stable release after build, packaging, and publication checks.
  GitHub Actions check scope: tests, lint, type checking, static analysis, accessibility checks, and screenshot checks are not run. A release can therefore publish from a commit whose local checks would have failed, with the installer user potentially becoming the first person to encounter that problem.
"@ | Set-Content -LiteralPath $initialNotesPath -Encoding utf8

  $createArguments = @(
    'release', 'create', $releaseTag,
    '--repo', $repository,
    '--target', $env:GITHUB_SHA,
    '--draft',
    '--title', $title,
    '--notes-file', $initialNotesPath
  ) + $assetPaths
  Write-GhFile $createArguments 'Draft release creation'

  $draft = Wait-ForExpectedDraftRelease $repository $releaseTag $env:GITHUB_SHA
  if ($null -eq $draft -or -not [bool]$draft.draft -or [bool]$draft.prerelease -or [string]$draft.target_commitish -ne $env:GITHUB_SHA) {
    Stop-WithMessage 'The created release was not a stable draft targeting the exact source commit.'
  }
  Assert-ReleaseAssetEvidence @($draft.assets) $artifactEvidence 'Draft release'

  Write-GhFile @('release', 'edit', $releaseTag, '--repo', $repository, '--draft=false') 'Stable release publication'
  $publishedByThisRun = $true
  $published = Invoke-GhJson @('release', 'view', $releaseTag, '--repo', $repository, '--json', 'tagName,targetCommitish,isDraft,isPrerelease,publishedAt,assets,url') 'Published release verification'
  if ([string]$published.tagName -ne $releaseTag -or [string]$published.targetCommitish -ne $env:GITHUB_SHA -or [bool]$published.isDraft -or [bool]$published.isPrerelease) {
    Stop-WithMessage 'The published release is not stable or does not target the exact source commit.'
  }
  if ([string]::IsNullOrWhiteSpace([string]$published.publishedAt)) {
    Stop-WithMessage 'The published release did not provide a publication timestamp.'
  }
  Assert-ReleaseAssetEvidence @($published.assets) $artifactEvidence 'Published release'

  $run = Invoke-GhJson @('run', 'view', $env:GITHUB_RUN_ID, '--repo', $repository, '--json', 'jobs') 'Workflow job timing query'
  $jobStarts = @(
    @($run.jobs) |
      Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_.startedAt) } |
      ForEach-Object { [DateTimeOffset]::Parse([string]$_.startedAt).ToUniversalTime() }
  )
  if ($jobStarts.Count -eq 0) {
    Stop-WithMessage 'The workflow returned no job startedAt timestamp; duration cannot be estimated.'
  }
  $startedAt = ($jobStarts | Sort-Object | Select-Object -First 1)
  $publishedAt = ([DateTimeOffset]::Parse([string]$published.publishedAt)).ToUniversalTime()
  if ($publishedAt -lt $startedAt) {
    Stop-WithMessage 'Release publication predates the first job start; refusing to estimate timing.'
  }
  $elapsed = $publishedAt - $startedAt
  $hours = [math]::Floor($elapsed.TotalHours)
  $duration = '{0:00}:{1:00}:{2:00}' -f [int]$hours, $elapsed.Minutes, $elapsed.Seconds
  $startedText = $startedAt.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'")
  $publishedText = $publishedAt.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'")

  $metadataJson = ($metadata | ConvertTo-Json -Depth 50).Trim()
  $artifactList = (@($manifest.names) | Sort-Object | ForEach-Object { "- $($_)" }) -join "`n"
  if ([string]::IsNullOrWhiteSpace($artifactList)) {
    Stop-WithMessage 'The artifact manifest contains no names.'
  }
  $extensionSection = ''
  if ($null -ne $extensionArtifact) {
    $extensionSection = @"

  ## Browser extension

  - Asset: ``$([string]$extensionArtifact.name)`` — a ZIP containing the Chromium Manifest V3 handoff extension built from this exact source commit.
  - Embedded manifest version: ``$([string]$extensionArtifact.version)``
  - Size: ``$([int64]$extensionArtifact.sizeBytes) bytes``
  - SHA-256: ``$([string]$extensionArtifact.sha256)``
  - Install: download the ZIP, extract it to a folder, open ``chrome://extensions``, enable **Developer mode**, choose **Load unpacked**, and select the extracted folder (``manifest.json`` sits at its root).
  - Off-store limitation: the ZIP is not a click-to-install extension package. Ordinary Chrome users must use **Load unpacked**; managed distribution has separate administrator-controlled requirements.
  - No CRX is attached. CRX3 requires cryptographic signing and a persistent private key, while this project permanently prohibits signing.
  - The extension only talks to the app's documented loopback adapter at ``http://127.0.0.1:43771/v1/downloads``; it declares no remote hosts, analytics, or tracking.
"@
  }
  if ([bool]$metadata.available) {
    $photoLine = "- Public photo asset: [$($metadata.photoUrl)]($($metadata.photoUrl))"
    $catalogLine = "- Catalog source: [dim-sum catalog]($($metadata.catalogUrl)); published catalog release: ``$($metadata.catalogReleaseTag)``"
    $reservationLine = "- Code-name reservation: ``$($metadata.reservationRef)``"
  } else {
    $photoLine = '- Public photo asset: unavailable; no local copy was generated or attached.'
    $catalogLine = '- Catalog source: unavailable for this run; the release proceeds with its version and records this absence.'
    $reservationLine = '- Code-name reservation: none.'
  }

@"
  # $releaseTag — $codeName

  Source commit: $env:GITHUB_SHA

  ## Release identity

  - Version tag: ``$releaseTag``
  - Code name: **$codeName**
  - Signing status: **UNSIGNED** — code signing is prohibited by project policy. These Squirrel.Windows artifacts are intentionally unsigned and may trigger Windows SmartScreen or unknown-publisher warnings.
  - Distribution channel: stable release; the published record must report `isPrerelease=false`.
  - GitHub Actions check scope: build, package, publish, and safe evidence collection only. Tests, lint, type checking, static analysis, accessibility checks, and screenshot checks are not run. This accepted trade means a person running the installer may be the first to encounter a failure that local checks would have found.
  $reservationLine
  $photoLine
  $catalogLine

  <details>
  <summary>Resolver metadata</summary>

  ```json
  $metadataJson
  ```
  </details>

  ## Line count

  $($lineCount.Trim())

  ## Installer artifacts

  $artifactList
  $extensionSection
  ## Workflow timing (UTC)

  - Workflow started: ``$startedText``
  - Workflow completed: ``$publishedText``
  - Workflow duration: ``$duration``
"@ | Set-Content -LiteralPath $finalNotesPath -Encoding utf8

  Write-GhFile @('release', 'edit', $releaseTag, '--repo', $repository, '--notes-file', $finalNotesPath) 'Release note finalization'
  $final = Invoke-GhJson @('release', 'view', $releaseTag, '--repo', $repository, '--json', 'tagName,targetCommitish,isDraft,isPrerelease,publishedAt,assets,body,url') 'Final release verification'
  if ([bool]$final.isDraft -or [bool]$final.isPrerelease -or [string]$final.targetCommitish -ne $env:GITHUB_SHA -or [string]::IsNullOrWhiteSpace([string]$final.publishedAt)) {
    Stop-WithMessage 'Final release verification failed for stable state, source commit, or publication timestamp.'
  }

  Assert-ReleaseAssetEvidence @($final.assets) $artifactEvidence 'Final release'

  New-Item -ItemType Directory -Path $assetVerificationDirectory -Force | Out-Null
  Write-GhFile @(
    'release', 'download', $releaseTag,
    '--repo', $repository,
    '--dir', $assetVerificationDirectory
  ) 'Published artifact download verification'
  foreach ($evidence in $artifactEvidence) {
    $downloadedPath = Join-Path $assetVerificationDirectory ([string]$evidence.name)
    if (-not (Test-Path -LiteralPath $downloadedPath -PathType Leaf)) {
      Stop-WithMessage "Published artifact could not be downloaded for verification: $([string]$evidence.name)"
    }
    $downloadedInfo = Get-Item -LiteralPath $downloadedPath
    $downloadedHash = (Get-FileHash -LiteralPath $downloadedPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ([int64]$downloadedInfo.Length -ne [int64]$evidence.sizeBytes -or $downloadedHash -ne [string]$evidence.sha256) {
      Stop-WithMessage "Downloaded artifact does not match validated size and SHA-256: $([string]$evidence.name)"
    }
  }

  $completedAt = [DateTimeOffset]::UtcNow
  if ($completedAt -lt $startedAt) {
    Stop-WithMessage 'Workflow completion predates the first job start.'
  }
  $completedElapsed = $completedAt - $startedAt
  $completedHours = [math]::Floor($completedElapsed.TotalHours)
  $completedDuration = '{0:00}:{1:00}:{2:00}' -f [int]$completedHours, $completedElapsed.Minutes, $completedElapsed.Seconds
  $completedText = $completedAt.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'")
  $completedNotes = (Get-Content -LiteralPath $finalNotesPath -Raw).Replace($publishedText, $completedText).Replace($duration, $completedDuration)
  $completedNotes | Set-Content -LiteralPath $finalNotesPath -Encoding utf8
  Write-GhFile @('release', 'edit', $releaseTag, '--repo', $repository, '--notes-file', $finalNotesPath) 'Completed release-note timing finalization'
  $duration = $completedDuration
  $final = Invoke-GhJson @('release', 'view', $releaseTag, '--repo', $repository, '--json', 'tagName,targetCommitish,isDraft,isPrerelease,publishedAt,assets,body,url') 'Completed release verification'
  if ([bool]$final.isDraft -or [bool]$final.isPrerelease -or [string]$final.targetCommitish -ne $env:GITHUB_SHA) {
    Stop-WithMessage 'The completed release no longer has the required stable state or source commit.'
  }
  Assert-ReleaseAssetEvidence @($final.assets) $artifactEvidence 'Completed release'

  $body = [string]$final.body
  foreach ($marker in @($env:GITHUB_SHA, $releaseTag, 'UNSIGNED', 'Workflow started', 'Workflow completed', 'Workflow duration', $startedText, $completedText, $duration, 'Load unpacked')) {
    if ($body.IndexOf($marker, [System.StringComparison]::Ordinal) -lt 0) {
      Stop-WithMessage "Final release notes are missing required marker: $marker"
    }
  }
  if ($env:GITHUB_OUTPUT) {
    "release_url=$([string]$final.url)" | Out-File -FilePath $env:GITHUB_OUTPUT -Append -Encoding utf8
  }
  Write-Output "Stable unsigned release verified: $([string]$final.url)"
} catch {
  $publicationFailure = $_
  if ($publishedByThisRun) {
    $redraftOutput = & gh release edit $releaseTag --repo $repository --draft=true 2>&1 | Out-String
    $redraftExitCode = $LASTEXITCODE
    if ($redraftExitCode -ne 0) {
      throw "Stable release verification failed, and re-drafting the release was refused with exit code $redraftExitCode. Original failure: $($publicationFailure.Exception.Message)"
    }
    $redrafted = Find-ReleaseByTag $repository $releaseTag 'Re-drafted release inventory'
    if ($null -eq $redrafted -or [string]$redrafted.tag_name -ne $releaseTag -or -not [bool]$redrafted.draft) {
      throw "Stable release verification failed, and the release remained public after the re-draft attempt. Original failure: $($publicationFailure.Exception.Message)"
    }
  }
  throw $publicationFailure
} finally {
  Remove-Item -LiteralPath $initialNotesPath -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $finalNotesPath -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $assetVerificationDirectory -Recurse -Force -ErrorAction SilentlyContinue
}
