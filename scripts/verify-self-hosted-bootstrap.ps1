[CmdletBinding()]
param(
  [ValidateSet('static', 'preinstall', 'postinstall')]
  [string]$Phase = 'static',
  [string]$InventoryPath = (Join-Path $PSScriptRoot 'self-hosted-dependencies.json')
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Stop-WithMessage([string]$Message) {
  throw "Self-hosted bootstrap check failed: $Message"
}

function Require-Command([string]$Name) {
  if ($null -eq (Get-Command $Name -ErrorAction SilentlyContinue)) {
    Stop-WithMessage "Required command '$Name' is not available."
  }
}

function Get-JsonFile([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    Stop-WithMessage "Required JSON file is missing: $Path"
  }
  try {
    return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json -Depth 40
  } catch {
    Stop-WithMessage "JSON file is malformed: $Path"
  }
}

function Get-RepoRoot {
  $root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
  if (-not (Test-Path -LiteralPath (Join-Path $root '.git') -PathType Any)) {
    Stop-WithMessage "Could not resolve the repository root from $PSScriptRoot."
  }
  return $root
}

function Read-CommandVersion([string]$Command, [string[]]$Arguments) {
  $output = & $Command @Arguments 2>&1 | Out-String
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($output)) {
    Stop-WithMessage "Could not read the version of $Command."
  }
  return $output.Trim()
}

$repositoryRoot = Get-RepoRoot
$inventory = Get-JsonFile $InventoryPath
if ($inventory.schemaVersion -ne 1) {
  Stop-WithMessage 'The dependency inventory schemaVersion must be 1.'
}

$labels = @($inventory.runnerContract.labels | ForEach-Object { [string]$_ })
if ($labels.Count -ne 4 -or $labels[0] -ne 'self-hosted' -or $labels[1] -ne 'windows' -or $labels[2] -ne 'x64' -or $labels[3] -ne 'material-download-manager-windows-x64') {
  Stop-WithMessage 'The dependency inventory must declare the exact four-label Windows runner contract.'
}

$workflowEntries = @($inventory.workflows.PSObject.Properties)
if ($workflowEntries.Count -lt 3) {
  Stop-WithMessage 'The dependency inventory must cover verification, stable-release, and Pages workflows.'
}

$workflowTexts = @{}
foreach ($entry in $workflowEntries) {
  $workflowPath = Join-Path $repositoryRoot ([string]$entry.Value.file)
  if (-not (Test-Path -LiteralPath $workflowPath -PathType Leaf)) {
    Stop-WithMessage "The inventory references a missing workflow: $($entry.Value.file)"
  }
  $workflowTexts[[string]$entry.Name] = Get-Content -LiteralPath $workflowPath -Raw
}

