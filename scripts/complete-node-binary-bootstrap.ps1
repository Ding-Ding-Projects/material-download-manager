[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Stop-WithMessage([string]$Message) {
  throw "Native dependency bootstrap failed: $Message"
}

$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$designRoot = Join-Path $repositoryRoot 'design'
$electronInstall = Join-Path $designRoot 'node_modules/electron/install.js'
$esbuildInstall = Join-Path $designRoot 'node_modules/esbuild/install.js'
$electronBinary = Join-Path $designRoot 'node_modules/electron/dist/electron.exe'
$esbuildBinary = Join-Path $designRoot 'node_modules/esbuild/esbuild.exe'

foreach ($path in @($electronInstall, $esbuildInstall)) {
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
    Stop-WithMessage "The lockfile dependency install script is missing: $path"
  }
}

Push-Location $designRoot
try {
  & node node_modules/electron/install.js
  if ($LASTEXITCODE -ne 0) {
    Stop-WithMessage "Electron install.js exited with code $LASTEXITCODE."
  }
  & node node_modules/esbuild/install.js
  if ($LASTEXITCODE -ne 0) {
    Stop-WithMessage "esbuild install.js exited with code $LASTEXITCODE."
  }
} finally {
  Pop-Location
}

if (-not (Test-Path -LiteralPath $electronBinary -PathType Leaf)) {
  Stop-WithMessage 'Electron install.js completed without producing node_modules/electron/dist/electron.exe.'
}
if (-not (Test-Path -LiteralPath $esbuildBinary -PathType Leaf)) {
  Stop-WithMessage 'esbuild install.js completed without producing node_modules/esbuild/esbuild.exe.'
}

Write-Output 'Native dependency bootstrap passed: Electron and esbuild binaries are present.'
