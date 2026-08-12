(function (global) {
  "use strict";

  const EXTENSION_NAME = /^material-download-manager-extension-\d+\.\d+\.\d+\.zip$/i;
  const SHA256 = /^[a-f0-9]{64}$/;
  const REPOSITORY = "Ding-Ding-Projects/material-download-manager";

  function isHttpsUrl(value) {
    if (typeof value !== "string" || value.trim() === "") return false;
    const trimmed = value.trim();
    if (!/^https:\/\/[^/\s?#]+(?:[/?#]|$)/i.test(trimmed)) return false;
    const authority = trimmed.slice("https://".length).split(/[/?#]/, 1)[0];
    return !authority.includes("@");
  }

  function isGitHubReleaseAssetUrl(value) {
    if (!isHttpsUrl(value)) return false;
    return /^https:\/\/github\.com\/[^/\s?#]+\/[^/\s?#]+\/releases\/download\/[^/\s?#]+\/[^?\s#]+(?:\?[^#\s]*)?(?:#.*)?$/i.test(value.trim());
  }

  function isExactReleaseTagUrl(value, version) {
    return value === `https://github.com/${REPOSITORY}/releases/tag/v${version}`;
  }

  function isExactReleaseAssetUrl(value, version, name) {
    return value === `https://github.com/${REPOSITORY}/releases/download/v${version}/${name}`;
  }

  function isVerifiedStableRecord(record) {
    if (!record || typeof record !== "object") return false;
    if (typeof record.version !== "string" || !/^\d+\.\d+\.\d+$/.test(record.version)) return false;
    if (record.channel !== "stable" || record.isDraft !== false || record.isPrerelease !== false || record.verified !== true || record.unsigned !== true) return false;
    if (!isExactReleaseTagUrl(record.releaseUrl, record.version) || !isExactReleaseAssetUrl(record.installerUrl, record.version, "Setup.exe")) return false;
    if (typeof record.sourceCommit !== "string" || !/^[0-9a-f]{40}$/.test(record.sourceCommit)) return false;
    if (!Array.isArray(record.assets) || record.assets.some((name) => /\.crx(?:3)?$/i.test(String(name)))) return false;
    return ["Setup.exe", "RELEASES", `material-download-manager-${record.version}-full.nupkg`].every((name) => record.assets.includes(name));
  }

  function isVerifiedExtensionArtifact(record) {
    if (!isVerifiedStableRecord(record)) return false;
    if (typeof record.version !== "string" || !/^\d+\.\d+\.\d+$/.test(record.version)) return false;
    if (!Array.isArray(record.assets) || typeof record.extensionAsset !== "string") return false;
    if (record.assets.some((name) => /\.crx(?:3)?$/i.test(String(name)))) return false;
    const artifact = record.extensionArtifact;
    if (!artifact || typeof artifact !== "object") return false;
    if (artifact.name !== record.extensionAsset || !EXTENSION_NAME.test(artifact.name)) return false;
    if (artifact.version !== record.version || artifact.format !== "zip" || artifact.kind !== "chromium-extension-load-unpacked") return false;
    if (artifact.installMethod !== "load-unpacked" || artifact.manifestVersion !== 3 || artifact.signed !== false) return false;
    const downloadPath = typeof artifact.downloadUrl === "string" ? artifact.downloadUrl.trim().split(/[?#]/, 1)[0] : "";
    if (!record.assets.includes(artifact.name) || !isGitHubReleaseAssetUrl(artifact.downloadUrl) || !isExactReleaseAssetUrl(artifact.downloadUrl, record.version, artifact.name) || !downloadPath.endsWith(`/${artifact.name}`)) return false;
    if (!Number.isSafeInteger(artifact.sizeBytes) || artifact.sizeBytes <= 0) return false;
    if (typeof artifact.sha256 !== "string" || !SHA256.test(artifact.sha256)) return false;
    return true;
  }

  function getVerifiedExtensionDescriptor(record) {
    if (!isVerifiedExtensionArtifact(record)) return null;
    const artifact = record.extensionArtifact;
    return Object.freeze({
      href: artifact.downloadUrl,
      fileName: artifact.name,
      version: artifact.version,
      sizeBytes: artifact.sizeBytes,
      sha256: artifact.sha256,
      ariaLabel: `Download extension source ZIP · v${artifact.version}`,
      warning: "Unpaired public source ZIP; use the desktop app to prepare the private paired folder.",
      steps: Object.freeze([
        "Download the source ZIP and extract it to a local folder.",
        "Use Settings → Downloads → Install browser extension in the desktop app.",
        "Enable Developer mode and choose Load unpacked on the app-prepared folder."
      ])
    });
  }

  global.MDM_RELEASE_MANIFEST_CONTRACT = Object.freeze({
    extensionNamePattern: EXTENSION_NAME,
    repository: REPOSITORY,
    isHttpsUrl,
    isGitHubReleaseAssetUrl,
    isExactReleaseTagUrl,
    isExactReleaseAssetUrl,
    isVerifiedStableRecord,
    isVerifiedExtensionArtifact,
    getVerifiedExtensionDescriptor
  });
})(window);
