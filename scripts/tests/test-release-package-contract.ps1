[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$script:assertionCount = 0

function Assert-True([bool]$Condition, [string]$Message) {
  $script:assertionCount += 1
  if (-not $Condition) {
    throw "Assertion failed: $Message"
  }
}

function Assert-Equal($Actual, $Expected, [string]$Message) {
  $script:assertionCount += 1
  if ($Actual -ne $Expected) {
    throw "Assertion failed: $Message (expected '$Expected', received '$Actual')"
  }
}

function Assert-ThrowsLike([scriptblock]$Action, [string]$Pattern, [string]$Message) {
  $script:assertionCount += 1
  try {
    & $Action
  } catch {
    if ([string]$_.Exception.Message -notmatch $Pattern) {
      throw "Assertion failed: $Message (unexpected error '$([string]$_.Exception.Message)')"
    }
    return
  }
  throw "Assertion failed: $Message (no error was thrown)"
}

function Write-ArtifactManifest([string]$Path, [string]$Directory) {
  [ordered]@{
    directory = $Directory
    names = @('Setup.exe', 'RELEASES', 'material-download-manager-test-full.nupkg')
    unsigned = $true
    setupSignatureStatus = 'NotSigned'
    fullPackages = @('material-download-manager-test-full.nupkg')
    releaseIndex = 'RELEASES'
  } | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $Path -Encoding utf8NoBOM
}

function New-PublisherFixture([string]$Parent, [string]$Name) {
  $fixtureRoot = Join-Path $Parent $Name
  $assetDirectory = Join-Path $fixtureRoot 'assets'
  New-Item -ItemType Directory -Path $assetDirectory -Force | Out-Null

  $version = '7.8.9'
  $extensionName = "material-download-manager-extension-$version.zip"
  [System.IO.File]::WriteAllBytes((Join-Path $assetDirectory 'Setup.exe'), [byte[]](1, 2, 3))
  [System.IO.File]::WriteAllBytes((Join-Path $assetDirectory 'RELEASES'), [byte[]](4, 5, 6))
  [System.IO.File]::WriteAllBytes((Join-Path $assetDirectory "material-download-manager-$version-full.nupkg"), [byte[]](7, 8, 9))
  [System.IO.File]::WriteAllBytes((Join-Path $assetDirectory $extensionName), [byte[]](10, 11, 12, 13))

  $extensionPath = Join-Path $assetDirectory $extensionName
  $extensionHash = (Get-FileHash -LiteralPath $extensionPath -Algorithm SHA256).Hash.ToLowerInvariant()
  $extensionSize = (Get-Item -LiteralPath $extensionPath).Length
  $manifest = [ordered]@{
    directory = $assetDirectory
    names = @('Setup.exe', 'RELEASES', "material-download-manager-$version-full.nupkg", $extensionName)
    artifacts = @(
      Get-ChildItem -LiteralPath $assetDirectory -File | Sort-Object Name | ForEach-Object {
        [ordered]@{
          name = $_.Name
          sizeBytes = [int64]$_.Length
          sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
        }
      }
    )
    unsigned = $true
    setupSignatureStatus = 'NotSigned'
    fullPackages = @("material-download-manager-$version-full.nupkg")
    releaseIndex = 'RELEASES'
    extensionAsset = $extensionName
    extensionArtifact = [ordered]@{
      kind = 'chromium-extension-load-unpacked'
      format = 'zip'
      name = $extensionName
      version = $version
      sizeBytes = $extensionSize
      sha256 = $extensionHash
      manifestVersion = 3
      installMethod = 'load-unpacked'
      signed = $false
    }
  }
  $manifestPath = Join-Path $fixtureRoot 'release-assets.json'
  $metadataPath = Join-Path $fixtureRoot 'metadata.json'
  $versionPath = Join-Path $fixtureRoot 'version.json'
  $lineCountPath = Join-Path $fixtureRoot 'line-count.tsv'
  [ordered]@{ available = $false; codeName = '' } | ConvertTo-Json | Set-Content -LiteralPath $metadataPath -Encoding utf8NoBOM
  [ordered]@{ version = $version; tag = "v$version"; sourceCommit = '1111111111111111111111111111111111111111' } | ConvertTo-Json | Set-Content -LiteralPath $versionPath -Encoding utf8NoBOM
  @(
    "record`tscope`tname`tfiles`tlines`tnonBlank`tbytes`tagentLines`thumanOtherLines`tagentNonBlank`thumanOtherNonBlank",
    "summary`tproject`ttotal`t1`t1`t1`t1`t1`t0`t1`t0",
    "summary`tproject`thand-written-total`t1`t1`t1`t1`t1`t0`t1`t0",
    "attribution`tproject`tall-included`t1`t1`t1`t1`t1`t0`t1`t0",
    "attribution`tproject`thand-written`t1`t1`t1`t1`t1`t0`t1`t0"
  ) | Set-Content -LiteralPath $lineCountPath -Encoding utf8NoBOM
  return [pscustomobject]@{
    Root = $fixtureRoot
    AssetDirectory = $assetDirectory
    Manifest = $manifest
    ManifestPath = $manifestPath
    MetadataPath = $metadataPath
    VersionPath = $versionPath
    LineCountPath = $lineCountPath
  }
}

$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$packageScript = Join-Path $repositoryRoot 'scripts/package-extension.ps1'
$squirrelBuildScript = Join-Path $repositoryRoot 'scripts/build-unsigned-squirrel.ps1'
$publishScript = Join-Path $repositoryRoot 'scripts/publish-stable-release.ps1'
$preparePagesScript = Join-Path $repositoryRoot 'scripts/prepare-pages-release-manifest.ps1'
$bootstrapScript = Join-Path $repositoryRoot 'scripts/verify-self-hosted-bootstrap.ps1'
$extensionRoot = Join-Path $repositoryRoot 'extension'
$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) "mdm-release-contract-$([guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null

