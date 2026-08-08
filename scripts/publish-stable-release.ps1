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
$assetPaths = @(
  Get-ChildItem -LiteralPath $assetDirectory -File |
    Sort-Object Name |
    ForEach-Object { $_.FullName }
)
if ($assetPaths.Count -lt 3) {
  Stop-WithMessage 'The validated artifact set must include Setup.exe, RELEASES, and at least one .nupkg.'
}

$repository = $env:GITHUB_REPOSITORY
$releaseTag = [string]$version.tag
$codeName = [string]$metadata.codeName
if ([string]::IsNullOrWhiteSpace($codeName)) {
  $codeName = 'No public catalog code name was available for this release.'
}
$title = "$releaseTag — $codeName"
$initialNotesPath = Join-Path ([System.IO.Path]::GetTempPath()) "release-initial-$([guid]::NewGuid().ToString('N')).md"
$finalNotesPath = Join-Path ([System.IO.Path]::GetTempPath()) "release-final-$([guid]::NewGuid().ToString('N')).md"

try {
# release note template is deliberately plain Markdown; the release body is the public record.
@"
  # $releaseTag — $codeName

  Source commit: $env:GITHUB_SHA

  Signing status: **UNSIGNED** — code signing is prohibited by project policy. These Squirrel.Windows artifacts are intentionally unsigned and may trigger Windows SmartScreen or unknown-publisher warnings.
  Distribution channel: stable release after validation.
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

  $draftInventory = Invoke-GhJson @('release', 'list', '--repo', $repository, '--limit', '1000', '--json', 'tagName,isDraft,isPrerelease') 'Draft release inventory'
  $draft = @($draftInventory) | Where-Object { [string]$_.tagName -eq $releaseTag } | Select-Object -First 1
  if ($null -eq $draft -or -not [bool]$draft.isDraft -or [bool]$draft.isPrerelease) {
    Stop-WithMessage 'The created release was not a stable draft.'
  }

  Write-GhFile @('release', 'edit', $releaseTag, '--repo', $repository, '--draft=false') 'Stable release publication'
  $published = Invoke-GhJson @('release', 'view', $releaseTag, '--repo', $repository, '--json', 'tagName,targetCommitish,isDraft,isPrerelease,publishedAt,assets,url') 'Published release verification'
  if ([string]$published.tagName -ne $releaseTag -or [string]$published.targetCommitish -ne $env:GITHUB_SHA -or [bool]$published.isDraft -or [bool]$published.isPrerelease) {
    Stop-WithMessage 'The published release is not stable or does not target the exact source commit.'
  }
  if ([string]::IsNullOrWhiteSpace([string]$published.publishedAt)) {
    Stop-WithMessage 'The published release did not provide a publication timestamp.'
  }

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
  if ($manifest.PSObject.Properties.Name -contains 'extensionAsset' -and -not [string]::IsNullOrWhiteSpace([string]$manifest.extensionAsset)) {
    $extensionAssetName = [string]$manifest.extensionAsset
    $extensionSection = @"

  ## Browser extension

  - Asset: ``$extensionAssetName`` — the Chromium Manifest V3 handoff extension built from this exact source commit.
  - Install: download the archive, extract it to a folder, open ``chrome://extensions``, enable **Developer mode**, choose **Load unpacked**, and select the extracted folder (``manifest.json`` sits at its root).
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

  $expectedAssets = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
  foreach ($name in @($manifest.names)) {
    [void]$expectedAssets.Add([string]$name)
  }
  $publishedAssets = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
  foreach ($asset in @($final.assets)) {
    [void]$publishedAssets.Add([string]$asset.name)
  }
  if ($expectedAssets.Count -ne $publishedAssets.Count) {
    Stop-WithMessage 'The final release asset count differs from the validated artifact set.'
  }
  foreach ($name in $expectedAssets) {
    if (-not $publishedAssets.Contains($name)) {
      Stop-WithMessage "The final release is missing validated artifact $name."
    }
  }

  $body = [string]$final.body
  foreach ($marker in @($env:GITHUB_SHA, $releaseTag, 'UNSIGNED', 'Workflow started', 'Workflow completed', 'Workflow duration', $duration)) {
    if ($body.IndexOf($marker, [System.StringComparison]::Ordinal) -lt 0) {
      Stop-WithMessage "Final release notes are missing required marker: $marker"
    }
  }
  if ($env:GITHUB_OUTPUT) {
    "release_url=$([string]$final.url)" | Out-File -FilePath $env:GITHUB_OUTPUT -Append -Encoding utf8
  }
  Write-Output "Stable unsigned release verified: $([string]$final.url)"
} finally {
  Remove-Item -LiteralPath $initialNotesPath -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $finalNotesPath -Force -ErrorAction SilentlyContinue
}
