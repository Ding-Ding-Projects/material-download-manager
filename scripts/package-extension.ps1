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

if ($Version -notmatch '^\d+\.\d+\.\d+$') {
  Stop-WithMessage "Release version is not stable semantic version syntax: $Version"
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
} finally {
  $archive.Dispose()
}
if ($entryNames -notcontains 'manifest.json') {
  Stop-WithMessage 'The packaged archive does not carry manifest.json at its root.'
}
if (-not ($entryNames | Where-Object { $_ -eq 'src/service-worker.js' })) {
  Stop-WithMessage 'The packaged archive does not carry src/service-worker.js.'
}

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
$manifest | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $ManifestPath -Encoding utf8NoBOM

Write-Output "Packaged Chromium extension asset: $assetName ($($assetInfo.Length) bytes, $($entryNames.Count) entries)"
