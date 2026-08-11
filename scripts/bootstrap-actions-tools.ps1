[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Stop-WithMessage([string]$Message) {
  throw "GitHub Actions tool bootstrap failed: $Message"
}

if ($env:RUNNER_OS -and $env:RUNNER_OS -ne 'Windows') {
  Stop-WithMessage "RUNNER_OS is '$($env:RUNNER_OS)', expected Windows."
}

$ownedRoot = if ([string]::IsNullOrWhiteSpace($env:RUNNER_TEMP)) {
  Join-Path ([System.IO.Path]::GetTempPath()) 'material-download-manager-actions-toolchain'
} else {
  Join-Path $env:RUNNER_TEMP 'material-download-manager-actions-toolchain'
}
$ownedRoot = [System.IO.Path]::GetFullPath($ownedRoot)
$ownedParent = [System.IO.Path]::GetFullPath((Split-Path -Parent $ownedRoot)).TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar)
if (-not $ownedRoot.StartsWith("$ownedParent$([System.IO.Path]::DirectorySeparatorChar)", [System.StringComparison]::OrdinalIgnoreCase) -or
    $ownedRoot.Equals([System.IO.Path]::GetPathRoot($ownedRoot), [System.StringComparison]::OrdinalIgnoreCase)) {
  Stop-WithMessage 'The portable toolchain path is not a strict owned child.'
}
New-Item -ItemType Directory -Path $ownedRoot -Force | Out-Null

function Add-ToolPath([string]$Directory) {
  if (-not (Test-Path -LiteralPath $Directory -PathType Container)) {
    Stop-WithMessage "A bootstrapped tool directory is missing: $Directory"
  }
  $env:PATH = "$Directory;$env:PATH"
  if (-not [string]::IsNullOrWhiteSpace($env:GITHUB_PATH)) {
    $Directory | Out-File -LiteralPath $env:GITHUB_PATH -Append -Encoding utf8
  }
}

function Install-ReleaseArchive([string]$Repository, [string]$AssetPattern, [string]$Destination, [string]$Label) {
  $release = Invoke-RestMethod -UseBasicParsing -Headers @{ 'User-Agent' = 'material-download-manager-actions-bootstrap' } -Uri "https://api.github.com/repos/$Repository/releases/latest" -TimeoutSec 30
  $asset = @($release.assets) | Where-Object { [string]$_.name -match $AssetPattern } | Select-Object -First 1
  if ($null -eq $asset -or [string]$asset.browser_download_url -notmatch '^https://github\.com/' -or [string]$asset.digest -notmatch '^sha256:[a-f0-9]{64}$') {
    Stop-WithMessage "$Label has no canonical Windows archive with a GitHub SHA-256 digest."
  }
  $archivePath = Join-Path $ownedRoot "$Label-$([guid]::NewGuid().ToString('N')).zip"
  try {
    Invoke-WebRequest -UseBasicParsing -Headers @{ 'User-Agent' = 'material-download-manager-actions-bootstrap' } -Uri ([string]$asset.browser_download_url) -OutFile $archivePath -TimeoutSec 120
    $actualDigest = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualDigest -ne ([string]$asset.digest).Substring(7)) {
      Stop-WithMessage "$Label archive SHA-256 differs from its canonical release digest."
    }
    if (Test-Path -LiteralPath $Destination) {
      $destinationFull = [System.IO.Path]::GetFullPath($Destination)
      if (-not $destinationFull.StartsWith("$ownedRoot$([System.IO.Path]::DirectorySeparatorChar)", [System.StringComparison]::OrdinalIgnoreCase)) {
        Stop-WithMessage "$Label destination escaped the owned toolchain root."
      }
      $destinationItem = Get-Item -LiteralPath $destinationFull -Force
      if (($destinationItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
        Stop-WithMessage "$Label destination is a reparse point."
      }
      Remove-Item -LiteralPath $destinationFull -Recurse -Force
    }
    Expand-Archive -LiteralPath $archivePath -DestinationPath $Destination -Force
  } finally {
    Remove-Item -LiteralPath $archivePath -Force -ErrorAction SilentlyContinue
  }
}

$git = Get-Command git.exe -ErrorAction SilentlyContinue
$tar = Get-Command tar.exe -ErrorAction SilentlyContinue
if ($null -ne $git -and $null -eq $tar) {
  $gitRoot = Split-Path -Parent (Split-Path -Parent $git.Source)
  $gitTarDirectory = Join-Path $gitRoot 'usr/bin'
  if (Test-Path -LiteralPath (Join-Path $gitTarDirectory 'tar.exe') -PathType Leaf) {
    Add-ToolPath $gitTarDirectory
    $tar = Get-Command tar.exe -ErrorAction SilentlyContinue
  }
}
if ($null -eq $git -or $null -eq $tar) {
  $gitDestination = Join-Path $ownedRoot 'mingit'
  Install-ReleaseArchive 'git-for-windows/git' '^MinGit-.*-64-bit\.zip$' $gitDestination 'mingit'
  Add-ToolPath (Join-Path $gitDestination 'cmd')
  Add-ToolPath (Join-Path $gitDestination 'usr/bin')
}

if ($null -eq (Get-Command gh.exe -ErrorAction SilentlyContinue)) {
  $ghDestination = Join-Path $ownedRoot 'github-cli'
  Install-ReleaseArchive 'cli/cli' '^gh_.*_windows_amd64\.zip$' $ghDestination 'github-cli'
  $ghExecutable = Get-ChildItem -LiteralPath $ghDestination -Recurse -File -Filter 'gh.exe' | Select-Object -First 1
  if ($null -eq $ghExecutable) { Stop-WithMessage 'The GitHub CLI archive contains no gh.exe.' }
  Add-ToolPath $ghExecutable.DirectoryName
}

foreach ($command in @('git.exe', 'gh.exe', 'node.exe', 'npm.cmd', 'pwsh.exe', 'tar.exe')) {
  if ($null -eq (Get-Command $command -ErrorAction SilentlyContinue)) {
    Stop-WithMessage "Required command is still unavailable after bootstrap: $command"
  }
}

Write-Output "GitHub Actions tool bootstrap passed: git, gh, Node.js, npm, PowerShell, and tar are available."
