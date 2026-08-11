[CmdletBinding()]
param(
  [ValidateSet('Build', 'Installer', 'Verify')]
  [string]$Mode = 'Build',
  [switch]$Silent,
  [string]$RepositoryRoot = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Windows PowerShell can inherit the PowerShell 7 module path from a developer
# shell.  Loading the PowerShell 7 security module into the 5.1 process makes
# Get-AuthenticodeSignature fail before the unsigned-artifact check runs.  Keep
# this process self-contained and load the matching inbox module explicitly.
if ($PSVersionTable.PSEdition -eq 'Desktop') {
  $desktopModules = Join-Path $PSHOME 'Modules'
  $env:PSModulePath = $desktopModules
  Import-Module (Join-Path $desktopModules 'Microsoft.PowerShell.Security') -Force -ErrorAction Stop
}

if ($env:SILENT -eq '1' -or $env:MDM_BUILD_SILENT -eq '1') {
  $Silent = $true
}

$script:RepositoryRoot = if ([string]::IsNullOrWhiteSpace($RepositoryRoot)) {
  [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
} else {
  [System.IO.Path]::GetFullPath($RepositoryRoot)
}
$script:ToolchainRoot = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Material Download Manager\toolchain'
$script:PreferredNodeVersion = '22.16.0'
$script:NodeArchiveName = "node-v$($script:PreferredNodeVersion)-win-x64.zip"
$script:NodeDirectoryName = "node-v$($script:PreferredNodeVersion)-win-x64"
$script:NodePath = $null
$script:GitPath = $null
$script:DependencyPlan = $null

function Stop-WithMessage([string]$Message) {
  throw "Build contract failed: $Message"
}

function Write-Phase([string]$Message) {
  $stamp = [DateTimeOffset]::Now.ToString('yyyy-MM-dd HH:mm:ss zzz')
  Write-Host "[$stamp] $Message"
}

function Read-JsonCompat([string]$Path, [string]$Label, [switch]$AllowEmptyPropertyName) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    Stop-WithMessage "$Label is missing: $Path"
  }
  try {
    $text = Get-Content -LiteralPath $Path -Raw
    $converter = Get-Command ConvertFrom-Json
    if ($AllowEmptyPropertyName -and $converter.Parameters.ContainsKey('AsHashtable')) {
      return ($text | ConvertFrom-Json -AsHashtable)
    }
    return ($text | ConvertFrom-Json)
  } catch {
    Stop-WithMessage "$Label is malformed JSON: $Path"
  }
}

function Write-Utf8NoBom([string]$Path, [string]$Text) {
  [System.IO.File]::WriteAllText($Path, $Text, [System.Text.UTF8Encoding]::new($false))
}

function Get-Sha256([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    Stop-WithMessage "Cannot hash a missing file: $Path"
  }
  $hashCommand = Get-Command Get-FileHash -ErrorAction SilentlyContinue
  if ($null -ne $hashCommand) {
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
  }
  $stream = [System.IO.File]::OpenRead($Path)
  $algorithm = [System.Security.Cryptography.SHA256]::Create()
  try {
    return ([BitConverter]::ToString($algorithm.ComputeHash($stream)).Replace('-', '')).ToLowerInvariant()
  } finally {
    $algorithm.Dispose()
    $stream.Dispose()
  }
}

function Get-CommandPath([string]$Name) {
  $command = Get-Command $Name -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($null -eq $command) { return $null }
  if ($command.PSObject.Properties.Name -contains 'Source' -and -not [string]::IsNullOrWhiteSpace([string]$command.Source)) {
    return [string]$command.Source
  }
  if ($command.PSObject.Properties.Name -contains 'Path' -and -not [string]::IsNullOrWhiteSpace([string]$command.Path)) {
    return [string]$command.Path
  }
  return [string]$command.Definition
}

function Refresh-ProcessPath {
  $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  $machinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
  $parts = @($userPath, $machinePath, $env:Path) |
    Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) } |
    ForEach-Object { [string]$_ -split ';' } |
    Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
    Select-Object -Unique
  $env:Path = $parts -join ';'
}

