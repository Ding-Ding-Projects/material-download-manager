[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^\d+\.\d+\.\d+$')]
  [string]$Version
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Stop-WithMessage([string]$Message) {
  throw "Unsigned Squirrel.Windows build failed: $Message"
}

$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$designRoot = Join-Path $repositoryRoot 'design'
$packagePath = Join-Path $designRoot 'package.json'
$extensionManifestPath = Join-Path $repositoryRoot 'extension/manifest.json'
$releaseRoot = Join-Path $designRoot 'release'

if (-not (Test-Path -LiteralPath $packagePath -PathType Leaf)) {
  Stop-WithMessage "Missing package manifest: $packagePath"
}
if (-not (Test-Path -LiteralPath $extensionManifestPath -PathType Leaf)) {
  Stop-WithMessage "Missing bundled extension manifest: $extensionManifestPath"
}

$workspacePrefix = ([System.IO.Path]::GetFullPath($repositoryRoot)).TrimEnd('\') + '\'
$releaseRootFull = [System.IO.Path]::GetFullPath($releaseRoot)
if (-not $releaseRootFull.StartsWith($workspacePrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
  Stop-WithMessage 'The release output path is outside the checked-out repository.'
}

$originalBytes = [System.IO.File]::ReadAllBytes($packagePath)
$originalHash = (Get-FileHash -LiteralPath $packagePath -Algorithm SHA256).Hash
$originalExtensionManifestBytes = [System.IO.File]::ReadAllBytes($extensionManifestPath)
$originalExtensionManifestHash = (Get-FileHash -LiteralPath $extensionManifestPath -Algorithm SHA256).Hash
try {
  $package = [System.Text.Encoding]::UTF8.GetString($originalBytes) | ConvertFrom-Json -Depth 40
} catch {
  Stop-WithMessage 'design/package.json is malformed JSON.'
}
try {
  $extensionManifest = [System.Text.Encoding]::UTF8.GetString($originalExtensionManifestBytes) | ConvertFrom-Json -Depth 20
} catch {
  Stop-WithMessage 'extension/manifest.json is malformed JSON.'
}
if ([int]$extensionManifest.manifest_version -ne 3 -or $extensionManifest.PSObject.Properties.Name -contains 'key') {
  Stop-WithMessage 'The bundled extension must be unsigned Manifest V3 without a manifest key.'
}

if ($null -eq $package.build -or $null -eq $package.build.forceCodeSigning -or $null -eq $package.build.win) {
  Stop-WithMessage 'design/package.json must declare build.forceCodeSigning so the unsigned override is explicit.'
}
if ($package.build.forceCodeSigning -ne $false) {
  Stop-WithMessage 'design/package.json must set build.forceCodeSigning to false because code signing is prohibited.'
}
if ($package.build.win.signAndEditExecutable -ne $false) {
  Stop-WithMessage 'design/package.json must set build.win.signAndEditExecutable to false because code signing is prohibited.'
}
if ($null -ne $package.build.PSObject.Properties['signExecutable'] -or $null -ne $package.build.PSObject.Properties['signAndEditExecutable']) {
  Stop-WithMessage 'design/package.json contains unsupported root-level signing controls for the declared electron-builder schema.'
}

if (-not (Test-Path -LiteralPath $releaseRoot -PathType Container)) {
  New-Item -ItemType Directory -Path $releaseRoot -Force | Out-Null
} else {
  Remove-Item -LiteralPath $releaseRoot -Recurse -Force
}

$signingEnvironmentNames = @(
  'CSC_LINK',
  'CSC_KEY_PASSWORD',
  'WIN_CSC_LINK',
  'WIN_CSC_KEY_PASSWORD',
  'CSC_NAME',
  'WIN_CSC_NAME',
  'CSC_IDENTITY_AUTO_DISCOVERY'
)
$savedSigningEnvironment = @{}
foreach ($name in $signingEnvironmentNames) {
  $existing = Get-Item -Path "Env:$name" -ErrorAction SilentlyContinue
  $savedSigningEnvironment[$name] = @{
    Exists = $null -ne $existing
    Value = if ($null -ne $existing) { [string]$existing.Value } else { $null }
  }
}

$exitCode = 1
try {
  $package.build.forceCodeSigning = $false
  $package.build.win.signAndEditExecutable = $false
  $temporaryJson = $package | ConvertTo-Json -Depth 40
  [System.IO.File]::WriteAllText(
    $packagePath,
    $temporaryJson,
    [System.Text.UTF8Encoding]::new($false)
  )
  $extensionManifest.version = $Version
  [System.IO.File]::WriteAllText(
    $extensionManifestPath,
    ($extensionManifest | ConvertTo-Json -Depth 20),
    [System.Text.UTF8Encoding]::new($false)
  )

  foreach ($name in $signingEnvironmentNames) {
    Remove-Item -Path "Env:$name" -ErrorAction SilentlyContinue
  }
  $env:CSC_IDENTITY_AUTO_DISCOVERY = 'false'

  Push-Location $designRoot
  try {
    & npm exec -- electron-builder --win squirrel --x64 --publish never "-c.extraMetadata.version=$Version"
    $exitCode = $LASTEXITCODE
  } finally {
    Pop-Location
  }
} finally {
  foreach ($name in $signingEnvironmentNames) {
    $saved = $savedSigningEnvironment[$name]
    if ($saved.Exists) {
      Set-Item -Path "Env:$name" -Value $saved.Value
    } else {
      Remove-Item -Path "Env:$name" -ErrorAction SilentlyContinue
    }
  }

  [System.IO.File]::WriteAllBytes($packagePath, $originalBytes)
  [System.IO.File]::WriteAllBytes($extensionManifestPath, $originalExtensionManifestBytes)
}

$restoredHash = (Get-FileHash -LiteralPath $packagePath -Algorithm SHA256).Hash
if ($restoredHash -ne $originalHash) {
  Stop-WithMessage 'The original design/package.json bytes were not restored after packaging.'
}
$restoredExtensionManifestHash = (Get-FileHash -LiteralPath $extensionManifestPath -Algorithm SHA256).Hash
if ($restoredExtensionManifestHash -ne $originalExtensionManifestHash) {
  Stop-WithMessage 'The original extension/manifest.json bytes were not restored after packaging.'
}
if ($exitCode -ne 0) {
  Stop-WithMessage "electron-builder exited with code $exitCode."
}
if (-not (Test-Path -LiteralPath $releaseRoot -PathType Container)) {
  Stop-WithMessage 'electron-builder did not produce design/release.'
}

Write-Output "Built unsigned Squirrel.Windows artifacts for version $Version; the application and bundled-extension source manifests were restored byte-for-byte."
