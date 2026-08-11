[CmdletBinding()]
param(
  [string]$SourceRoot = (Join-Path ((Resolve-Path (Join-Path $PSScriptRoot '..')).Path) 'design/release/squirrel-windows'),
  [Parameter(Mandatory = $true)]
  [string]$OutputDirectory,
  [Parameter(Mandatory = $true)]
  [string]$ManifestPath,
  [Parameter(Mandatory = $true)]
  [string]$OwnedOutputRoot
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Stop-WithMessage([string]$Message) {
  throw "Squirrel.Windows artifact validation failed: $Message"
}

function Test-StrictDescendant([string]$Child, [string]$Parent) {
  $normalizedParent = $Parent.TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar)
  return $Child.StartsWith("$normalizedParent$([System.IO.Path]::DirectorySeparatorChar)", [System.StringComparison]::OrdinalIgnoreCase)
}

function Assert-NoReparseTraversal([string]$Path, [string]$Boundary) {
  $current = $Path
  while ($true) {
    if (Test-Path -LiteralPath $current) {
      $item = Get-Item -LiteralPath $current -Force
      if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
        Stop-WithMessage "The owned output path traverses a reparse point: $current"
      }
    }
    if ($current.Equals($Boundary, [System.StringComparison]::OrdinalIgnoreCase)) { break }
    $parent = [System.IO.Path]::GetDirectoryName($current)
    if ([string]::IsNullOrWhiteSpace($parent) -or $parent -eq $current) {
      Stop-WithMessage 'The owned output path escaped its declared boundary.'
    }
    $current = $parent
  }
}

if (-not (Test-Path -LiteralPath $SourceRoot -PathType Container)) {
  Stop-WithMessage "Expected output directory is missing: $SourceRoot"
}

$sourceRootFull = [System.IO.Path]::GetFullPath((Resolve-Path -LiteralPath $SourceRoot).Path)
$outputDirectoryFull = [System.IO.Path]::GetFullPath($OutputDirectory)
$manifestPathFull = [System.IO.Path]::GetFullPath($ManifestPath)
$ownedOutputRootFull = [System.IO.Path]::GetFullPath((Resolve-Path -LiteralPath $OwnedOutputRoot).Path).TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar)
$repositoryRootFull = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar)
if ($sourceRootFull -eq $outputDirectoryFull) {
  Stop-WithMessage 'The staging directory must not be the builder output directory.'
}
if (-not (Test-StrictDescendant $outputDirectoryFull $ownedOutputRootFull) -or
    -not (Test-StrictDescendant $manifestPathFull $ownedOutputRootFull)) {
  Stop-WithMessage 'The staging directory and manifest must be strict descendants of OwnedOutputRoot.'
}
if ($manifestPathFull.Equals($outputDirectoryFull, [System.StringComparison]::OrdinalIgnoreCase) -or
    (Test-StrictDescendant $manifestPathFull $outputDirectoryFull)) {
  Stop-WithMessage 'The artifact manifest must live outside the replaceable staging directory.'
}
if ($outputDirectoryFull.Equals([System.IO.Path]::GetPathRoot($outputDirectoryFull), [System.StringComparison]::OrdinalIgnoreCase) -or
    $outputDirectoryFull.Equals($repositoryRootFull, [System.StringComparison]::OrdinalIgnoreCase) -or
    (Test-StrictDescendant $outputDirectoryFull $repositoryRootFull) -or
    (Test-StrictDescendant $repositoryRootFull $outputDirectoryFull) -or
    (Test-StrictDescendant $sourceRootFull $outputDirectoryFull)) {
  Stop-WithMessage 'The staging directory must not be a filesystem root or overlap the repository or builder output.'
}
Assert-NoReparseTraversal $outputDirectoryFull $ownedOutputRootFull
Assert-NoReparseTraversal $manifestPathFull $ownedOutputRootFull

if (Test-Path -LiteralPath $outputDirectoryFull) {
  Remove-Item -LiteralPath $outputDirectoryFull -Recurse -Force
}
New-Item -ItemType Directory -Path $outputDirectoryFull -Force | Out-Null

$setupCandidates = @(
  Get-ChildItem -LiteralPath $sourceRootFull -File |
    Where-Object { $_.Extension -ieq '.exe' -and $_.BaseName -match '(?i)setup' }
)
if ($setupCandidates.Count -ne 1) {
  Stop-WithMessage 'Expected exactly one Squirrel setup executable.'
}