function Add-ProcessPath([string]$Directory, [string]$Label) {
  if (-not (Test-Path -LiteralPath $Directory -PathType Container)) {
    Stop-WithMessage "$Label directory is missing: $Directory"
  }
  $full = [System.IO.Path]::GetFullPath($Directory)
  if (-not ($env:Path -split ';' | Where-Object { $_.TrimEnd('\') -ieq $full.TrimEnd('\') })) {
    $env:Path = "$full;$env:Path"
  }
}

function Assert-OwnedPath([string]$Path, [string]$Parent, [string]$Label) {
  $fullPath = [System.IO.Path]::GetFullPath($Path)
  $fullParent = [System.IO.Path]::GetFullPath($Parent).TrimEnd('\', '/')
  if ($fullPath.Equals($fullParent, [System.StringComparison]::OrdinalIgnoreCase) -or
      -not $fullPath.StartsWith("$fullParent\", [System.StringComparison]::OrdinalIgnoreCase)) {
    Stop-WithMessage "$Label escaped its owned directory: $fullPath"
  }
  if (Test-Path -LiteralPath $fullPath) {
    $item = Get-Item -LiteralPath $fullPath -Force
    if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
      Stop-WithMessage "$Label is a reparse point: $fullPath"
    }
  }
  return $fullPath
}

function Invoke-Download([string]$Uri, [string]$Destination, [string]$Label) {
  Write-Phase "Downloading $Label from the canonical source."
  try {
    Invoke-WebRequest -UseBasicParsing -Headers @{ 'User-Agent' = 'material-download-manager-build' } -Uri $Uri -OutFile $Destination -TimeoutSec 180
  } catch {
    Stop-WithMessage "$Label download failed from ${Uri}: $($_.Exception.Message)"
  }
  if (-not (Test-Path -LiteralPath $Destination -PathType Leaf)) {
    Stop-WithMessage "$Label download produced no file: $Destination"
  }
  if ((Get-Item -LiteralPath $Destination).Length -le 0) {
    Stop-WithMessage "$Label download was empty: $Destination"
  }
}

function Try-WingetInstall([string]$PackageId, [string]$Label) {
  $winget = Get-CommandPath 'winget.exe'
  if ($null -eq $winget) {
    Write-Host "[bootstrap] winget is unavailable; using the portable $Label fallback."
    return $false
  }
  Write-Phase "Installing $Label user-scoped through winget."
  & $winget install --id $PackageId --exact --scope user --silent --accept-source-agreements --accept-package-agreements --disable-interactivity
  $exitCode = $LASTEXITCODE
  Refresh-ProcessPath
  if ($exitCode -ne 0) {
    Write-Host "[bootstrap] winget refused $Label with exit code $exitCode; using its portable fallback."
    return $false
  }
  return $true
}

function Install-PortableNode {
  $toolRoot = Assert-OwnedPath $script:ToolchainRoot ([Environment]::GetFolderPath('LocalApplicationData')) 'toolchain root'
  New-Item -ItemType Directory -Path $toolRoot -Force | Out-Null
  $destination = Assert-OwnedPath (Join-Path $toolRoot $script:NodeDirectoryName) $toolRoot 'Node destination'
  $nodeExecutable = Join-Path $destination 'node.exe'
  if (Test-Path -LiteralPath $nodeExecutable -PathType Leaf) {
    Add-ProcessPath $destination 'Node'
    return $nodeExecutable
  }

  $staging = Assert-OwnedPath (Join-Path $toolRoot ('.node-staging-' + [guid]::NewGuid().ToString('N'))) $toolRoot 'Node staging'
  $archivePath = Assert-OwnedPath (Join-Path $toolRoot $script:NodeArchiveName) $toolRoot 'Node archive'
  $checksumsPath = Assert-OwnedPath (Join-Path $toolRoot 'SHASUMS256.txt') $toolRoot 'Node checksum list'
  $baseUri = "https://nodejs.org/dist/v$($script:PreferredNodeVersion)/"
  try {
    Invoke-Download ($baseUri + $script:NodeArchiveName) $archivePath 'Node.js portable runtime'
    Invoke-Download ($baseUri + 'SHASUMS256.txt') $checksumsPath 'Node.js checksum list'
    $checksumLine = Get-Content -LiteralPath $checksumsPath | Where-Object { $_ -match "(?i)\s+$([regex]::Escape($script:NodeArchiveName))$" } | Select-Object -First 1
    if ($null -eq $checksumLine -or $checksumLine -notmatch '^(?<hash>[a-f0-9]{64})\s+') {
      Stop-WithMessage "Node.js checksum list did not contain $($script:NodeArchiveName)."
    }
    $expectedHash = $Matches.hash.ToLowerInvariant()
    $actualHash = Get-Sha256 $archivePath
    if ($actualHash -ne $expectedHash) {
      Stop-WithMessage "Node.js portable archive SHA-256 mismatch (expected $expectedHash, got $actualHash)."
    }
    New-Item -ItemType Directory -Path $staging -Force | Out-Null
    Expand-Archive -LiteralPath $archivePath -DestinationPath $staging -Force
    $extracted = Join-Path $staging $script:NodeDirectoryName
    if (-not (Test-Path -LiteralPath (Join-Path $extracted 'node.exe') -PathType Leaf)) {
      Stop-WithMessage 'Node.js portable archive did not contain the expected node.exe.'
    }
    if (Test-Path -LiteralPath $destination) {
      Remove-Item -LiteralPath $destination -Recurse -Force
    }
    Move-Item -LiteralPath $extracted -Destination $destination
  } finally {
    Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $archivePath -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $checksumsPath -Force -ErrorAction SilentlyContinue
  }
  Add-ProcessPath $destination 'Node'
  return (Join-Path $destination 'node.exe')
}

function Install-PortableGit {
  $toolRoot = Assert-OwnedPath $script:ToolchainRoot ([Environment]::GetFolderPath('LocalApplicationData')) 'toolchain root'
  New-Item -ItemType Directory -Path $toolRoot -Force | Out-Null
  $destination = Assert-OwnedPath (Join-Path $toolRoot 'mingit') $toolRoot 'Git destination'
  $gitExecutable = Join-Path $destination 'cmd\git.exe'
  if (Test-Path -LiteralPath $gitExecutable -PathType Leaf) {
    Add-ProcessPath (Join-Path $destination 'cmd') 'Git'
    return $gitExecutable
  }

  Write-Phase 'Resolving the current MinGit x64 archive from the canonical Git for Windows release.'
  try {
    $release = Invoke-RestMethod -UseBasicParsing -Headers @{ 'User-Agent' = 'material-download-manager-build' } -Uri 'https://api.github.com/repos/git-for-windows/git/releases/latest' -TimeoutSec 30
  } catch {
    Stop-WithMessage "Git portable release lookup failed at the canonical Git for Windows API: $($_.Exception.Message)"
  }
  $asset = @($release.assets) | Where-Object { [string]$_.name -match '^MinGit-.*-64-bit\.zip$' } | Select-Object -First 1
  if ($null -eq $asset -or [string]$asset.browser_download_url -notmatch '^https://github\.com/git-for-windows/git/releases/download/') {
    Stop-WithMessage 'The canonical Git for Windows release did not expose a MinGit x64 archive.'
  }
  $staging = Assert-OwnedPath (Join-Path $toolRoot ('.git-staging-' + [guid]::NewGuid().ToString('N'))) $toolRoot 'Git staging'
  $archivePath = Assert-OwnedPath (Join-Path $toolRoot ([string]$asset.name)) $toolRoot 'Git archive'
  try {
    Invoke-Download ([string]$asset.browser_download_url) $archivePath 'MinGit x64 runtime'
    New-Item -ItemType Directory -Path $staging -Force | Out-Null
    Expand-Archive -LiteralPath $archivePath -DestinationPath $staging -Force
    $candidate = Get-ChildItem -LiteralPath $staging -Recurse -File -Filter 'git.exe' | Where-Object { $_.FullName -match '\\cmd\\git\.exe$' } | Select-Object -First 1
    if ($null -eq $candidate) {
      Stop-WithMessage 'The canonical MinGit archive did not contain cmd\git.exe.'
    }
    $extractedRoot = $candidate.FullName.Substring(0, $candidate.FullName.Length - '\cmd\git.exe'.Length)
    if (Test-Path -LiteralPath $destination) {
      Remove-Item -LiteralPath $destination -Recurse -Force
    }
    Move-Item -LiteralPath $extractedRoot -Destination $destination
  } finally {
    Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $archivePath -Force -ErrorAction SilentlyContinue
  }
  Add-ProcessPath (Join-Path $destination 'cmd') 'Git'
  return (Join-Path $destination 'cmd\git.exe')
}

function Read-DependencyPlan {
  $packagePath = Join-Path $script:RepositoryRoot 'design/package.json'
  $lockPath = Join-Path $script:RepositoryRoot 'design/package-lock.json'
  $package = Read-JsonCompat $packagePath 'design/package.json'
  if (-not (Test-Path -LiteralPath $lockPath -PathType Leaf)) {
    Stop-WithMessage "design/package-lock.json is missing: $lockPath"
  }
  $lockText = Get-Content -LiteralPath $lockPath -Raw
  if ($lockText -notmatch '"lockfileVersion"\s*:\s*(?<version>\d+)') {
    Stop-WithMessage 'design/package-lock.json does not declare lockfileVersion.'
  }
  $lockfileVersion = [int]$Matches.version
  if ([int]$lockfileVersion -ne 3) {
    Stop-WithMessage "design/package-lock.json lockfileVersion is $lockfileVersion; this build requires lockfileVersion 3."
  }
  $engine = [string]$package.engines.node
  if ($engine -notmatch '(?i)(?:>=\s*)?(?<major>\d+)\.(?<minor>\d+)\.(?<patch>\d+)') {
    Stop-WithMessage 'design/package.json must declare a concrete Node.js engine constraint.'
  }
  $minimumNode = [version]::new([int]$Matches.major, [int]$Matches.minor, [int]$Matches.patch)
  if ($minimumNode -gt [version]::new(22, 16, 0)) {
    Stop-WithMessage "The declared Node.js engine $engine is newer than the pinned bootstrap $($script:PreferredNodeVersion)."
  }
  if ([string]$package.name -ne 'material-download-manager') {
    Stop-WithMessage "Unexpected design package name: $($package.name)"
  }
  if ($null -eq $package.scripts.build -or $null -eq $package.scripts.'dist:win') {
    Stop-WithMessage 'design/package.json must expose build and dist:win scripts.'
  }
  $script:DependencyPlan = [ordered]@{
    packageManifest = $packagePath
    lockfile = $lockPath
    nodeEngine = $engine
    preferredNode = $script:PreferredNodeVersion
    packageManager = 'npm bundled with the pinned Node.js runtime'
    appBuild = 'npm run build'
    installerBuild = 'scripts/build-unsigned-squirrel.ps1 -> electron-builder --win squirrel --x64 --publish never'
    signing = 'forceCodeSigning=false; signAndEditExecutable=false; Setup.exe must be NotSigned'
  }
  return $package
}

function Ensure-Node {
  $candidate = Get-CommandPath 'node.exe'
  if ($null -ne $candidate) {
    $versionText = (& $candidate --version 2>&1 | Out-String).Trim()
    if ($LASTEXITCODE -eq 0 -and $versionText -match '^v22\.') {
      $script:NodePath = $candidate
      Write-Host "[bootstrap] Reusing Node.js $versionText from $candidate."
      return
    }
    Write-Host "[bootstrap] Existing Node.js '$versionText' is not the pinned 22.x toolchain; adding an isolated runtime."
  }
  [void](Try-WingetInstall 'OpenJS.NodeJS.LTS' 'Node.js')
  Refresh-ProcessPath
  $candidate = Get-CommandPath 'node.exe'
  if ($null -ne $candidate) {
    $versionText = (& $candidate --version 2>&1 | Out-String).Trim()
    if ($LASTEXITCODE -eq 0 -and $versionText -match '^v22\.') {
      $script:NodePath = $candidate
      Write-Host "[bootstrap] Node.js $versionText is now available after winget."
      return
    }
  }
  $script:NodePath = Install-PortableNode
  $versionText = (& $script:NodePath --version 2>&1 | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $versionText -notmatch '^v22\.') {
    Stop-WithMessage "The pinned Node.js runtime is unavailable after winget and portable fallback: $versionText"
  }
  Write-Host "[bootstrap] Installed isolated Node.js $versionText under the user toolchain."
}

function Ensure-Git {
  $candidate = Get-CommandPath 'git.exe'
  if ($null -eq $candidate) {
    [void](Try-WingetInstall 'Git.Git' 'Git')
    Refresh-ProcessPath
    $candidate = Get-CommandPath 'git.exe'
  }
  if ($null -eq $candidate) {
    $candidate = Install-PortableGit
  }
  $versionText = (& $candidate --version 2>&1 | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $versionText -notmatch '^git version ') {
    Stop-WithMessage "Git is unavailable after canonical bootstrap attempts: $versionText"
  }
  $script:GitPath = $candidate
  Write-Host "[bootstrap] Reusing Git from $candidate ($versionText)."
}

function Invoke-CommandChecked([string]$Command, [string[]]$Arguments, [string]$WorkingDirectory, [string]$Label) {
  Write-Phase $Label
  $logPath = Join-Path ([System.IO.Path]::GetTempPath()) ('mdm-build-command-' + [guid]::NewGuid().ToString('N') + '.log')
  Push-Location $WorkingDirectory
  $savedErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    & $Command @Arguments > $logPath 2>&1
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $savedErrorActionPreference
    Pop-Location
  }
  if (Test-Path -LiteralPath $logPath -PathType Leaf) {
    Get-Content -LiteralPath $logPath | ForEach-Object { Write-Host $_ }
    Remove-Item -LiteralPath $logPath -Force -ErrorAction SilentlyContinue
  }
  if ($exitCode -ne 0) {
    Stop-WithMessage "$Label failed with exit code $exitCode."
  }
}

function Ensure-NativeBinaries([string]$DesignRoot) {
  $electronInstall = Join-Path $DesignRoot 'node_modules/electron/install.js'
  $esbuildInstall = Join-Path $DesignRoot 'node_modules/esbuild/install.js'
  $electronBinary = Join-Path $DesignRoot 'node_modules/electron/dist/electron.exe'
  $esbuildBinary = Join-Path $DesignRoot 'node_modules/@esbuild/win32-x64/esbuild.exe'
  if (-not (Test-Path -LiteralPath $electronInstall -PathType Leaf) -or -not (Test-Path -LiteralPath $esbuildInstall -PathType Leaf)) {
    Stop-WithMessage 'npm ci did not install the Electron and esbuild bootstrap scripts declared by the lockfile.'
  }
  if (-not (Test-Path -LiteralPath $electronBinary -PathType Leaf)) {
    Invoke-CommandChecked 'node.exe' @('node_modules/electron/install.js') $DesignRoot 'Complete the Electron native binary bootstrap'
  }
  if (-not (Test-Path -LiteralPath $esbuildBinary -PathType Leaf)) {
    Invoke-CommandChecked 'node.exe' @('node_modules/esbuild/install.js') $DesignRoot 'Complete the esbuild native binary bootstrap'
  }
  if (-not (Test-Path -LiteralPath $electronBinary -PathType Leaf)) {
    Stop-WithMessage "Electron native binary is missing after bootstrap: $electronBinary"
  }
  if (-not (Test-Path -LiteralPath $esbuildBinary -PathType Leaf)) {
    Stop-WithMessage "esbuild native binary is missing after bootstrap: $esbuildBinary"
  }
}

function Clear-BoundedBuildDirectory([string]$DesignRoot, [string]$Name) {
  $designFull = [System.IO.Path]::GetFullPath($DesignRoot).TrimEnd('\', '/')
  $target = [System.IO.Path]::GetFullPath((Join-Path $designFull $Name))
  if ($target.Equals($designFull, [System.StringComparison]::OrdinalIgnoreCase) -or
      -not $target.StartsWith("$designFull\", [System.StringComparison]::OrdinalIgnoreCase)) {
    Stop-WithMessage "The bounded build directory escaped design/: $target"
  }
  if (Test-Path -LiteralPath $target) {
    $item = Get-Item -LiteralPath $target -Force
    if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
      Stop-WithMessage "The bounded build directory is a reparse point: $target"
    }
    Remove-Item -LiteralPath $target -Recurse -Force
  }
  New-Item -ItemType Directory -Path $target -Force | Out-Null
}

function Get-SourceCommit {
  $value = (& $script:GitPath rev-parse HEAD 2>&1 | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $value -notmatch '^[0-9a-f]{40}$') {
    Stop-WithMessage "Could not resolve the current source commit with Git: $value"
  }
  return $value
}

function Get-WorkingTreeMarker {
  return ((& $script:GitPath status --porcelain=v1 2>&1 | Out-String).Trim())
}

function Invoke-AppBuild([switch]$ForInstaller) {
  $designRoot = Join-Path $script:RepositoryRoot 'design'
  Ensure-Node
  Ensure-Git
  $package = Read-DependencyPlan
  $beforePackageHash = Get-Sha256 $script:DependencyPlan.packageManifest
  $beforeLockHash = Get-Sha256 $script:DependencyPlan.lockfile
  $beforeCommit = Get-SourceCommit
  $beforeTree = Get-WorkingTreeMarker
  if (-not (Test-Path -LiteralPath (Join-Path $designRoot 'node_modules') -PathType Container)) {
    Write-Phase 'Installing the locked project dependencies with npm ci (no audit, no funding, no global install).'
    Invoke-CommandChecked 'npm.cmd' @('ci', '--no-audit', '--no-fund') $designRoot 'Install the locked project dependencies'
  } else {
    Write-Host '[bootstrap] Reusing the existing design/node_modules directory; npm ci will repair partial installs when the lockfile changes.'
    Invoke-CommandChecked 'npm.cmd' @('ci', '--no-audit', '--no-fund') $designRoot 'Verify and repair the locked project dependencies'
  }
  Ensure-NativeBinaries $designRoot
  Clear-BoundedBuildDirectory $designRoot 'dist'
  Clear-BoundedBuildDirectory $designRoot 'dist-electron'
  Invoke-CommandChecked 'npm.cmd' @('run', 'build') $designRoot 'Build the renderer and main process from the supported project path'
  $requiredOutputs = @(
    (Join-Path $designRoot 'dist/index.html'),
    (Join-Path $designRoot 'dist-electron/electron/main.js'),
    (Join-Path $designRoot 'node_modules/electron/dist/electron.exe'),
    (Join-Path $designRoot 'node_modules/@esbuild/win32-x64/esbuild.exe')
  )
  foreach ($output in $requiredOutputs) {
    if (-not (Test-Path -LiteralPath $output -PathType Leaf) -or (Get-Item -LiteralPath $output).Length -le 0) {
      Stop-WithMessage "The supported build produced no non-empty output: $output"
    }
  }
  $afterPackageHash = Get-Sha256 $script:DependencyPlan.packageManifest
  $afterLockHash = Get-Sha256 $script:DependencyPlan.lockfile
  $afterCommit = Get-SourceCommit
  $afterTree = Get-WorkingTreeMarker
  if ($beforePackageHash -ne $afterPackageHash -or $beforeLockHash -ne $afterLockHash) {
    Stop-WithMessage 'The supported build changed design/package.json or design/package-lock.json.'
  }
  if ($beforeCommit -ne $afterCommit) {
    Stop-WithMessage "The source commit changed during the build ($beforeCommit -> $afterCommit)."
  }
  if ($beforeTree -ne $afterTree) {
    Stop-WithMessage 'The supported build changed tracked source files; refusing to claim a current-commit artifact.'
  }
  Write-Host "[build] Verified current source commit $afterCommit and fresh renderer/main-process outputs."
  if (-not $Silent) {
    $answer = Read-Host 'Build completed. Run the built app now? [y/N]'
    if ($answer -match '^(?i)y(?:es)?$') {
      Write-Phase 'Launching the built app from the verified local output.'
      Start-Process -FilePath (Join-Path $designRoot 'node_modules/electron/dist/electron.exe') -ArgumentList '.' -WorkingDirectory $designRoot | Out-Null
    }
  }
  return [pscustomobject]@{ Package = $package; SourceCommit = $afterCommit; DesignRoot = $designRoot }
}

function Invoke-InstallerBuild {
  $build = Invoke-AppBuild -ForInstaller
  $packageVersion = [string]$build.Package.version
  if ($packageVersion -notmatch '^\d+\.\d+\.\d+$') {
    Stop-WithMessage "design/package.json version is not strict semantic version syntax: $packageVersion"
  }
  $helper = Join-Path $script:RepositoryRoot 'scripts/build-unsigned-squirrel.ps1'
  if (-not (Test-Path -LiteralPath $helper -PathType Leaf)) {
    Stop-WithMessage "The supported unsigned Squirrel helper is missing: $helper"
  }
  Invoke-CommandChecked 'powershell.exe' @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $helper, '-Version', $packageVersion) $script:RepositoryRoot 'Build the unsigned Squirrel.Windows installer through the supported path'
  $artifactRoot = Join-Path $script:RepositoryRoot 'design/release/squirrel-windows'
  if (-not (Test-Path -LiteralPath $artifactRoot -PathType Container)) {
    Stop-WithMessage "The supported Squirrel.Windows output directory is missing: $artifactRoot"
  }
  $validationRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('mdm-installer-validation-' + [guid]::NewGuid().ToString('N'))
  $validatedAssets = Join-Path $validationRoot 'assets'
  $validatedManifest = Join-Path $validationRoot 'manifest.json'
  New-Item -ItemType Directory -Path $validationRoot -Force | Out-Null
  try {
    $validator = Join-Path $script:RepositoryRoot 'scripts/validate-squirrel-artifacts.ps1'
    if (-not (Test-Path -LiteralPath $validator -PathType Leaf)) {
      Stop-WithMessage "The committed Squirrel.Windows validator is missing: $validator"
    }
    Invoke-CommandChecked 'powershell.exe' @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $validator, '-SourceRoot', $artifactRoot, '-OutputDirectory', $validatedAssets, '-ManifestPath', $validatedManifest, '-OwnedOutputRoot', $validationRoot) $script:RepositoryRoot 'Validate the Squirrel.Windows output and unsigned artifact manifest'
  } finally {
    Remove-Item -LiteralPath $validationRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
  # electron-builder names the source setup with the product and version
  # (for example, Product-Setup-1.2.3.exe); the validator deliberately
  # normalizes that one file to Setup.exe in its bounded staging directory.
  $setup = @(Get-ChildItem -LiteralPath $artifactRoot -File | Where-Object { $_.Extension -ieq '.exe' -and $_.BaseName -match '(?i)setup' })
  $releaseIndex = @(Get-ChildItem -LiteralPath $artifactRoot -File | Where-Object { $_.Name -ieq 'RELEASES' })
  $fullPackages = @(Get-ChildItem -LiteralPath $artifactRoot -File -Filter '*-full.nupkg')
  if ($setup.Count -ne 1 -or $releaseIndex.Count -ne 1 -or $fullPackages.Count -lt 1) {
    Stop-WithMessage "Squirrel.Windows output must contain exactly one Setup.exe, one RELEASES, and at least one full .nupkg (found setup=$($setup.Count), RELEASES=$($releaseIndex.Count), full=$($fullPackages.Count))."
  }
  $forbidden = @(Get-ChildItem -LiteralPath $artifactRoot -Recurse -File | Where-Object { $_.Name -match '(?i)\.(?:pem|key|pfx|p12|cer|crt|der|jks|keystore|pk8|crx|crx3)$' })
  if ($forbidden.Count -gt 0) {
    Stop-WithMessage "Installer output contains forbidden signing or CRX material: $($forbidden[0].Name)"
  }
  $signature = Get-AuthenticodeSignature -LiteralPath $setup[0].FullName
  if ([string]$signature.Status -ne 'NotSigned') {
    Stop-WithMessage "Setup.exe Authenticode status is '$($signature.Status)', but this project requires NotSigned output."
  }
  foreach ($artifact in @($setup + $releaseIndex + (Get-ChildItem -LiteralPath $artifactRoot -File -Filter '*.nupkg'))) {
    if ($artifact.Length -le 0) { Stop-WithMessage "Installer artifact is empty: $($artifact.Name)" }
  }
  $provenance = [ordered]@{
    schemaVersion = 1
    sourceCommit = $build.SourceCommit
    version = $packageVersion
    unsigned = $true
    setupSignatureStatus = [string]$signature.Status
    artifacts = @((Get-ChildItem -LiteralPath $artifactRoot -File | Sort-Object Name | ForEach-Object {
      [ordered]@{ name = $_.Name; sizeBytes = [int64]$_.Length; sha256 = Get-Sha256 $_.FullName }
    }))
    builtAt = [DateTimeOffset]::UtcNow.ToString('o')
  }
  $provenancePath = Join-Path (Join-Path $script:RepositoryRoot 'design/release') 'build-provenance.json'
  Write-Utf8NoBom $provenancePath (($provenance | ConvertTo-Json -Depth 20) + [Environment]::NewLine)
  Write-Output 'Installer output is intentionally unsigned and may trigger an unknown-publisher or SmartScreen warning.'
  foreach ($artifact in @($setup + $releaseIndex + (Get-ChildItem -LiteralPath $artifactRoot -File -Filter '*.nupkg'))) {
    Write-Output "[artifact] $($artifact.FullName) | $($artifact.Length) bytes | $(Get-Sha256 $artifact.FullName)"
  }
  Write-Output "[artifact] provenance: $provenancePath"
}

function Verify-BuildContract {
  $package = Read-DependencyPlan
  $lockPath = Join-Path $script:RepositoryRoot 'design/package-lock.json'
  $lockText = Get-Content -LiteralPath $lockPath -Raw
  if ($lockText -notmatch '"lockfileVersion"\s*:\s*(?<version>\d+)') {
    Stop-WithMessage 'design/package-lock.json does not declare lockfileVersion.'
  }
  $lockfileVersion = [int]$Matches.version
  foreach ($path in @(
      (Join-Path $script:RepositoryRoot 'build.bat'),
      (Join-Path $script:RepositoryRoot 'build-installer.bat'),
      (Join-Path $script:RepositoryRoot 'scripts/build-contract.ps1'),
      (Join-Path $script:RepositoryRoot 'scripts/build-unsigned-squirrel.ps1'),
      (Join-Path $script:RepositoryRoot 'scripts/complete-node-binary-bootstrap.ps1'),
      (Join-Path $script:RepositoryRoot 'extension/manifest.json')
    )) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { Stop-WithMessage "Fresh-machine contract fixture is missing $path" }
  }
  $batchText = Get-Content -LiteralPath (Join-Path $script:RepositoryRoot 'build.bat') -Raw
  $installerBatchText = Get-Content -LiteralPath (Join-Path $script:RepositoryRoot 'build-installer.bat') -Raw
  $helperText = Get-Content -LiteralPath (Join-Path $script:RepositoryRoot 'scripts/build-contract.ps1') -Raw
  foreach ($marker in @('/s', '--silent', 'SILENT', 'build-contract.ps1', 'ExecutionPolicy Bypass')) {
    if ($batchText.IndexOf($marker, [System.StringComparison]::OrdinalIgnoreCase) -lt 0) { Stop-WithMessage "build.bat is missing $marker" }
  }
  foreach ($marker in @('/s', '--silent', 'SILENT', 'build-contract.ps1', 'ExecutionPolicy Bypass')) {
    if ($installerBatchText.IndexOf($marker, [System.StringComparison]::OrdinalIgnoreCase) -lt 0) { Stop-WithMessage "build-installer.bat is missing $marker" }
  }
  foreach ($marker in @('OpenJS.NodeJS.LTS', 'nodejs.org/dist', 'SHASUMS256.txt', 'Git.Git', 'git-for-windows/git', 'npm.cmd', 'npm ci', 'build-unsigned-squirrel.ps1', 'validate-squirrel-artifacts.ps1', '--publish never', 'NotSigned', 'forceCodeSigning', 'signAndEditExecutable')) {
    if ($helperText.IndexOf($marker, [System.StringComparison]::OrdinalIgnoreCase) -lt 0) { Stop-WithMessage "build-contract.ps1 is missing the contract marker $marker" }
  }
  $forbiddenMarkers = @(
    ('gh' + ' release'),
    ('git' + ' push'),
    ('git' + ' tag'),
    ('gh' + ' api'),
    ('Compress' + '-Archive')
  )
  foreach ($forbiddenMarker in $forbiddenMarkers) {
    if ($helperText.IndexOf($forbiddenMarker, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) { Stop-WithMessage "Build scripts contain forbidden publication/signing/archive behavior: $forbiddenMarker" }
  }
  $extensionManifest = Read-JsonCompat (Join-Path $script:RepositoryRoot 'extension/manifest.json') 'extension/manifest.json'
  if ([int]$extensionManifest.manifest_version -ne 3 -or $extensionManifest.PSObject.Properties.Name -contains 'key') { Stop-WithMessage 'The fresh-machine fixture extension manifest is not unsigned Manifest V3.' }
  Write-Output "BUILD CONTRACT: PASS (Node $($script:PreferredNodeVersion), lockfile v$lockfileVersion, unsigned Squirrel path, no publication path)"
}

try {
  Write-Phase "Starting $Mode mode (silent=$Silent)."
  if ($Mode -eq 'Verify') {
    Verify-BuildContract
    exit 0
  }
  Read-DependencyPlan | Out-Null
  if ($Mode -eq 'Installer') {
    Invoke-InstallerBuild
  } else {
    Invoke-AppBuild | Out-Null
  }
  Write-Output "BUILD RESULT: PASS ($Mode)"
  exit 0
} catch {
  Write-Error $_.Exception.Message
  exit 1
}