foreach ($entry in $workflowTexts.GetEnumerator()) {
  $workflowText = [string]$entry.Value
  if ($workflowText -notmatch '(?ms)runs-on:\s*\[[^\]]*\bself-hosted\b[^\]]*\]') {
    Stop-WithMessage "Workflow $($entry.Key) does not use an explicit self-hosted label array."
  }
  foreach ($label in $labels) {
    if ($workflowText.IndexOf($label, [System.StringComparison]::Ordinal) -lt 0) {
      Stop-WithMessage "Workflow $($entry.Key) is missing runner label '$label'."
    }
  }
  foreach ($forbidden in @('windows-latest', 'ubuntu-latest', 'macos-latest', 'CSC_LINK', 'CSC_KEY_PASSWORD', 'skip_signing', '--prerelease')) {
    if ($workflowText.IndexOf($forbidden, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) {
      Stop-WithMessage "Workflow $($entry.Key) contains forbidden release or runner text '$forbidden'."
    }
  }
}

$releaseWorkflow = [string]$workflowTexts['stable-release']
foreach ($requiredReleaseMarker in @('UNSIGNED', 'isPrerelease', 'draft=false', 'scripts/build-unsigned-squirrel.ps1', 'scripts/validate-squirrel-artifacts.ps1')) {
  if ($releaseWorkflow.IndexOf($requiredReleaseMarker, [System.StringComparison]::Ordinal) -lt 0) {
    Stop-WithMessage "The stable-release workflow is missing required marker '$requiredReleaseMarker'."
  }
}

if ($Phase -eq 'static') {
  Write-Output "Static self-hosted workflow contract verified for labels: $($labels -join ', ')."
  exit 0
}

if ($env:GITHUB_ACTIONS -eq 'true') {
  if ($env:RUNNER_OS -ne 'Windows') {
    Stop-WithMessage "RUNNER_OS is '$($env:RUNNER_OS)', expected Windows."
  }
  if ($env:RUNNER_ARCH -ne 'X64') {
    Stop-WithMessage "RUNNER_ARCH is '$($env:RUNNER_ARCH)', expected X64."
  }
}

foreach ($command in @('git', 'gh', 'node', 'npm', 'pwsh')) {
  Require-Command $command
}

$gitVersion = Read-CommandVersion 'git' @('--version')
$ghVersion = Read-CommandVersion 'gh' @('--version')
$nodeVersion = Read-CommandVersion 'node' @('--version')
$npmVersion = Read-CommandVersion 'npm' @('--version')
$pwshVersion = Read-CommandVersion 'pwsh' @('--version')

if ($nodeVersion -notmatch '^v(?<major>\d+)\.') {
  Stop-WithMessage "Node.js returned an unparseable version: $nodeVersion"
}
if ([int]$Matches.major -ne 22) {
  Stop-WithMessage "Node.js major version is $($Matches.major); the workflow contract requires Node.js 22.x."
}

if ($Phase -eq 'preinstall') {
  Write-Output 'Pre-install bootstrap checks passed.'
  Write-Output "Git: $gitVersion"
  Write-Output "GitHub CLI: $ghVersion"
  Write-Output "Node.js: $nodeVersion"
  Write-Output "npm: $npmVersion"
  Write-Output "PowerShell: $pwshVersion"
  exit 0
}

$packagePath = Join-Path $repositoryRoot 'design/package.json'
$lockPath = Join-Path $repositoryRoot 'design/package-lock.json'
$nodeModulesPath = Join-Path $repositoryRoot 'design/node_modules'
$electronBinaryPath = Join-Path $repositoryRoot 'design/node_modules/electron/dist/electron.exe'
$esbuildBinaryPath = Join-Path $repositoryRoot 'design/node_modules/@esbuild/win32-x64/esbuild.exe'
$package = Get-JsonFile $packagePath
$lock = Get-JsonFile $lockPath
if ($lock.lockfileVersion -ne 3) {
  Stop-WithMessage "design/package-lock.json lockfileVersion is $($lock.lockfileVersion), expected 3."
}
if (-not (Test-Path -LiteralPath $nodeModulesPath -PathType Container)) {
  Stop-WithMessage 'design/node_modules is missing after npm ci.'
}
if (-not (Test-Path -LiteralPath $electronBinaryPath -PathType Leaf)) {
  Stop-WithMessage 'Electron native binary is missing; complete-node-binary-bootstrap.ps1 must run after npm ci.'
}
if (-not (Test-Path -LiteralPath $esbuildBinaryPath -PathType Leaf)) {
  Stop-WithMessage 'esbuild native binary is missing at node_modules/@esbuild/win32-x64/esbuild.exe; complete-node-binary-bootstrap.ps1 must run after npm ci.'
}
if ([string]$package.name -ne 'material-download-manager') {
  Stop-WithMessage 'design/package.json has an unexpected package name.'
}

Push-Location (Join-Path $repositoryRoot 'design')
try {
  $builderVersion = & npx --no-install electron-builder --version 2>&1 | Out-String
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($builderVersion)) {
    Stop-WithMessage 'electron-builder is not available from the lockfile-installed dependencies.'
  }
} finally {
  Pop-Location
}

Write-Output 'Post-install bootstrap checks passed.'
Write-Output "Node.js: $nodeVersion"
Write-Output "npm: $npmVersion"
Write-Output "electron-builder: $($builderVersion.Trim())"
