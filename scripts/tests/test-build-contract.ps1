[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Stop-WithMessage([string]$Message) {
  throw "Build contract test failed: $Message"
}

function Write-Utf8NoBom([string]$Path, [string]$Text) {
  [System.IO.File]::WriteAllText($Path, $Text, [System.Text.UTF8Encoding]::new($false))
}

$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$fixtureParent = Join-Path ([System.IO.Path]::GetTempPath()) ('mdm-build-contract-test-' + [guid]::NewGuid().ToString('N'))
$fixtureRoot = Join-Path $fixtureParent 'fixture with spaces'
New-Item -ItemType Directory -Path $fixtureRoot -Force | Out-Null

try {
  foreach ($directory in @('scripts', 'scripts/tests', 'design', 'extension')) {
    New-Item -ItemType Directory -Path (Join-Path $fixtureRoot $directory) -Force | Out-Null
  }
  foreach ($file in @('build.bat', 'build-installer.bat')) {
    Copy-Item -LiteralPath (Join-Path $repositoryRoot $file) -Destination (Join-Path $fixtureRoot $file)
  }
  foreach ($file in @('build-contract.ps1', 'build-unsigned-squirrel.ps1', 'complete-node-binary-bootstrap.ps1')) {
    Copy-Item -LiteralPath (Join-Path $repositoryRoot "scripts/$file") -Destination (Join-Path $fixtureRoot "scripts/$file")
  }
  Copy-Item -LiteralPath (Join-Path $repositoryRoot 'design/package.json') -Destination (Join-Path $fixtureRoot 'design/package.json')
  Copy-Item -LiteralPath (Join-Path $repositoryRoot 'design/package-lock.json') -Destination (Join-Path $fixtureRoot 'design/package-lock.json')
  Copy-Item -LiteralPath (Join-Path $repositoryRoot 'extension/manifest.json') -Destination (Join-Path $fixtureRoot 'extension/manifest.json')

  $verifyOutput = & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File (Join-Path $fixtureRoot 'scripts/build-contract.ps1') -RepositoryRoot $fixtureRoot -Mode Verify -Silent 2>&1 | Out-String
  if ($LASTEXITCODE -ne 0 -or $verifyOutput -notmatch 'BUILD CONTRACT: PASS') {
    Stop-WithMessage "The empty fresh-machine fixture did not pass Verify mode: $verifyOutput"
  }
  Write-Output 'PASS fresh fixture reaches the first build step with no installed Node, npm, SDK, or node_modules.'

  $helpCommand = '"' + (Join-Path $fixtureRoot 'build.bat') + '" --help'
  $helpOutput = & cmd.exe /d /c $helpCommand 2>&1 | Out-String
  if ($LASTEXITCODE -ne 0 -or $helpOutput -notmatch 'Usage: build\.bat') {
    Stop-WithMessage "The build entry point did not handle an arbitrary path with spaces: $helpOutput"
  }
  Write-Output 'PASS build.bat handles an arbitrary working directory and a checkout path containing spaces.'

  $installerHelpCommand = '"' + (Join-Path $fixtureRoot 'build-installer.bat') + '" --help'
  $installerHelpOutput = & cmd.exe /d /c $installerHelpCommand 2>&1 | Out-String
  if ($LASTEXITCODE -ne 0 -or $installerHelpOutput -notmatch 'Usage: build-installer\.bat') {
    Stop-WithMessage "The installer entry point did not handle an arbitrary path with spaces: $installerHelpOutput"
  }
  Write-Output 'PASS build-installer.bat handles an arbitrary working directory and a checkout path containing spaces.'

  $unknownOutput = & cmd.exe /d /c ('"' + (Join-Path $fixtureRoot 'build.bat') + '" --not-a-mode') 2>&1 | Out-String
  if ($LASTEXITCODE -ne 2 -or $unknownOutput -notmatch 'Unknown argument') {
    Stop-WithMessage "Unknown build arguments did not fail with usage: $unknownOutput"
  }
  Write-Output 'PASS unknown arguments fail before any bootstrap or launch action.'

  $brokenBatchPath = Join-Path $fixtureRoot 'build.bat'
  $brokenBatch = Get-Content -LiteralPath $brokenBatchPath -Raw
  $brokenBatch = $brokenBatch.Replace('--silent', '--silence-removed')
  Write-Utf8NoBom $brokenBatchPath $brokenBatch
  $savedErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $brokenOutput = & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File (Join-Path $fixtureRoot 'scripts/build-contract.ps1') -RepositoryRoot $fixtureRoot -Mode Verify -Silent 2>&1 | Out-String
  } finally {
    $ErrorActionPreference = $savedErrorActionPreference
  }
  if ($LASTEXITCODE -eq 0 -or $brokenOutput -notmatch 'build\.bat is missing --silent') {
    Stop-WithMessage 'The deliberately broken silent-mode guard stayed green.'
  }
  Write-Output 'PASS deliberately removing the silent marker makes the guard red.'

  Copy-Item -LiteralPath (Join-Path $repositoryRoot 'build.bat') -Destination $brokenBatchPath -Force
  $lockPath = Join-Path $fixtureRoot 'design/package-lock.json'
  $lockText = Get-Content -LiteralPath $lockPath -Raw
  $brokenLockText = $lockText -replace '"lockfileVersion"\s*:\s*3', '"lockfileVersion": 2'
  Write-Utf8NoBom $lockPath $brokenLockText
  $savedErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $brokenLockOutput = & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File (Join-Path $fixtureRoot 'scripts/build-contract.ps1') -RepositoryRoot $fixtureRoot -Mode Verify -Silent 2>&1 | Out-String
  } finally {
    $ErrorActionPreference = $savedErrorActionPreference
  }
  if ($LASTEXITCODE -eq 0 -or $brokenLockOutput -notmatch 'lockfileVersion is 2') {
    Stop-WithMessage 'The deliberately broken lockfile guard stayed green.'
  }
  Write-Output 'PASS deliberately changing lockfileVersion makes the guard red.'

  $allScriptText = (Get-Content -LiteralPath (Join-Path $repositoryRoot 'build.bat') -Raw) + (Get-Content -LiteralPath (Join-Path $repositoryRoot 'build-installer.bat') -Raw) + (Get-Content -LiteralPath (Join-Path $repositoryRoot 'scripts/build-contract.ps1') -Raw)
  foreach ($forbidden in @('gh release', 'git push', 'git tag', 'Compress-Archive')) {
    if ($allScriptText.IndexOf($forbidden, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) {
      Stop-WithMessage "Build entry points contain forbidden publication or archive behavior: $forbidden"
    }
  }
  Write-Output 'PASS build entry points contain no release, tag, push, or archive-publishing command.'
  Write-Output 'BUILD CONTRACT TEST: PASS (fresh fixture, spaces, flags, broken guards, publication scan)'
} finally {
  if (Test-Path -LiteralPath $fixtureParent) {
    Remove-Item -LiteralPath $fixtureParent -Recurse -Force -ErrorAction SilentlyContinue
  }
}