$savedEnvironment = @{
  PATH = $env:PATH
  GITHUB_REPOSITORY = $env:GITHUB_REPOSITORY
  GITHUB_SHA = $env:GITHUB_SHA
  GITHUB_RUN_ID = $env:GITHUB_RUN_ID
  GITHUB_OUTPUT = $env:GITHUB_OUTPUT
}

try {
  $sourceManifestHash = (Get-FileHash -LiteralPath (Join-Path $extensionRoot 'manifest.json') -Algorithm SHA256).Hash
  $outputDirectory = Join-Path $tempRoot 'package-output'
  New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
  $artifactManifestPath = Join-Path $tempRoot 'package-assets.json'
  Write-ArtifactManifest $artifactManifestPath $outputDirectory

  & $packageScript -ExtensionRoot $extensionRoot -OutputDirectory $outputDirectory -ManifestPath $artifactManifestPath -Version '7.8.9' | Out-Null
  $artifactManifest = Get-Content -LiteralPath $artifactManifestPath -Raw | ConvertFrom-Json -Depth 30
  $extensionArtifact = $artifactManifest.extensionArtifact
  $zipPath = Join-Path $outputDirectory ([string]$extensionArtifact.name)
  Assert-Equal ([string]$artifactManifest.extensionAsset) 'material-download-manager-extension-7.8.9.zip' 'compatibility extensionAsset uses the release version'
  Assert-Equal ([string]$extensionArtifact.version) '7.8.9' 'structured extension version matches the release'
  Assert-Equal ([string]$extensionArtifact.format) 'zip' 'structured extension format is ZIP'
  Assert-Equal ([string]$extensionArtifact.installMethod) 'load-unpacked' 'structured install method is Load unpacked'
  Assert-True (-not [bool]$extensionArtifact.signed) 'structured extension metadata explicitly records unsigned ZIP'
  Assert-Equal ([int64]$extensionArtifact.sizeBytes) ([int64](Get-Item -LiteralPath $zipPath).Length) 'structured size matches the ZIP'
  Assert-Equal ([string]$extensionArtifact.sha256) ((Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()) 'structured SHA-256 matches the ZIP'
  $extensionEvidence = @($artifactManifest.artifacts | Where-Object { [string]$_.name -eq [string]$extensionArtifact.name })
  Assert-Equal $extensionEvidence.Count 1 'per-file artifact evidence contains the extension ZIP exactly once'
  Assert-Equal ([string]$extensionEvidence[0].sha256) ([string]$extensionArtifact.sha256) 'per-file and structured extension SHA-256 evidence agree'
  Assert-Equal ((Get-FileHash -LiteralPath (Join-Path $extensionRoot 'manifest.json') -Algorithm SHA256).Hash) $sourceManifestHash 'source extension manifest remains byte-for-byte unchanged'
  $squirrelBuildSource = Get-Content -LiteralPath $squirrelBuildScript -Raw
  Assert-True ($squirrelBuildSource.Contains('$extensionManifest.version = $Version')) 'Squirrel packaging stamps the bundled extension manifest'
  Assert-True ($squirrelBuildSource.Contains('[System.IO.File]::WriteAllBytes($extensionManifestPath, $originalExtensionManifestBytes)')) 'Squirrel packaging restores bundled extension manifest bytes'

  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $archive = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
  try {
    $archiveNames = @($archive.Entries | ForEach-Object { $_.FullName.Replace('\', '/') })
    $manifestEntry = $archive.GetEntry('manifest.json')
    Assert-True ($null -ne $manifestEntry) 'ZIP contains root manifest.json'
    $reader = [System.IO.StreamReader]::new($manifestEntry.Open(), [System.Text.Encoding]::UTF8, $true)
    try {
      $embeddedManifest = $reader.ReadToEnd() | ConvertFrom-Json -Depth 20
    } finally {
      $reader.Dispose()
    }
    Assert-Equal ([string]$embeddedManifest.version) '7.8.9' 'embedded manifest version is stamped'
    foreach ($required in @('manifest.json', [string]$embeddedManifest.background.service_worker, [string]$embeddedManifest.action.default_popup, [string]$embeddedManifest.options_page)) {
      Assert-True ($archiveNames -contains $required) "ZIP includes manifest-referenced entry $required"
    }
    Assert-True (@($archiveNames | Where-Object { $_ -match '(?i)\.(?:pem|key|pfx|p12|cer|crt|der|jks|keystore|pk8|crx)$' }).Count -eq 0) 'ZIP contains no signing or CRX material'
  } finally {
    $archive.Dispose()
  }

  & $packageScript -ExtensionRoot $extensionRoot -OutputDirectory $outputDirectory -ManifestPath $artifactManifestPath -Version '7.8.9' | Out-Null
  $rerunManifest = Get-Content -LiteralPath $artifactManifestPath -Raw | ConvertFrom-Json -Depth 30
  Assert-Equal (@($rerunManifest.names | Where-Object { $_ -eq 'material-download-manager-extension-7.8.9.zip' }).Count) 1 'packaging rerun keeps one extension asset declaration'

  $keyExtensionRoot = Join-Path $tempRoot 'extension-with-key'
  New-Item -ItemType Directory -Path $keyExtensionRoot -Force | Out-Null
  Copy-Item -Path (Join-Path $extensionRoot '*') -Destination $keyExtensionRoot -Recurse
  $keyManifestPath = Join-Path $keyExtensionRoot 'manifest.json'
  $keyManifest = Get-Content -LiteralPath $keyManifestPath -Raw | ConvertFrom-Json -Depth 20
  $keyManifest | Add-Member -MemberType NoteProperty -Name 'key' -Value 'forbidden-test-placeholder'
  $keyManifest | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $keyManifestPath -Encoding utf8NoBOM
  Assert-ThrowsLike {
    & $packageScript -ExtensionRoot $keyExtensionRoot -OutputDirectory $outputDirectory -ManifestPath $artifactManifestPath -Version '7.8.9' | Out-Null
  } 'must not embed a signing key' 'manifest key is rejected before packaging'

  $pemExtensionRoot = Join-Path $tempRoot 'extension-with-pem'
  New-Item -ItemType Directory -Path $pemExtensionRoot -Force | Out-Null
  Copy-Item -Path (Join-Path $extensionRoot '*') -Destination $pemExtensionRoot -Recurse
  Set-Content -LiteralPath (Join-Path $pemExtensionRoot 'docs/forbidden-test.pem') -Value 'not-a-real-key' -Encoding utf8NoBOM
  Assert-ThrowsLike {
    & $packageScript -ExtensionRoot $pemExtensionRoot -OutputDirectory $outputDirectory -ManifestPath $artifactManifestPath -Version '7.8.9' | Out-Null
  } 'forbidden signing or CRX material' 'PEM files are rejected from the package payload'
  Assert-ThrowsLike {
    & $packageScript -ExtensionRoot $extensionRoot -OutputDirectory $outputDirectory -ManifestPath $artifactManifestPath -Version '70000.1.1' | Out-Null
  } '0-65535 component range' 'Chromium version component bounds are enforced'

  $fakeBin = Join-Path $tempRoot 'fake-bin'
  New-Item -ItemType Directory -Path $fakeBin -Force | Out-Null
  "@echo off`r`necho TEST ERROR: gh must not be called by publisher preflight tests 1>&2`r`nexit /b 99`r`n" | Set-Content -LiteralPath (Join-Path $fakeBin 'gh.cmd') -Encoding ascii
  $env:PATH = "$fakeBin;$($savedEnvironment.PATH)"
  $env:GITHUB_REPOSITORY = 'example/material-download-manager'
  $env:GITHUB_SHA = '1111111111111111111111111111111111111111'
  $env:GITHUB_RUN_ID = '12345'
  Remove-Item Env:GITHUB_OUTPUT -ErrorAction SilentlyContinue

  $publisherCases = @(
    [pscustomobject]@{
      Name = 'publisher-extra-file'
      Pattern = 'undeclared artifact unexpected\.txt'
      Mutate = { param($fixture) Set-Content -LiteralPath (Join-Path $fixture.AssetDirectory 'unexpected.txt') -Value 'extra' }
    },
    [pscustomobject]@{
      Name = 'publisher-duplicate-name'
      Pattern = 'duplicate asset filename'
      Mutate = { param($fixture) $fixture.Manifest.names += 'Setup.exe' }
    },
    [pscustomobject]@{
      Name = 'publisher-missing-structure'
      Pattern = 'requires both compatibility extensionAsset and structured extensionArtifact'
      Mutate = { param($fixture) $fixture.Manifest.Remove('extensionArtifact') }
    },
    [pscustomobject]@{
      Name = 'publisher-wrong-name'
      Pattern = 'not the canonical unsigned Manifest V3 Load unpacked ZIP'
      Mutate = { param($fixture) $fixture.Manifest.extensionAsset = 'material-download-manager-extension-7.8.8.zip' }
    },
    [pscustomobject]@{
      Name = 'publisher-hash-mismatch'
      Pattern = 'no longer matches its structured size and SHA-256 metadata'
      Mutate = { param($fixture) $fixture.Manifest.extensionArtifact.sha256 = ('0' * 64) }
    },
    [pscustomobject]@{
      Name = 'publisher-crx-file'
      Pattern = 'must not contain a CRX'
      Mutate = { param($fixture) Set-Content -LiteralPath (Join-Path $fixture.AssetDirectory 'unexpected.crx') -Value 'not-a-crx' }
    }
  )
  foreach ($publisherCase in $publisherCases) {
    $fixture = New-PublisherFixture $tempRoot $publisherCase.Name
    & $publisherCase.Mutate $fixture
    $fixture.Manifest | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath $fixture.ManifestPath -Encoding utf8NoBOM
    Assert-ThrowsLike {
      & $publishScript -MetadataPath $fixture.MetadataPath -VersionPath $fixture.VersionPath -LineCountPath $fixture.LineCountPath -ArtifactManifestPath $fixture.ManifestPath | Out-Null
    } $publisherCase.Pattern "publisher rejects $($publisherCase.Name) before calling gh"
  }

  function Initialize-PublisherGhFixture([pscustomobject]$Fixture, [string]$Mode = 'success') {
    $global:MdmPublisherFixture = $Fixture
    $global:MdmPublisherMode = $Mode
    $global:MdmPublisherCalls = [System.Collections.Generic.List[string]]::new()
    $global:MdmPublisherBody = ''
    $global:MdmPublisherDraft = $true
    $global:MdmPublisherPublishedAt = [DateTimeOffset]::UtcNow.ToString('o')
    $global:MdmPublisherAssets = @(
      Get-ChildItem -LiteralPath $Fixture.AssetDirectory -File | Sort-Object Name | ForEach-Object {
        [pscustomobject]@{
          name = $_.Name
          size = [int64]$_.Length
          digest = "sha256:$((Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant())"
          url = "https://github.com/example/material-download-manager/releases/download/v7.8.9/$($_.Name)"
        }
      }
    )
  }

  function global:gh {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)
    $global:LASTEXITCODE = 0
    [void]$global:MdmPublisherCalls.Add(($Arguments -join ' '))
    if ($Arguments.Count -ge 2 -and $Arguments[0] -eq 'release' -and $Arguments[1] -eq 'create') {
      $notesIndex = [Array]::IndexOf($Arguments, '--notes-file')
      if ($notesIndex -ge 0) { $global:MdmPublisherBody = Get-Content -LiteralPath $Arguments[$notesIndex + 1] -Raw }
      $global:MdmPublisherDraft = $true
      return
    }
    if ($Arguments.Count -ge 1 -and $Arguments[0] -eq 'api') {
      $assets = @($global:MdmPublisherAssets)
      if ($global:MdmPublisherMode -eq 'draft-digest-mismatch') {
        $assets = @($assets | ForEach-Object { [pscustomobject]@{ name = $_.name; size = $_.size; digest = $_.digest; url = $_.url } })
        $assets[0].digest = "sha256:$('0' * 64)"
      }
      [pscustomobject]@{
        tag_name = 'v7.8.9'
        draft = [bool]$global:MdmPublisherDraft
        prerelease = $false
        target_commitish = $env:GITHUB_SHA
        assets = $assets
      } | ForEach-Object { ConvertTo-Json -InputObject @($_) -Depth 40 -Compress }
      return
    }
    if ($Arguments.Count -ge 2 -and $Arguments[0] -eq 'release' -and $Arguments[1] -eq 'edit') {
      if ($Arguments -contains '--draft=false') {
        $global:MdmPublisherDraft = $false
      }
      if ($Arguments -contains '--draft=true') {
        if ($global:MdmPublisherMode -eq 'rollback-refused') {
          $global:LASTEXITCODE = 7
          Write-Output 'simulated re-draft refusal'
          return
        }
        $global:MdmPublisherDraft = $true
      }
      $notesIndex = [Array]::IndexOf($Arguments, '--notes-file')
      if ($notesIndex -ge 0) { $global:MdmPublisherBody = Get-Content -LiteralPath $Arguments[$notesIndex + 1] -Raw }
      return
    }
    if ($Arguments.Count -ge 2 -and $Arguments[0] -eq 'release' -and $Arguments[1] -eq 'view') {
      [pscustomobject]@{
        tagName = 'v7.8.9'
        targetCommitish = $env:GITHUB_SHA
        isDraft = [bool]$global:MdmPublisherDraft
        isPrerelease = $false
        publishedAt = [string]$global:MdmPublisherPublishedAt
        assets = @($global:MdmPublisherAssets)
        body = [string]$global:MdmPublisherBody
        url = 'https://github.com/example/material-download-manager/releases/tag/v7.8.9'
      } | ConvertTo-Json -Depth 40 -Compress
      return
    }
    if ($Arguments.Count -ge 2 -and $Arguments[0] -eq 'run' -and $Arguments[1] -eq 'view') {
      [pscustomobject]@{ jobs = @([pscustomobject]@{ startedAt = [DateTimeOffset]::UtcNow.AddSeconds(-10).ToString('o') }) } | ConvertTo-Json -Depth 10 -Compress
      return
    }
    if ($Arguments.Count -ge 2 -and $Arguments[0] -eq 'release' -and $Arguments[1] -eq 'download') {
      $directoryIndex = [Array]::IndexOf($Arguments, '--dir')
      Get-ChildItem -LiteralPath $global:MdmPublisherFixture.AssetDirectory -File | Copy-Item -Destination $Arguments[$directoryIndex + 1]
      if ($global:MdmPublisherMode -eq 'rollback-refused') {
        Add-Content -LiteralPath (Join-Path $Arguments[$directoryIndex + 1] 'Setup.exe') -Value 'tampered'
      }
      return
    }
    $global:LASTEXITCODE = 98
    Write-Output "Unexpected fake gh invocation: $($Arguments -join ' ')"
  }

  $draftMismatchFixture = New-PublisherFixture $tempRoot 'publisher-draft-digest-mismatch'
  $draftMismatchFixture.Manifest | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath $draftMismatchFixture.ManifestPath -Encoding utf8NoBOM
  Initialize-PublisherGhFixture $draftMismatchFixture 'draft-digest-mismatch'
  Assert-ThrowsLike {
    & $publishScript -MetadataPath $draftMismatchFixture.MetadataPath -VersionPath $draftMismatchFixture.VersionPath -LineCountPath $draftMismatchFixture.LineCountPath -ArtifactManifestPath $draftMismatchFixture.ManifestPath | Out-Null
  } 'Draft release artifact .* differs from its validated size or GitHub SHA-256 digest' 'publisher proves every draft asset before publication'
  Assert-True (@($global:MdmPublisherCalls | Where-Object { $_ -match 'release edit .*--draft=false' }).Count -eq 0) 'draft asset mismatch prevents publication'

  $publisherSuccessFixture = New-PublisherFixture $tempRoot 'publisher-success'
  $publisherSuccessFixture.Manifest | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath $publisherSuccessFixture.ManifestPath -Encoding utf8NoBOM
  Initialize-PublisherGhFixture $publisherSuccessFixture
  & $publishScript -MetadataPath $publisherSuccessFixture.MetadataPath -VersionPath $publisherSuccessFixture.VersionPath -LineCountPath $publisherSuccessFixture.LineCountPath -ArtifactManifestPath $publisherSuccessFixture.ManifestPath | Out-Null
  Assert-True (-not [bool]$global:MdmPublisherDraft) 'successful publisher leaves one stable non-draft release'
  Assert-True ($global:MdmPublisherBody -match 'Workflow started' -and $global:MdmPublisherBody -match 'Workflow completed' -and $global:MdmPublisherBody -match 'Workflow duration') 'successful publisher writes exact timing fields'
  Assert-True ($global:MdmPublisherBody -match 'material-download-manager-extension-7\.8\.9\.zip') 'successful publisher names the exact extension ZIP'
  $draftProofIndex = $global:MdmPublisherCalls.FindIndex([Predicate[string]]{ param($value) $value -like 'api repos/*' })
  $publicationIndex = $global:MdmPublisherCalls.FindIndex([Predicate[string]]{ param($value) $value -match 'release edit .*--draft=false' })
  Assert-True ($draftProofIndex -ge 0 -and $publicationIndex -gt $draftProofIndex) 'hui-side draft proof precedes publication'

  $rollbackFixture = New-PublisherFixture $tempRoot 'publisher-rollback-refused'
  $rollbackFixture.Manifest | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath $rollbackFixture.ManifestPath -Encoding utf8NoBOM
  Initialize-PublisherGhFixture $rollbackFixture 'rollback-refused'
  Assert-ThrowsLike {
    & $publishScript -MetadataPath $rollbackFixture.MetadataPath -VersionPath $rollbackFixture.VersionPath -LineCountPath $rollbackFixture.LineCountPath -ArtifactManifestPath $rollbackFixture.ManifestPath | Out-Null
  } 're-drafting the release was refused with exit code 7' 'publisher reports a refused rollback instead of silently leaving a public release'

  $fakeExtensionPayload = Join-Path $tempRoot 'fake-pages-extension-payload'
  New-Item -ItemType Directory -Path (Join-Path $fakeExtensionPayload 'src/shared') -Force | Out-Null
  [ordered]@{
    manifest_version = 3
    name = 'Fixture extension'
    version = '7.8.9'
    background = [ordered]@{ service_worker = 'src/service-worker.js'; type = 'module' }
    action = [ordered]@{ default_popup = 'src/popup.html' }
    options_page = 'src/options.html'
  } | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $fakeExtensionPayload 'manifest.json') -Encoding utf8NoBOM
  Set-Content -LiteralPath (Join-Path $fakeExtensionPayload 'src/service-worker.js') -Value 'export {};' -Encoding utf8NoBOM
  Set-Content -LiteralPath (Join-Path $fakeExtensionPayload 'src/popup.html') -Value '<!doctype html><title>Fixture</title>' -Encoding utf8NoBOM
  Set-Content -LiteralPath (Join-Path $fakeExtensionPayload 'src/options.html') -Value '<!doctype html><title>Fixture options</title>' -Encoding utf8NoBOM
  Set-Content -LiteralPath (Join-Path $fakeExtensionPayload 'src/shared/pairing.js') -Value 'export const HANDOFF_CAPABILITY = "";' -Encoding utf8NoBOM
  $global:MdmFakeExtensionZip = Join-Path $tempRoot 'material-download-manager-extension-7.8.9.zip'
  Compress-Archive -Path (Join-Path $fakeExtensionPayload '*') -DestinationPath $global:MdmFakeExtensionZip -CompressionLevel Optimal
  $global:MdmFakeReleaseAssetDirectory = Join-Path $tempRoot 'fake-pages-release-assets'
  New-Item -ItemType Directory -Path $global:MdmFakeReleaseAssetDirectory -Force | Out-Null
  [System.IO.File]::WriteAllBytes((Join-Path $global:MdmFakeReleaseAssetDirectory 'Setup.exe'), [byte[]](1, 2, 3, 4, 5))
  [System.IO.File]::WriteAllBytes((Join-Path $global:MdmFakeReleaseAssetDirectory 'RELEASES'), [byte[]](6, 7, 8, 9))
  [System.IO.File]::WriteAllBytes((Join-Path $global:MdmFakeReleaseAssetDirectory 'material-download-manager-7.8.9-full.nupkg'), [byte[]](10, 11, 12, 13, 14, 15))
  Copy-Item -LiteralPath $global:MdmFakeExtensionZip -Destination $global:MdmFakeReleaseAssetDirectory

  function global:gh {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)
    $global:LASTEXITCODE = 0
    if ($Arguments.Count -ge 2 -and $Arguments[0] -eq 'release' -and $Arguments[1] -eq 'list') {
      Write-Output (ConvertTo-Json -InputObject @($global:MdmFakeReleaseList) -Depth 30 -Compress)
      return
    }
    if ($Arguments.Count -ge 2 -and $Arguments[0] -eq 'release' -and $Arguments[1] -eq 'view') {
      Write-Output ($global:MdmFakeReleaseView | ConvertTo-Json -Depth 30 -Compress)
      return
    }
    if ($Arguments.Count -ge 2 -and $Arguments[0] -eq 'release' -and $Arguments[1] -eq 'download') {
      $directoryIndex = [Array]::IndexOf($Arguments, '--dir')
      if ($directoryIndex -lt 0 -or $directoryIndex + 1 -ge $Arguments.Count) {
        $global:LASTEXITCODE = 97
        Write-Error 'Fake release download is missing --dir.'
        return
      }
      Get-ChildItem -LiteralPath $global:MdmFakeReleaseAssetDirectory -File | Copy-Item -Destination ([string]$Arguments[$directoryIndex + 1])
      return
    }
    $global:LASTEXITCODE = 98
    Write-Error "Unexpected fake gh invocation: $($Arguments -join ' ')"
  }
  $fakeDigest = (Get-FileHash -LiteralPath $global:MdmFakeExtensionZip -Algorithm SHA256).Hash.ToLowerInvariant()
  $fakeExtensionSize = (Get-Item -LiteralPath $global:MdmFakeExtensionZip).Length
  $fakeReleaseFiles = Get-ChildItem -LiteralPath $global:MdmFakeReleaseAssetDirectory -File
  function New-FakeReleaseAsset([string]$Name) {
    $file = $fakeReleaseFiles | Where-Object { $_.Name -eq $Name } | Select-Object -First 1
    return [pscustomobject]@{
      name = $Name
      url = "https://github.com/example/material-download-manager/releases/download/v7.8.9/$Name"
      size = [int64]$file.Length
      digest = "sha256:$((Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant())"
    }
  }
  $global:MdmFakeReleaseList = @(
    [pscustomobject]@{ tagName = 'v7.8.9'; isDraft = $false; isPrerelease = $false; publishedAt = '2026-08-10T12:00:00Z' }
  )
  $global:MdmFakeReleaseView = [pscustomobject]@{
    tagName = 'v7.8.9'
    targetCommitish = '1111111111111111111111111111111111111111'
    isDraft = $false
    isPrerelease = $false
    publishedAt = '2026-08-10T12:00:00Z'
    url = 'https://github.com/example/material-download-manager/releases/tag/v7.8.9'
    body = "UNSIGNED Workflow started Workflow completed Workflow duration Load unpacked 1111111111111111111111111111111111111111 material-download-manager-extension-7.8.9.zip $fakeDigest"
    assets = @(
      (New-FakeReleaseAsset 'Setup.exe'),
      (New-FakeReleaseAsset 'RELEASES'),
      (New-FakeReleaseAsset 'material-download-manager-7.8.9-full.nupkg'),
      (New-FakeReleaseAsset 'material-download-manager-extension-7.8.9.zip')
    )
  }
  $pagesOutput = Join-Path $tempRoot 'pages-stable/data'
  New-Item -ItemType Directory -Path $pagesOutput -Force | Out-Null
  [ordered]@{ schemaVersion = 1; stable = $null; testPrereleases = @(); status = 'fixture'; publication = $null } | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath (Join-Path $pagesOutput 'release-manifest.json') -Encoding utf8NoBOM
  & $preparePagesScript -OutputDirectory (Split-Path -Parent $pagesOutput) -PagesUrl 'https://example.github.io/material-download-manager/' | Out-Null
  $pagesManifest = Get-Content -LiteralPath (Join-Path $pagesOutput 'release-manifest.json') -Raw | ConvertFrom-Json -Depth 30
  Assert-Equal ([string]$pagesManifest.stable.extensionAsset) 'material-download-manager-extension-7.8.9.zip' 'Pages manifest keeps the compatibility extension asset name'
  Assert-Equal ([string]$pagesManifest.stable.extensionArtifact.version) '7.8.9' 'Pages manifest records the extension release version'
  Assert-Equal ([string]$pagesManifest.stable.extensionArtifact.sha256) $fakeDigest 'Pages manifest records the GitHub SHA-256 digest'
  Assert-Equal ([int64]$pagesManifest.stable.extensionArtifact.sizeBytes) ([int64]$fakeExtensionSize) 'Pages manifest records the extension ZIP size'
  Assert-True ((Get-Content -LiteralPath (Join-Path $pagesOutput 'release-manifest.js') -Raw).Contains($fakeDigest)) 'Pages JavaScript mirror contains the same extension digest'

  $global:MdmFakeReleaseView.assets += [pscustomobject]@{ name = 'material-download-manager-extension-7.8.8.zip'; url = 'https://github.com/example/material-download-manager/releases/download/v7.8.9/material-download-manager-extension-7.8.8.zip'; size = 41; digest = "sha256:$('e' * 64)" }
  $duplicatePagesOutput = Join-Path $tempRoot 'pages-duplicate/data'
  New-Item -ItemType Directory -Path $duplicatePagesOutput -Force | Out-Null
  [ordered]@{ schemaVersion = 1; stable = $null; testPrereleases = @(); status = 'fixture'; publication = $null } | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath (Join-Path $duplicatePagesOutput 'release-manifest.json') -Encoding utf8NoBOM
  Assert-ThrowsLike {
    & $preparePagesScript -OutputDirectory (Split-Path -Parent $duplicatePagesOutput) -PagesUrl 'https://example.github.io/material-download-manager/' | Out-Null
  } 'must contain exactly one canonical Load unpacked browser-extension ZIP' 'Pages preparation rejects duplicate extension ZIPs'

  $global:MdmFakeReleaseList = @()
  $emptyPagesOutput = Join-Path $tempRoot 'pages-empty/data'
  New-Item -ItemType Directory -Path $emptyPagesOutput -Force | Out-Null
  [ordered]@{ schemaVersion = 1; stable = $null; testPrereleases = @(); status = 'fixture'; publication = $null } | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath (Join-Path $emptyPagesOutput 'release-manifest.json') -Encoding utf8NoBOM
  & $preparePagesScript -OutputDirectory (Split-Path -Parent $emptyPagesOutput) -PagesUrl 'https://example.github.io/material-download-manager/' | Out-Null
  $emptyPagesManifest = Get-Content -LiteralPath (Join-Path $emptyPagesOutput 'release-manifest.json') -Raw | ConvertFrom-Json -Depth 30
  Assert-True ($null -eq $emptyPagesManifest.stable) 'Pages preparation keeps the installer absent when no stable release exists'

  Remove-Item Function:\global:gh -ErrorAction SilentlyContinue
  Remove-Variable MdmFakeReleaseList -Scope Global -ErrorAction SilentlyContinue
  Remove-Variable MdmFakeReleaseView -Scope Global -ErrorAction SilentlyContinue
  Remove-Variable MdmFakeExtensionZip -Scope Global -ErrorAction SilentlyContinue
  Remove-Variable MdmFakeReleaseAssetDirectory -Scope Global -ErrorAction SilentlyContinue
  Remove-Item Function:\New-FakeReleaseAsset -ErrorAction SilentlyContinue

  $workflowFixtureRoot = Join-Path $tempRoot 'workflow-fixture'
  New-Item -ItemType Directory -Path (Join-Path $workflowFixtureRoot '.git') -Force | Out-Null
  New-Item -ItemType Directory -Path (Join-Path $workflowFixtureRoot '.github/workflows') -Force | Out-Null
  Copy-Item -LiteralPath (Join-Path $repositoryRoot '.github/workflows/release.yml') -Destination (Join-Path $workflowFixtureRoot '.github/workflows/release.yml')
  Copy-Item -LiteralPath (Join-Path $repositoryRoot '.github/workflows/pages.yml') -Destination (Join-Path $workflowFixtureRoot '.github/workflows/pages.yml')
  $workflowInventoryPath = Join-Path $workflowFixtureRoot 'self-hosted-dependencies.json'
  Copy-Item -LiteralPath (Join-Path $repositoryRoot 'scripts/self-hosted-dependencies.json') -Destination $workflowInventoryPath
  & $bootstrapScript -Phase static -InventoryPath $workflowInventoryPath -RepositoryRootOverride $workflowFixtureRoot | Out-Null
  Assert-True $true 'static workflow contract passes on the checked workflows'

  $releaseWorkflowText = Get-Content -LiteralPath (Join-Path $workflowFixtureRoot '.github/workflows/release.yml') -Raw
  $pagesWorkflowText = Get-Content -LiteralPath (Join-Path $workflowFixtureRoot '.github/workflows/pages.yml') -Raw
  Assert-True ($releaseWorkflowText -notmatch '(?m)^\s*run:\s*npm run build\s*$') 'release workflow avoids the prebuild documentation check lifecycle'
  Assert-True ($pagesWorkflowText.Contains('node site/build.mjs "$env:PAGES_STAGING_PATH" --package-only')) 'Pages workflow selects build-only site packaging'

  Add-Content -LiteralPath (Join-Path $workflowFixtureRoot '.github/workflows/release.yml') -Value "`n      - name: Test injected guard`n        run: npm test`n"
  Assert-ThrowsLike {
    & $bootstrapScript -Phase static -InventoryPath $workflowInventoryPath -RepositoryRootOverride $workflowFixtureRoot | Out-Null
  } 'forbidden GitHub Actions quality check' 'workflow quality guard demonstrably fails when npm test is injected'

  Write-Output "PASS: release package contract ($script:assertionCount assertions)"
} finally {
  $env:PATH = $savedEnvironment.PATH
  foreach ($name in @('GITHUB_REPOSITORY', 'GITHUB_SHA', 'GITHUB_RUN_ID', 'GITHUB_OUTPUT')) {
    $saved = $savedEnvironment[$name]
    if ($null -eq $saved) {
      Remove-Item -Path "Env:$name" -ErrorAction SilentlyContinue
    } else {
      Set-Item -Path "Env:$name" -Value $saved
    }
  }
  Remove-Item Function:\global:gh -ErrorAction SilentlyContinue
  Remove-Variable MdmFakeReleaseList -Scope Global -ErrorAction SilentlyContinue
  Remove-Variable MdmFakeReleaseView -Scope Global -ErrorAction SilentlyContinue
  Remove-Variable MdmFakeExtensionZip -Scope Global -ErrorAction SilentlyContinue
  Remove-Variable MdmFakeReleaseAssetDirectory -Scope Global -ErrorAction SilentlyContinue
  Remove-Item Function:\New-FakeReleaseAsset -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
}
