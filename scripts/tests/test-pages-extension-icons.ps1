[CmdletBinding()]
param(
  [string]$ReleaseZip = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$sourcePath = Join-Path $repositoryRoot 'scripts/prepare-pages-release-manifest.ps1'

# Execute the production validator under real PowerShell StrictMode, without
# invoking gh, contacting a release, or writing the Pages release manifest.
$tokens = $null
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($sourcePath, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count -ne 0) { throw 'The production Pages script does not parse.' }
foreach ($name in @('Stop-WithMessage', 'Assert-StaticExtensionIcons')) {
  $definitions = @($ast.FindAll({ param($node)
    $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name
  }, $false))
  if ($definitions.Count -ne 1) { throw "Expected exactly one production function: $name" }
  . ([scriptblock]::Create($definitions[0].Extent.Text))
}
$assignments = @($ast.FindAll({ param($node)
  $node -is [System.Management.Automation.Language.AssignmentStatementAst] -and
  $node.Left.Extent.Text -eq '$staticExtensionIcons'
}, $false))
if ($assignments.Count -ne 1) { throw 'Expected exactly one production icon contract.' }
. ([scriptblock]::Create($assignments[0].Extent.Text))

function Assert-Rejected([string]$Label, [scriptblock]$Operation, [string]$Expected) {
  $caught = $null
  try { & $Operation } catch { $caught = $_ }
  if ($null -eq $caught) { throw "FAIL ${Label}: invalid artifact was accepted." }
  $message = $caught.Exception.Message
  if (-not $message.StartsWith('Pages release-manifest preparation failed: ', [StringComparison]::Ordinal) -or
      $message.IndexOf($Expected, [StringComparison]::Ordinal) -lt 0) {
    throw "FAIL ${Label}: expected contract diagnostic containing '$Expected', received '$message'."
  }
  Write-Output "PASS $Label"
}

function Read-FixtureManifest($Archive) {
  $reader = [System.IO.StreamReader]::new($Archive.GetEntry('manifest.json').Open())
  try { return ($reader.ReadToEnd() | ConvertFrom-Json -Depth 20) } finally { $reader.Dispose() }
}

function Get-FixtureEntryNames($Archive) {
  $names = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  foreach ($entry in $Archive.Entries) { [void]$names.Add($entry.FullName.Replace('\', '/')) }
  return ,$names
}

Add-Type -AssemblyName System.IO.Compression.FileSystem
$temporaryRoot = Join-Path ([IO.Path]::GetTempPath()) ('mdm-pages-icons-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $temporaryRoot | Out-Null
try {
  $fixtureDirectory = Join-Path $temporaryRoot 'fixture with spaces'
  New-Item -ItemType Directory -Path (Join-Path $fixtureDirectory 'assets/icons') -Force | Out-Null
  foreach ($size in @('16', '32', '48', '128')) {
    Copy-Item -LiteralPath (Join-Path $repositoryRoot "extension/assets/icons/icon$size.png") -Destination (Join-Path $fixtureDirectory "assets/icons/icon$size.png")
  }
  $completeJson = Get-Content -LiteralPath (Join-Path $repositoryRoot 'extension/manifest.json') -Raw
  [IO.File]::WriteAllText((Join-Path $fixtureDirectory 'manifest.json'), $completeJson)
  $completeZip = Join-Path $temporaryRoot 'complete.zip'
  [IO.Compression.ZipFile]::CreateFromDirectory($fixtureDirectory, $completeZip)
  $archive = [IO.Compression.ZipFile]::OpenRead($completeZip)
  try {
    $entryNames = Get-FixtureEntryNames $archive
    $manifest = Read-FixtureManifest $archive
    Assert-StaticExtensionIcons $manifest $archive $entryNames
    Write-Output 'PASS complete icon maps and real PNG ZIP entries'

    foreach ($target in @('icons', 'action', 'action.default_icon')) {
      foreach ($variant in @('missing', 'null', 'string', 'array', 'number', 'boolean')) {
        $data = $completeJson | ConvertFrom-Json -AsHashtable -Depth 20
        $owner = if ($target -eq 'action.default_icon') { $data['action'] } else { $data }
        $key = if ($target -eq 'action.default_icon') { 'default_icon' } else { $target }
        switch ($variant) {
          'missing' { [void]$owner.Remove($key) }
          'null' { $owner[$key] = $null }
          'string' { $owner[$key] = 'assets/icons/icon16.png' }
          'array' { $owner[$key] = @('assets/icons/icon16.png') }
          'number' { $owner[$key] = 16 }
          'boolean' { $owner[$key] = $true }
        }
        $manifest = $data | ConvertTo-Json -Depth 20 | ConvertFrom-Json -Depth 20
        Assert-Rejected "$variant $target" { Assert-StaticExtensionIcons $manifest $archive $entryNames } 'JSON object'
      }
    }
    foreach ($target in @('icons', 'action.default_icon')) {
      foreach ($size in @('16', '32', '48', '128')) {
        foreach ($variant in @('missing', 'wrong-path', 'null', 'array', 'object', 'number')) {
          $data = $completeJson | ConvertFrom-Json -AsHashtable -Depth 20
          $map = if ($target -eq 'icons') { $data['icons'] } else { $data['action']['default_icon'] }
          switch ($variant) {
            'missing' { [void]$map.Remove($size) }
            'wrong-path' { $map[$size] = 'wrong.png' }
            'null' { $map[$size] = $null }
            'array' { $map[$size] = @("assets/icons/icon$size.png") }
            'object' { $map[$size] = @{ path = "assets/icons/icon$size.png" } }
            'number' { $map[$size] = [int]$size }
          }
          $manifest = $data | ConvertTo-Json -Depth 20 | ConvertFrom-Json -Depth 20
          Assert-Rejected "$variant ${target}[$size]" { Assert-StaticExtensionIcons $manifest $archive $entryNames } "${target}[$size] must be assets/icons/icon$size.png"
        }
      }
    }
  } finally { $archive.Dispose() }

  foreach ($size in @('16', '32', '48', '128')) {
    $missingZip = Join-Path $temporaryRoot "missing-$size.zip"
    Copy-Item -LiteralPath $completeZip -Destination $missingZip
    $update = [IO.Compression.ZipFile]::Open($missingZip, [IO.Compression.ZipArchiveMode]::Update)
    try { $update.GetEntry("assets/icons/icon$size.png").Delete() } finally { $update.Dispose() }
    $archive = [IO.Compression.ZipFile]::OpenRead($missingZip)
    try {
      $manifest = Read-FixtureManifest $archive
      $entryNames = Get-FixtureEntryNames $archive
      Assert-Rejected "missing ZIP entry icon$size.png" { Assert-StaticExtensionIcons $manifest $archive $entryNames } "missing its static icon: assets/icons/icon$size.png"
    } finally { $archive.Dispose() }
  }

  foreach ($variant in @('too-small', 'too-large', 'invalid-header', 'wrong-dimensions')) {
    $brokenZip = Join-Path $temporaryRoot "$variant.zip"
    Copy-Item -LiteralPath $completeZip -Destination $brokenZip
    $update = [IO.Compression.ZipFile]::Open($brokenZip, [IO.Compression.ZipArchiveMode]::Update)
    try {
      $update.GetEntry('assets/icons/icon16.png').Delete()
      $bytes = [IO.File]::ReadAllBytes((Join-Path $fixtureDirectory 'assets/icons/icon16.png'))
      $expected = 'static icon has an invalid byte size'
      switch ($variant) {
        'too-small' { $bytes = [byte[]]::new(32) }
        'too-large' { $bytes = [byte[]]::new(512KB + 1) }
        'invalid-header' { $bytes[0] = 0; $expected = 'static icon is not a valid PNG header' }
        'wrong-dimensions' { $bytes[19] = 32; $expected = 'static icon dimensions are wrong' }
      }
      $stream = $update.CreateEntry('assets/icons/icon16.png').Open()
      try { $stream.Write($bytes, 0, $bytes.Length) } finally { $stream.Dispose() }
    } finally { $update.Dispose() }
    $archive = [IO.Compression.ZipFile]::OpenRead($brokenZip)
    try {
      $manifest = Read-FixtureManifest $archive
      $entryNames = Get-FixtureEntryNames $archive
      Assert-Rejected "$variant PNG entry" { Assert-StaticExtensionIcons $manifest $archive $entryNames } $expected
    } finally { $archive.Dispose() }
  }

  if (-not [string]::IsNullOrWhiteSpace($ReleaseZip)) {
    $archive = [IO.Compression.ZipFile]::OpenRead((Resolve-Path -LiteralPath $ReleaseZip).Path)
    try {
      $manifest = Read-FixtureManifest $archive
      $entryNames = Get-FixtureEntryNames $archive
      Assert-Rejected 'historical release without static icons remains rejected' { Assert-StaticExtensionIcons $manifest $archive $entryNames } 'JSON object'
    } finally { $archive.Dispose() }
  }
  Write-Output 'PAGES EXTENSION ICON TEST: PASS (real PowerShell; no Windows/release/Pages acceptance claim)'
} finally {
  Remove-Item -LiteralPath $temporaryRoot -Recurse -Force
}
