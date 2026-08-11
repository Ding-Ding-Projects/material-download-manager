[CmdletBinding()]
param(
  [ValidateSet('static', 'preinstall', 'postinstall')]
  [string]$Phase = 'static',
  [string]$InventoryPath = (Join-Path $PSScriptRoot 'self-hosted-dependencies.json'),
  [string]$RepositoryRootOverride = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Stop-WithMessage([string]$Message) {
  throw "Workflow bootstrap check failed: $Message"
}

function Require-Command([string]$Name) {
  if ($null -eq (Get-Command $Name -ErrorAction SilentlyContinue)) {
    Stop-WithMessage "Required command '$Name' is not available."
  }
}

function Get-JsonFile([string]$Path, [switch]$AllowEmptyPropertyName) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    Stop-WithMessage "Required JSON file is missing: $Path"
  }
  try {
    if ($AllowEmptyPropertyName) {
      return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json -Depth 40 -AsHashtable
    }
    return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json -Depth 40
  } catch {
    Stop-WithMessage "JSON file is malformed: $Path"
  }
}

function Get-RepoRoot {
  $root = if ([string]::IsNullOrWhiteSpace($RepositoryRootOverride)) {
    (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
  } else {
    [System.IO.Path]::GetFullPath($RepositoryRootOverride)
  }
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
if ($inventory.schemaVersion -ne 2) {
  Stop-WithMessage 'The dependency inventory schemaVersion must be 2.'
}

$runnerImage = [string]$inventory.runnerContract.githubHostedImage
if ($runnerImage -ne 'windows-2025') {
  Stop-WithMessage 'The dependency inventory must pin the current Windows GitHub-hosted fallback as windows-2025.'
}
if ([string]$inventory.runnerContract.operatingSystem -ne 'Windows' -or [string]$inventory.runnerContract.architecture -ne 'X64') {
  Stop-WithMessage 'The dependency inventory must declare Windows X64.'
}

if ($Phase -eq 'static') {
$workflowEntries = @($inventory.workflows.PSObject.Properties)
if ($workflowEntries.Count -ne 2 -or
    @($workflowEntries | Where-Object { $_.Name -eq 'stable-release' }).Count -ne 1 -or
    @($workflowEntries | Where-Object { $_.Name -eq 'pages' }).Count -ne 1) {
  Stop-WithMessage 'The dependency inventory must cover exactly the stable-release and Pages workflows.'
}

$workflowDirectory = Join-Path $repositoryRoot '.github/workflows'
$discoveredWorkflowFiles = @(
  Get-ChildItem -LiteralPath $workflowDirectory -File |
    Where-Object { $_.Extension -in @('.yml', '.yaml') } |
    ForEach-Object { ".github/workflows/$($_.Name)" } |
    Sort-Object
)
$inventoryWorkflowFiles = @($workflowEntries | ForEach-Object { ([string]$_.Value.file).Replace('\', '/') } | Sort-Object)
if (($discoveredWorkflowFiles -join "`n") -ne ($inventoryWorkflowFiles -join "`n")) {
  Stop-WithMessage "The hand-written workflow inventory differs from the workflow files on disk. Inventory: $($inventoryWorkflowFiles -join ', '); disk: $($discoveredWorkflowFiles -join ', ')."
}

$workflowTexts = @{}
foreach ($entry in $workflowEntries) {
  $workflowPath = Join-Path $repositoryRoot ([string]$entry.Value.file)
  if (-not (Test-Path -LiteralPath $workflowPath -PathType Leaf)) {
    Stop-WithMessage "The inventory references a missing workflow: $($entry.Value.file)"
  }
  $workflowText = Get-Content -LiteralPath $workflowPath -Raw
  $workflowTexts[[string]$entry.Name] = $workflowText
  foreach ($job in @($entry.Value.jobs)) {
    if ($workflowText -notmatch "(?m)^  $([regex]::Escape([string]$job)):\s*$") {
      Stop-WithMessage "Workflow $($entry.Name) is missing inventoried job '$job'."
    }
  }
  if ($workflowText -notmatch "(?m)^    runs-on:\s*$([regex]::Escape($runnerImage))\s*$") {
    Stop-WithMessage "Workflow $($entry.Name) does not use the pinned runner image '$runnerImage'."
  }
  foreach ($forbiddenRunnerOrSigner in @('windows-latest', 'ubuntu-latest', 'macos-latest', 'CSC_LINK', 'CSC_KEY_PASSWORD', 'WIN_CSC_LINK', 'WIN_CSC_KEY_PASSWORD', '--prerelease')) {
    if ($workflowText.IndexOf($forbiddenRunnerOrSigner, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) {
      Stop-WithMessage "Workflow $($entry.Name) contains forbidden runner, signer, or release text '$forbiddenRunnerOrSigner'."
    }
  }
  if ($workflowText -match '(?im)^\s*runs-on:\s*(?:self-hosted|\[[^\]]*self-hosted)') {
    Stop-WithMessage "Workflow $($entry.Name) must not target a self-hosted runner while the inventoried repository runner is offline."
  }
}

$forbiddenQualityCommands = @(
  [pscustomobject]@{ Label = 'npm test'; Pattern = '(?im)^\s*(?:run:\s*)?npm\s+test(?:\s|$)' },
  [pscustomobject]@{ Label = 'npm test script'; Pattern = '(?im)^\s*(?:run:\s*)?npm\s+run\s+test(?::[^\s]+)?(?:\s|$)' },
  [pscustomobject]@{ Label = 'lint script'; Pattern = '(?im)^\s*(?:run:\s*)?npm\s+run\s+lint(?::[^\s]+)?(?:\s|$)' },
  [pscustomobject]@{ Label = 'typecheck script'; Pattern = '(?im)^\s*(?:run:\s*)?npm\s+run\s+typecheck(?:\s|$)' },
  [pscustomobject]@{ Label = 'documentation check'; Pattern = '(?i)docs:bundle:check' },
  [pscustomobject]@{ Label = 'site check'; Pattern = '(?i)(?:node\s+site/check\.mjs|npm\s+run\s+check(?:\s|$))' },
  [pscustomobject]@{ Label = 'standalone quality tool'; Pattern = '(?i)\b(?:eslint|vitest|jest|pytest|actionlint|shellcheck|tsc\s+--noEmit|c8|nyc)\b' },
  [pscustomobject]@{ Label = 'quality-check step name'; Pattern = '(?im)^\s*-\s+name:\s*(?:test|lint|typecheck|static analysis|coverage|accessibility|screenshot)\b' },
  [pscustomobject]@{ Label = 'removed quality dependency'; Pattern = '(?im)^\s*needs:\s*(?:\[[^\]]*\b(?:verify|test|lint|typecheck)\b[^\]]*\]|(?:verify|test|lint|typecheck)\b)' }
)
foreach ($entry in $workflowTexts.GetEnumerator()) {
  foreach ($forbidden in $forbiddenQualityCommands) {
    if ([string]$entry.Value -match [string]$forbidden.Pattern) {
      Stop-WithMessage "Workflow $($entry.Key) contains forbidden GitHub Actions quality check '$($forbidden.Label)'."
    }
  }
}

$releaseWorkflow = [string]$workflowTexts['stable-release']
foreach ($requiredReleaseMarker in @(
    'Build application',
    'scripts/bootstrap-actions-tools.ps1',
    'verify-self-hosted-bootstrap.ps1 -Phase preinstall',
    'verify-self-hosted-bootstrap.ps1 -Phase postinstall',
    'npm run build:renderer',
    'npm run build:electron',
    'scripts/build-unsigned-squirrel.ps1',
    'scripts/validate-squirrel-artifacts.ps1',
    '-OwnedOutputRoot $env:RUNNER_TEMP',
    'scripts/package-extension.ps1',
    'scripts/publish-stable-release.ps1',
    'Collect safe release evidence',
    'actions/upload-artifact@v4',
    'if: ${{ always() }}'
  )) {
  if ($releaseWorkflow.IndexOf($requiredReleaseMarker, [System.StringComparison]::Ordinal) -lt 0) {
    Stop-WithMessage "The stable-release workflow is missing required build, package, publication, or evidence marker '$requiredReleaseMarker'."
  }
}

$pagesWorkflow = [string]$workflowTexts['pages']
foreach ($requiredPagesMarker in @(
    'workflow_run:',
    'Stable Windows release',
    'scripts/bootstrap-actions-tools.ps1',
    'node site/build.mjs "$env:PAGES_STAGING_PATH" --package-only',
    'verify-self-hosted-bootstrap.ps1 -Phase preinstall',
    'scripts/prepare-pages-release-manifest.ps1',
    '-ExpectedSourceCommit',
    'actions/deploy-pages@v4',
    'Verify the published Pages response',
    'Collect safe Pages evidence',
    'actions/upload-artifact@v4',
    'if: ${{ always() }}'
  )) {
  if ($pagesWorkflow.IndexOf($requiredPagesMarker, [System.StringComparison]::Ordinal) -lt 0) {
    Stop-WithMessage "The Pages workflow is missing required build, deployment, publication proof, or evidence marker '$requiredPagesMarker'."
  }
}
if ($pagesWorkflow -match '(?ms)^on:\s*\r?\n\s+push:') {
  Stop-WithMessage 'The Pages workflow must deploy after the stable release workflow, not race it on push.'
}

  Write-Output "Static workflow contract verified for ${runnerImage}: build, package, publish, and safe evidence only."
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
$lock = Get-JsonFile $lockPath -AllowEmptyPropertyName
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
