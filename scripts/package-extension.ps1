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

$maxArchiveEntries = 1024
$maxArchiveEntryBytes = 16MB
$maxArchiveUncompressedBytes = 64MB
$maxArchiveSignatureCandidates = 32
$maxManifestBytes = 16KB
$maxPairingBytes = 4KB
$maxStaticIconBytes = 512KB
$staticIconPaths = [ordered]@{
  '16' = 'assets/icons/icon16.png'
  '32' = 'assets/icons/icon32.png'
  '48' = 'assets/icons/icon48.png'
  '128' = 'assets/icons/icon128.png'
}
$forbiddenMaterialExtensionPattern = '(?i)\.(?:pem|key|pfx|p12|cer|crt|der|jks|keystore|pk8|crx)$'
$forbiddenKeyMarkerPattern = '(?im)-----BEGIN (?:[A-Z0-9-]+ )*(?:PRIVATE KEY|CERTIFICATE)-----'
$crxMagic = [byte[]](0x43, 0x72, 0x32, 0x34)
$zipMagic = [byte[]](0x50, 0x4b, 0x03, 0x04)
Add-Type -AssemblyName System.IO.Compression.FileSystem

function Assert-StaticExtensionIcons($Manifest, [string]$Root, [string]$Label) {
  if ($null -eq $Manifest.icons -or $Manifest.icons -isnot [psobject]) {
    Stop-WithMessage "$Label must declare packaged static icons."
  }
  if ($null -eq $Manifest.action -or $Manifest.action -isnot [psobject] -or
      $null -eq $Manifest.action.default_icon -or $Manifest.action.default_icon -isnot [psobject]) {
    Stop-WithMessage "$Label must declare action.default_icon static fallbacks."
  }

  foreach ($sizeText in $staticIconPaths.Keys) {
    $expectedPath = [string]$staticIconPaths[$sizeText]
    foreach ($iconSetName in @('icons', 'action.default_icon')) {
      $iconSet = if ($iconSetName -eq 'icons') { $Manifest.icons } else { $Manifest.action.default_icon }
      $property = $iconSet.PSObject.Properties[$sizeText]
      if ($null -eq $property -or [string]$property.Value -ne $expectedPath) {
        Stop-WithMessage "$Label ${iconSetName}[$sizeText] must be $expectedPath."
      }
    }

    $iconPath = Join-Path $Root $expectedPath
    if (-not (Test-Path -LiteralPath $iconPath -PathType Leaf)) {
      Stop-WithMessage "$Label static icon is missing: $expectedPath"
    }
    $iconInfo = Get-Item -LiteralPath $iconPath
    if ($iconInfo.Length -lt 33 -or $iconInfo.Length -gt $maxStaticIconBytes) {
      Stop-WithMessage "$Label static icon has an invalid byte size: $expectedPath"
    }
    $iconBytes = [System.IO.File]::ReadAllBytes($iconPath)
    $pngSignature = [byte[]](137, 80, 78, 71, 13, 10, 26, 10)
    for ($index = 0; $index -lt $pngSignature.Length; $index += 1) {
      if ($iconBytes[$index] -ne $pngSignature[$index]) {
        Stop-WithMessage "$Label static icon is not a PNG: $expectedPath"
      }
    }
    if ([System.Text.Encoding]::ASCII.GetString($iconBytes, 12, 4) -ne 'IHDR') {
      Stop-WithMessage "$Label static icon has no PNG IHDR: $expectedPath"
    }
    $expectedSize = [byte][int]$sizeText
    if ($iconBytes[16] -ne 0 -or $iconBytes[17] -ne 0 -or $iconBytes[18] -ne 0 -or $iconBytes[19] -ne $expectedSize -or
        $iconBytes[20] -ne 0 -or $iconBytes[21] -ne 0 -or $iconBytes[22] -ne 0 -or $iconBytes[23] -ne $expectedSize) {
      Stop-WithMessage "$Label static icon dimensions do not match $sizeText x $sizeText: $expectedPath"
    }
  }
}