$setupPath = Join-Path $outputDirectoryFull 'Setup.exe'
Copy-Item -LiteralPath $setupCandidates[0].FullName -Destination $setupPath
$setupSignature = Get-AuthenticodeSignature -LiteralPath $setupPath
if ($setupSignature.Status -ne 'NotSigned') {
  Stop-WithMessage "Setup.exe has Authenticode status '$($setupSignature.Status)'; this project requires intentionally unsigned artifacts."
}

$releaseIndexSource = Join-Path $sourceRootFull 'RELEASES'
if (-not (Test-Path -LiteralPath $releaseIndexSource -PathType Leaf)) {
  Stop-WithMessage 'Squirrel RELEASES is missing.'
}
Copy-Item -LiteralPath $releaseIndexSource -Destination (Join-Path $outputDirectoryFull 'RELEASES')

$nupkgSources = @(Get-ChildItem -LiteralPath $sourceRootFull -File -Filter '*.nupkg')
if ($nupkgSources.Count -eq 0) {
  Stop-WithMessage 'No Squirrel .nupkg packages were produced.'
}
$fullPackages = @($nupkgSources | Where-Object { $_.Name -match '(?i)-full\.nupkg$' })
if ($fullPackages.Count -eq 0) {
  Stop-WithMessage 'No full Squirrel .nupkg package was produced.'
}
foreach ($nupkg in $nupkgSources) {
  Copy-Item -LiteralPath $nupkg.FullName -Destination (Join-Path $outputDirectoryFull $nupkg.Name)
}

$assetFiles = @(Get-ChildItem -LiteralPath $outputDirectoryFull -File | Sort-Object Name)
foreach ($asset in $assetFiles) {
  if ($asset.Length -le 0) {
    Stop-WithMessage "Collected artifact is empty: $($asset.Name)"
  }
}

$packageNames = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
foreach ($nupkg in $nupkgSources) {
  [void]$packageNames.Add($nupkg.Name)
}

$referencedPackages = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
foreach ($line in @(Get-Content -LiteralPath (Join-Path $outputDirectoryFull 'RELEASES'))) {
  $trimmed = $line.Trim()
  if ([string]::IsNullOrWhiteSpace($trimmed)) {
    continue
  }
  if ($trimmed -notmatch '^\S+\s+(?<name>.+\.nupkg)\s+\d+$') {
    Stop-WithMessage 'Squirrel RELEASES contains a malformed package reference.'
  }
  $packageName = $Matches.name.Trim()
  if ([System.IO.Path]::GetFileName($packageName) -ne $packageName) {
    Stop-WithMessage 'Squirrel RELEASES contains a path instead of a package filename.'
  }
  if (-not $packageNames.Contains($packageName)) {
    Stop-WithMessage "Squirrel RELEASES references an uncollected package: $packageName"
  }
  [void]$referencedPackages.Add($packageName)
}
if ($referencedPackages.Count -eq 0) {
  Stop-WithMessage 'Squirrel RELEASES does not reference a package.'
}
foreach ($packageName in $packageNames) {
  if (-not $referencedPackages.Contains($packageName)) {
    Stop-WithMessage "Collected package is not referenced by RELEASES: $packageName"
  }
}

$manifestDirectory = Split-Path -Parent $manifestPathFull
if (-not (Test-Path -LiteralPath $manifestDirectory -PathType Container)) {
  New-Item -ItemType Directory -Path $manifestDirectory -Force | Out-Null
}
[object[]]$artifactEvidence = @($assetFiles | ForEach-Object {
  [pscustomobject]@{
    name = $_.Name
    sizeBytes = [int64]$_.Length
    sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
  }
})
[pscustomobject]@{
  directory = $outputDirectoryFull
  names = @($assetFiles.Name)
  artifacts = $artifactEvidence
  unsigned = $true
  setupSignatureStatus = [string]$setupSignature.Status
  fullPackages = @($fullPackages.Name)
  releaseIndex = 'RELEASES'
} | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $manifestPathFull -Encoding utf8NoBOM

Write-Output "Validated unsigned Squirrel.Windows assets: $($assetFiles.Name -join ', ')"
