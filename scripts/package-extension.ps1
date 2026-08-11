[CmdletBinding()]
param(
  [string]$ExtensionRoot = (Join-Path ((Resolve-Path (Join-Path $PSScriptRoot '..')).Path) 'extension'),
  [Parameter(Mandatory = $true)]
  [string]$OutputDirectory,
  [Parameter(Mandatory = $true)]
  [string]$ManifestPath,
  [Parameter(Mandatory = $true)]
  [string]$Version
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Stop-WithMessage([string]$Message) {
  throw "Chromium extension packaging failed: $Message"
}

if ($Version -notmatch '^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$') {
  Stop-WithMessage "Release version is not stable semantic version syntax: $Version"
}
$versionParts = @($Version.Split('.') | ForEach-Object { [int64]$_ })
if (@($versionParts | Where-Object { $_ -gt 65535 }).Count -gt 0) {
  Stop-WithMessage "Release version is outside Chromium's 0-65535 component range: $Version"
}
if (@($versionParts | Where-Object { $_ -ne 0 }).Count -eq 0) {
  Stop-WithMessage 'Chromium extension version 0.0.0 is not installable.'
}
if (-not (Test-Path -LiteralPath $ExtensionRoot -PathType Container)) {
  Stop-WithMessage "Extension source directory is missing: $ExtensionRoot"
}
if (-not (Test-Path -LiteralPath $OutputDirectory -PathType Container)) {
  Stop-WithMessage "Validated asset directory is missing: $OutputDirectory (run the Squirrel artifact validation first)"
}
if (-not (Test-Path -LiteralPath $ManifestPath -PathType Leaf)) {
  Stop-WithMessage "Artifact manifest is missing: $ManifestPath (run the Squirrel artifact validation first)"
}

$extensionRootFull = [System.IO.Path]::GetFullPath((Resolve-Path -LiteralPath $ExtensionRoot).Path)
$outputDirectoryFull = [System.IO.Path]::GetFullPath((Resolve-Path -LiteralPath $OutputDirectory).Path)

$extensionManifestPath = Join-Path $extensionRootFull 'manifest.json'
if (-not (Test-Path -LiteralPath $extensionManifestPath -PathType Leaf)) {
  Stop-WithMessage "Extension manifest.json is missing: $extensionManifestPath"
}
try {
  $extensionManifest = Get-Content -LiteralPath $extensionManifestPath -Raw | ConvertFrom-Json -Depth 20
} catch {
  Stop-WithMessage 'Extension manifest.json is malformed JSON.'
}
if ([int]$extensionManifest.manifest_version -ne 3) {
  Stop-WithMessage "Extension manifest_version is $($extensionManifest.manifest_version); expected Manifest V3."
}
if ([string]::IsNullOrWhiteSpace([string]$extensionManifest.name)) {
  Stop-WithMessage 'Extension manifest has no name.'
}
if ($extensionManifest.PSObject.Properties.Name -contains 'key') {
  Stop-WithMessage 'Extension manifest must not embed a signing key.'
}
$pairingSourcePath = Join-Path $extensionRootFull 'src/shared/pairing.js'
if (-not (Test-Path -LiteralPath $pairingSourcePath -PathType Leaf)) {
  Stop-WithMessage 'Extension source is missing the empty pairing capability module.'
}
$pairingSource = Get-Content -LiteralPath $pairingSourcePath -Raw
if ($pairingSource -notmatch '(?m)^\s*export const HANDOFF_CAPABILITY = "";\s*$' -or
    $pairingSource -match '[A-Za-z0-9_-]{43}') {
  Stop-WithMessage 'The public extension source must not contain an installed handoff capability.'
}

# The zip carries exactly what "Load unpacked" needs, plus the extension's own
# documentation. Tests and npm metadata stay out of the installable payload.
$payloadEntries = @('manifest.json', 'src', 'README.md', 'docs')
foreach ($entry in @('manifest.json', 'src')) {
  if (-not (Test-Path -LiteralPath (Join-Path $extensionRootFull $entry))) {
    Stop-WithMessage "Required extension payload entry is missing: $entry"
  }
}

$assetName = "material-download-manager-extension-$Version.zip"
$assetPath = Join-Path $outputDirectoryFull $assetName
if (Test-Path -LiteralPath $assetPath) {
  Remove-Item -LiteralPath $assetPath -Force
}

$stagingDirectory = Join-Path ([System.IO.Path]::GetTempPath()) "mdm-extension-package-$([guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Path $stagingDirectory -Force | Out-Null
try {
  foreach ($entry in $payloadEntries) {
    $sourcePath = Join-Path $extensionRootFull $entry
    if (-not (Test-Path -LiteralPath $sourcePath)) {
      continue
    }
    Copy-Item -LiteralPath $sourcePath -Destination (Join-Path $stagingDirectory $entry) -Recurse
  }

  $stagedManifestPath = Join-Path $stagingDirectory 'manifest.json'
  $stagedManifest = Get-Content -LiteralPath $stagedManifestPath -Raw | ConvertFrom-Json -Depth 20
  if ($stagedManifest.PSObject.Properties.Name -contains 'version') {
    $stagedManifest.version = $Version
  } else {
    $stagedManifest | Add-Member -MemberType NoteProperty -Name 'version' -Value $Version
  }
  $stagedManifest | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $stagedManifestPath -Encoding utf8NoBOM
  $stagedPairingPath = Join-Path $stagingDirectory 'src/shared/pairing.js'
  $stagedPairing = Get-Content -LiteralPath $stagedPairingPath -Raw
  if ($stagedPairing -notmatch '(?m)^\s*export const HANDOFF_CAPABILITY = "";\s*$' -or
      $stagedPairing -match '[A-Za-z0-9_-]{43}') {
    Stop-WithMessage 'The packaged extension staging area contains an installed handoff capability.'
  }

  $forbiddenPayloadFiles = @(
    Get-ChildItem -LiteralPath $stagingDirectory -Recurse -File |
      Where-Object {
        $_.Name -match '(?i)\.(?:pem|key|pfx|p12|cer|crt|der|jks|keystore|pk8|crx)$'
      }
  )
  if ($forbiddenPayloadFiles.Count -gt 0) {
    $forbiddenRelativePath = $forbiddenPayloadFiles[0].FullName.Substring($stagingDirectory.Length).TrimStart('\', '/')
    Stop-WithMessage "Extension payload contains forbidden signing or CRX material: $forbiddenRelativePath"
  }

  # manifest.json sits at the archive root, so unzip-then-Load-unpacked works
  # on the extracted folder without hunting for a nested directory.
  Compress-Archive -Path (Join-Path $stagingDirectory '*') -DestinationPath $assetPath -CompressionLevel Optimal
} finally {
  Remove-Item -LiteralPath $stagingDirectory -Recurse -Force -ErrorAction SilentlyContinue
}

if (-not (Test-Path -LiteralPath $assetPath -PathType Leaf)) {
  Stop-WithMessage "Packaging produced no archive at $assetPath"
}
$assetInfo = Get-Item -LiteralPath $assetPath
if ($assetInfo.Length -le 0) {
  Stop-WithMessage 'The packaged extension archive is empty.'
}

# Prove the archive actually carries the loadable payload before it is offered
# to anyone: manifest.json at the root and at least one service-worker source.
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::OpenRead($assetPath)
try {
  $entryNames = @($archive.Entries | ForEach-Object { $_.FullName.Replace('\', '/') })
  $entryNamesByCase = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
  foreach ($entryName in $entryNames) {
    if ([string]::IsNullOrWhiteSpace($entryName) -or $entryName.StartsWith('/') -or $entryName -match '(^|/)\.\.(/|$)' -or $entryName.Contains(':')) {
      Stop-WithMessage "The packaged archive contains an unsafe entry path: $entryName"
    }
    if (-not $entryNamesByCase.Add($entryName)) {
      Stop-WithMessage "The packaged archive contains a duplicate entry path: $entryName"
    }
    if ($entryName -match '(?i)\.(?:pem|key|pfx|p12|cer|crt|der|jks|keystore|pk8|crx)$') {
      Stop-WithMessage "The packaged archive contains forbidden signing or CRX material: $entryName"
    }
  }

  $embeddedManifestEntry = $archive.GetEntry('manifest.json')
  if ($null -eq $embeddedManifestEntry) {
    Stop-WithMessage 'The packaged archive does not carry manifest.json at its root.'
  }
  $manifestStream = $embeddedManifestEntry.Open()
  $manifestReader = [System.IO.StreamReader]::new($manifestStream, [System.Text.Encoding]::UTF8, $true)
  try {
    $embeddedManifest = $manifestReader.ReadToEnd() | ConvertFrom-Json -Depth 20
  } catch {
    Stop-WithMessage 'The packaged manifest.json is malformed JSON.'
  } finally {
    $manifestReader.Dispose()
    $manifestStream.Dispose()
  }

  if ([string]$embeddedManifest.version -ne $Version) {
    Stop-WithMessage "The packaged manifest version '$($embeddedManifest.version)' does not match release version '$Version'."
  }
  if ([int]$embeddedManifest.manifest_version -ne 3) {
    Stop-WithMessage "The packaged manifest_version is $($embeddedManifest.manifest_version); expected Manifest V3."
  }
  if ($embeddedManifest.PSObject.Properties.Name -contains 'key') {
    Stop-WithMessage 'The packaged manifest must not embed a signing key.'
  }

  $requiredArchiveEntries = @('manifest.json', 'src/shared/pairing.js')
  foreach ($referencedPath in @(
      [string]$embeddedManifest.background.service_worker,
      [string]$embeddedManifest.action.default_popup,
      [string]$embeddedManifest.options_page
    )) {
    if (-not [string]::IsNullOrWhiteSpace($referencedPath)) {
      $requiredArchiveEntries += $referencedPath.Replace('\', '/')
    }
  }
  foreach ($requiredArchiveEntry in @($requiredArchiveEntries | Select-Object -Unique)) {
    if (-not $entryNamesByCase.Contains($requiredArchiveEntry)) {
      Stop-WithMessage "The packaged archive is missing manifest-referenced file: $requiredArchiveEntry"
    }
  }
} finally {
  $archive.Dispose()
}

$assetSha256 = (Get-FileHash -LiteralPath $assetPath -Algorithm SHA256).Hash.ToLowerInvariant()

try {
  $manifest = Get-Content -LiteralPath $ManifestPath -Raw | ConvertFrom-Json -Depth 50
} catch {
  Stop-WithMessage "Artifact manifest is malformed JSON: $ManifestPath"
}
$names = @([string[]]$manifest.names)
if ($names -notcontains $assetName) {
  $names += $assetName
}
$manifest.names = @($names | Sort-Object)
if (-not ($manifest.PSObject.Properties.Name -contains 'extensionAsset')) {
  $manifest | Add-Member -MemberType NoteProperty -Name 'extensionAsset' -Value $assetName
} else {
  $manifest.extensionAsset = $assetName
}
$extensionArtifact = [pscustomobject]@{
  kind = 'chromium-extension-load-unpacked'
  format = 'zip'
  name = $assetName
  version = $Version
  sizeBytes = [int64]$assetInfo.Length
  sha256 = $assetSha256
  manifestVersion = 3
  installMethod = 'load-unpacked'
  signed = $false
}
if (-not ($manifest.PSObject.Properties.Name -contains 'extensionArtifact')) {
  $manifest | Add-Member -MemberType NoteProperty -Name 'extensionArtifact' -Value $extensionArtifact
} else {
  $manifest.extensionArtifact = $extensionArtifact
}
$artifactEvidence = if ($manifest.PSObject.Properties.Name -contains 'artifacts') { @($manifest.artifacts) } else { @() }
$artifactEvidence = @($artifactEvidence | Where-Object { [string]$_.name -ne $assetName }) + @(
  [pscustomobject]@{
    name = $assetName
    sizeBytes = [int64]$assetInfo.Length
    sha256 = $assetSha256
  }
)
$artifactEvidence = @($artifactEvidence | Sort-Object { [string]$_.name })
if (-not ($manifest.PSObject.Properties.Name -contains 'artifacts')) {
  $manifest | Add-Member -MemberType NoteProperty -Name 'artifacts' -Value $artifactEvidence
} else {
  $manifest.artifacts = $artifactEvidence
}
$manifest | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $ManifestPath -Encoding utf8NoBOM

Write-Output "Packaged Chromium extension ZIP: $assetName ($($assetInfo.Length) bytes, SHA-256 $assetSha256, version $Version, $($entryNames.Count) entries)"