function Find-MagicOffset([byte[]]$Bytes, [byte[]]$Magic, [int]$MaximumOffset, [int]$StartOffset = 0) {
  if ($null -eq $Bytes -or $Bytes.Length -lt $Magic.Length) {
    return -1
  }
  $firstOffset = [Math]::Max(0, $StartOffset)
  $lastOffset = [Math]::Min($Bytes.Length - $Magic.Length, $MaximumOffset)
  for ($offset = $firstOffset; $offset -le $lastOffset; $offset += 1) {
    $matches = $true
    for ($index = 0; $index -lt $Magic.Length; $index += 1) {
      if ($Bytes[$offset + $index] -ne $Magic[$index]) {
        $matches = $false
        break
      }
    }
    if ($matches) {
      return $offset
    }
  }
  return -1
}

function Read-StreamBytes([System.IO.Stream]$Stream, [string]$Label) {
  $buffer = [System.IO.MemoryStream]::new()
  try {
    $Stream.CopyTo($buffer)
    return $buffer.ToArray()
  } finally {
    $buffer.Dispose()
  }
}

function Inspect-PayloadBytes([byte[]]$Bytes, [string]$Label, [int]$Depth = 0) {
  if ($null -eq $Bytes -or $Bytes.Length -eq 0) {
    return
  }
  if ((Find-MagicOffset $Bytes $crxMagic $maxArchiveEntryBytes) -ge 0) {
    Stop-WithMessage "Payload contains forbidden signing or CRX material: $Label"
  }
  $payloadText = [System.Text.Encoding]::UTF8.GetString($Bytes)
  $payloadUnicodeText = [System.Text.Encoding]::Unicode.GetString($Bytes)
  $payloadBigEndianText = [System.Text.Encoding]::BigEndianUnicode.GetString($Bytes)
  if ($payloadText -match $forbiddenKeyMarkerPattern -or
      $payloadUnicodeText -match $forbiddenKeyMarkerPattern -or
      $payloadBigEndianText -match $forbiddenKeyMarkerPattern) {
    Stop-WithMessage "Payload contains forbidden signing or CRX material: $Label"
  }
  $searchOffset = 0
  $candidateAttempts = 0
  $nestedStream = $null
  $nestedArchive = $null
  $nestedEntries = @()
  try {
    while ($null -eq $nestedArchive) {
      $zipOffset = Find-MagicOffset $Bytes $zipMagic $maxArchiveEntryBytes $searchOffset
      if ($zipOffset -lt 0) {
        return
      }
      $candidateAttempts += 1
      if ($candidateAttempts -gt $maxArchiveSignatureCandidates) {
        Stop-WithMessage "Payload contains too many malformed nested archive signatures: $Label"
      }
      $zipBytes = [byte[]]::new($Bytes.Length - $zipOffset)
      [System.Array]::Copy($Bytes, $zipOffset, $zipBytes, 0, $zipBytes.Length)
      $candidateStream = [System.IO.MemoryStream]::new($zipBytes, $false)
      $candidateArchive = $null
      $candidateEntries = @()
      try {
        $candidateArchive = [System.IO.Compression.ZipArchive]::new(
          $candidateStream,
          [System.IO.Compression.ZipArchiveMode]::Read,
          $true
        )
        $candidateEntries = @($candidateArchive.Entries)
      } catch {
        if ($null -ne $candidateArchive) {
          $candidateArchive.Dispose()
        }
        $candidateStream.Dispose()
        $searchOffset = $zipOffset + 1
        continue
      }
      $candidateEntriesAreUsable = $candidateEntries.Count -gt 0 -and
        @($candidateEntries | Where-Object {
          $null -eq $_ -or
          -not ($_.PSObject.Properties.Name -contains 'FullName') -or
          -not ($_.PSObject.Properties.Name -contains 'Length')
        }).Count -eq 0
      if (-not $candidateEntriesAreUsable) {
        $candidateArchive.Dispose()
        $candidateStream.Dispose()
        $searchOffset = $zipOffset + 1
        continue
      }
      if ($Depth -ge 3) {
        $candidateArchive.Dispose()
        $candidateStream.Dispose()
        Stop-WithMessage "Payload contains nested archives beyond the supported depth: $Label"
      }
      $nestedStream = $candidateStream
      $nestedArchive = $candidateArchive
      $nestedEntries = $candidateEntries
    }
    if ($nestedEntries.Count -gt $maxArchiveEntries) {
      Stop-WithMessage "Payload contains an oversized nested archive: $Label"
    }
    $nestedUncompressedBytes = [int64]0
    foreach ($nestedEntry in $nestedEntries) {
      $nestedName = $nestedEntry.FullName.Replace('\', '/')
      if ([string]::IsNullOrWhiteSpace($nestedName) -or $nestedName.StartsWith('/') -or
          $nestedName -match '(^|/)\.\.(/|$)' -or $nestedName.Contains(':')) {
        Stop-WithMessage "Payload contains an unsafe nested archive path: $Label!$nestedName"
      }
      if ($nestedName -match $forbiddenMaterialExtensionPattern) {
        Stop-WithMessage "Payload contains forbidden signing or CRX material: $Label!$nestedName"
      }
      if ([int64]$nestedEntry.Length -gt $maxArchiveEntryBytes) {
        Stop-WithMessage "Payload contains an oversized nested archive entry: $Label!$nestedName"
      }
      $nestedUncompressedBytes += [int64]$nestedEntry.Length
      if ($nestedUncompressedBytes -gt $maxArchiveUncompressedBytes) {
        Stop-WithMessage "Payload contains an oversized nested archive: $Label"
      }
      if ([int64]$nestedEntry.Length -le 0) {
        continue
      }
      $nestedEntryStream = $nestedEntry.Open()
      try {
        $nestedEntryBytes = Read-StreamBytes $nestedEntryStream "$Label!$nestedName"
      } finally {
        $nestedEntryStream.Dispose()
      }
      Inspect-PayloadBytes $nestedEntryBytes "$Label!$nestedName" ($Depth + 1)
    }
  } finally {
    if ($null -ne $nestedArchive) {
      $nestedArchive.Dispose()
    }
    if ($null -ne $nestedStream) {
      $nestedStream.Dispose()
    }
  }
}

function Inspect-PayloadFile([string]$Path, [string]$Label) {
  $file = Get-Item -LiteralPath $Path
  if ([int64]$file.Length -gt $maxArchiveEntryBytes) {
    Stop-WithMessage "Extension payload file exceeds the $maxArchiveEntryBytes-byte bound: $Label"
  }
  Inspect-PayloadBytes ([System.IO.File]::ReadAllBytes($Path)) $Label
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
Assert-StaticExtensionIcons $extensionManifest $extensionRootFull 'Extension manifest'
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
$payloadEntries = @('manifest.json', 'src', 'assets', 'README.md', 'docs')
foreach ($entry in @('manifest.json', 'src', 'assets')) {
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
  Assert-StaticExtensionIcons $stagedManifest $stagingDirectory 'Packaged extension manifest'
  $stagedPairingPath = Join-Path $stagingDirectory 'src/shared/pairing.js'
  $stagedPairing = Get-Content -LiteralPath $stagedPairingPath -Raw
  if ($stagedPairing -notmatch '(?m)^\s*export const HANDOFF_CAPABILITY = "";\s*$' -or
      $stagedPairing -match '[A-Za-z0-9_-]{43}') {
    Stop-WithMessage 'The packaged extension staging area contains an installed handoff capability.'
  }

  $stagingFiles = @(Get-ChildItem -LiteralPath $stagingDirectory -Recurse -File)
  $stagingUncompressedBytes = [int64]0
  foreach ($stagingFile in $stagingFiles) {
    $stagingUncompressedBytes += [int64]$stagingFile.Length
  }
  if ($stagingUncompressedBytes -gt $maxArchiveUncompressedBytes) {
    Stop-WithMessage "Extension payload exceeds the $maxArchiveUncompressedBytes-byte uncompressed bound."
  }
  foreach ($payloadFile in $stagingFiles) {
    $payloadRelativePath = $payloadFile.FullName.Substring($stagingDirectory.Length).TrimStart('\', '/')
    if ($payloadFile.Name -match $forbiddenMaterialExtensionPattern) {
      Stop-WithMessage "Extension payload contains forbidden signing or CRX material: $payloadRelativePath"
    }
    Inspect-PayloadFile $payloadFile.FullName $payloadRelativePath
  }

  # manifest.json sits at the archive root, so unzip-then-Load-unpacked works
  # on the extracted folder without hunting for a nested directory.
  try {
    Compress-Archive -Path (Join-Path $stagingDirectory '*') -DestinationPath $assetPath -CompressionLevel Optimal
  } catch {
    Remove-Item -LiteralPath $assetPath -Force -ErrorAction SilentlyContinue
    throw
  }
} finally {
  Remove-Item -LiteralPath $stagingDirectory -Recurse -Force -ErrorAction SilentlyContinue
}

$assetValidationSucceeded = $false
try {
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
  if ($archive.Entries.Count -eq 0 -or $archive.Entries.Count -gt $maxArchiveEntries) {
    Stop-WithMessage "The packaged archive has an invalid entry count (maximum $maxArchiveEntries)."
  }
  $entryNames = @($archive.Entries | ForEach-Object { $_.FullName.Replace('\', '/') })
  $entryNamesByCase = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
  $totalUncompressedBytes = [int64]0
  foreach ($entry in $archive.Entries) {
    $entryName = $entry.FullName.Replace('\', '/')
    if ([string]::IsNullOrWhiteSpace($entryName) -or $entryName.StartsWith('/') -or $entryName -match '(^|/)\.\.(/|$)' -or $entryName.Contains(':')) {
      Stop-WithMessage "The packaged archive contains an unsafe entry path: $entryName"
    }
    if (-not $entryNamesByCase.Add($entryName)) {
      Stop-WithMessage "The packaged archive contains a duplicate entry path: $entryName"
    }
    if ($entryName -match $forbiddenMaterialExtensionPattern) {
      Stop-WithMessage "The packaged archive contains forbidden signing or CRX material: $entryName"
    }
    $entryLength = [int64]$entry.Length
    if ($entryLength -gt $maxArchiveEntryBytes) {
      Stop-WithMessage "The packaged archive entry exceeds the $maxArchiveEntryBytes-byte bound: $entryName"
    }
    $totalUncompressedBytes += $entryLength
    if ($totalUncompressedBytes -gt $maxArchiveUncompressedBytes) {
      Stop-WithMessage "The packaged archive exceeds the $maxArchiveUncompressedBytes-byte uncompressed bound."
    }
    if ($entryLength -gt 0) {
      $entryStream = $entry.Open()
      try {
        $entryBytes = Read-StreamBytes $entryStream $entryName
      } finally {
        $entryStream.Dispose()
      }
      Inspect-PayloadBytes $entryBytes $entryName
    }
  }

  $embeddedManifestEntry = $archive.GetEntry('manifest.json')
  if ($null -eq $embeddedManifestEntry -or $embeddedManifestEntry.Length -le 0 -or $embeddedManifestEntry.Length -gt $maxManifestBytes) {
    Stop-WithMessage 'The packaged archive has no bounded root manifest.json.'
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

  $pairingEntry = $archive.GetEntry('src/shared/pairing.js')
  if ($null -eq $pairingEntry -or $pairingEntry.Length -le 0 -or $pairingEntry.Length -gt $maxPairingBytes) {
    Stop-WithMessage 'The packaged archive has no bounded empty pairing capability module.'
  }

  $requiredArchiveEntries = @('manifest.json', 'src/shared/pairing.js') + @($staticIconPaths.Values)
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

$assetValidationSucceeded = $true
Write-Output "Packaged Chromium extension ZIP: $assetName ($($assetInfo.Length) bytes, SHA-256 $assetSha256, version $Version, $($entryNames.Count) entries)"
} catch {
  if (-not $assetValidationSucceeded) {
    Remove-Item -LiteralPath $assetPath -Force -ErrorAction SilentlyContinue
  }
  throw
}
