#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import path from 'node:path';

const CATALOG_URL =
  'https://raw.githubusercontent.com/Ding-Ding-Projects/dim-sum-photos/main/catalog/index.json';
const CATALOG_REPOSITORY = 'Ding-Ding-Projects/dim-sum-photos';
const GITHUB_RELEASE_BASE = 'https://github.com';
const GH_MAX_BUFFER = 256 * 1024 * 1024;

const unavailable = () => ({
  id: null,
  en: null,
  zhHant: null,
  assetName: null,
  photoUrl: null,
  catalogReleaseTag: null,
  available: false,
});

function outputMetadata(metadata) {
  process.stdout.write(`${JSON.stringify(metadata)}\n`);
}

function validRepositoryName(value) {
  return typeof value === 'string' && /^[^/\s]+\/[^/\s]+$/u.test(value);
}

function gitRemoteUrl() {
  try {
    const result = spawnSync('git', ['config', '--get', 'remote.origin.url'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    if (result.status === 0 && typeof result.stdout === 'string') {
      return result.stdout.trim();
    }
  } catch {
    // A missing Git executable or remote is handled by the unavailable result.
  }
  return '';
}

function repositoryName() {
  const environmentRepository = process.env.GITHUB_REPOSITORY?.trim();
  if (validRepositoryName(environmentRepository)) {
    return environmentRepository;
  }

  const remote = gitRemoteUrl().replace(/\.git$/u, '');
  const match = remote.match(/(?:github\.com[/:])([^/]+)\/([^/]+)$/iu);
  if (!match) {
    return null;
  }
  const name = `${match[1]}/${match[2]}`;
  return validRepositoryName(name) ? name : null;
}

function flattenPagedJson(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  if (value.every((page) => Array.isArray(page))) {
    return value.flat();
  }
  return value;
}

function runGhJson(endpoint, label) {
  let result;
  try {
    result = spawnSync(
      'gh',
      ['api', '--paginate', '--slurp', endpoint],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: process.env,
        maxBuffer: GH_MAX_BUFFER,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      },
    );
  } catch {
    return { ok: false, value: [], reason: `${label} could not start gh.` };
  }

  if (result.error || result.status !== 0 || typeof result.stdout !== 'string') {
    return { ok: false, value: [], reason: `${label} returned a nonzero status.` };
  }

  const output = result.stdout.trim();
  if (!output) {
    return { ok: true, value: [] };
  }

  try {
    return { ok: true, value: flattenPagedJson(JSON.parse(output)) };
  } catch {
    return { ok: false, value: [], reason: `${label} returned malformed JSON.` };
  }
}

async function fetchCatalog() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(CATALOG_URL, {
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Catalog returned HTTP ${response.status}.`);
    }
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function isPublishedRelease(release) {
  return Boolean(release && typeof release === 'object' && release.draft === false);
}

function releaseTag(release) {
  if (typeof release?.tag_name === 'string') {
    return release.tag_name;
  }
  if (typeof release?.tagName === 'string') {
    return release.tagName;
  }
  return '';
}

function assetDownloadUrl(tag, assetName, asset) {
  if (typeof asset?.browser_download_url === 'string' && asset.browser_download_url.trim()) {
    return asset.browser_download_url;
  }
  return `${GITHUB_RELEASE_BASE}/${CATALOG_REPOSITORY}/releases/download/${encodeURIComponent(
    tag,
  )}/${encodeURIComponent(assetName)}`;
}

function publishedCatalogAssets(releases) {
  const assetsByName = new Map();
  for (const release of releases) {
    const tag = releaseTag(release);
    if (!isPublishedRelease(release) || !tag.startsWith('catalog-v1')) {
      continue;
    }
    if (!Array.isArray(release.assets)) {
      continue;
    }
    for (const asset of release.assets) {
      if (
        !asset ||
        typeof asset !== 'object' ||
        typeof asset.name !== 'string' ||
        !asset.name.trim() ||
        (asset.state !== undefined && asset.state !== 'uploaded')
      ) {
        continue;
      }
      if (!assetsByName.has(asset.name)) {
        assetsByName.set(asset.name, {
          assetName: asset.name,
          photoUrl: assetDownloadUrl(tag, asset.name, asset),
          catalogReleaseTag: tag,
        });
      }
    }
  }
  return assetsByName;
}

function catalogRecords(catalog) {
  if (Array.isArray(catalog)) {
    return catalog;
  }
  if (catalog && typeof catalog === 'object' && Array.isArray(catalog.dishes)) {
    return catalog.dishes;
  }
  return [];
}

function candidateFromRecord(record, assetsByName) {
  if (!record || typeof record !== 'object') {
    return null;
  }
  if (
    typeof record.id !== 'string' ||
    !record.id.trim() ||
    !record.name ||
    typeof record.name !== 'object' ||
    typeof record.name.en !== 'string' ||
    !record.name.en.trim() ||
    typeof record.name.zhHant !== 'string' ||
    !record.name.zhHant.trim() ||
    !record.image ||
    typeof record.image !== 'object' ||
    typeof record.image.path !== 'string' ||
    !record.image.path.trim()
  ) {
    return null;
  }

  const normalizedImagePath = record.image.path.replaceAll('\\', '/');
  const assetName = path.posix.basename(normalizedImagePath);
  if (!assetName || assetName === '.' || assetName === '/') {
    return null;
  }
  const asset = assetsByName.get(assetName);
  if (!asset) {
    return null;
  }

  return {
    id: record.id,
    en: record.name.en,
    zhHant: record.name.zhHant,
    assetName: asset.assetName,
    photoUrl: asset.photoUrl,
    catalogReleaseTag: asset.catalogReleaseTag,
    available: true,
  };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function bodyRecordsId(body, id) {
  if (typeof body !== 'string' || !body) {
    return false;
  }
  const boundaryPattern = new RegExp(
    `(?:^|[^A-Za-z0-9_-])${escapeRegExp(id)}(?:$|[^A-Za-z0-9_-])`,
    'u',
  );
  return boundaryPattern.test(body);
}

function priorReleaseBodies(releases) {
  return releases
    .filter(isPublishedRelease)
    .map((release) => (typeof release.body === 'string' ? release.body : ''));
}

function excludedReleaseMetadataIds() {
  const raw = process.env.RELEASE_METADATA_EXCLUDE_IDS;
  if (typeof raw !== 'string' || !raw.trim()) {
    return new Set();
  }
  return new Set(
    raw
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean),
  );
}

function chooseCandidate(catalog, assetsByName, releaseBodies, excludedIds = new Set()) {
  const records = catalogRecords(catalog);
  for (const record of records) {
    const candidate = candidateFromRecord(record, assetsByName);
    if (!candidate) {
      continue;
    }
    if (excludedIds.has(candidate.id)) {
      continue;
    }
    if (releaseBodies.some((body) => bodyRecordsId(body, candidate.id))) {
      continue;
    }
    return candidate;
  }
  return null;
}

function reportFailure(reason) {
  if (reason) {
    process.stderr.write(`resolve-release-metadata: ${reason}\n`);
  }
  outputMetadata(unavailable());
}

async function main() {
  let catalog;
  try {
    catalog = await fetchCatalog();
  } catch {
    reportFailure('Could not fetch the authoritative catalog.');
    return;
  }

  const catalogReleases = runGhJson(
    `repos/${CATALOG_REPOSITORY}/releases?per_page=100`,
    'Catalog release query',
  );
  if (!catalogReleases.ok) {
    reportFailure(catalogReleases.reason);
    return;
  }

  const repository = repositoryName();
  if (!repository) {
    reportFailure('Could not determine this repository name.');
    return;
  }

  const projectReleases = runGhJson(
    `repos/${repository}/releases?per_page=100`,
    'Project release query',
  );
  if (!projectReleases.ok) {
    reportFailure(projectReleases.reason);
    return;
  }

  const assetsByName = publishedCatalogAssets(catalogReleases.value);
  const releaseBodies = priorReleaseBodies(projectReleases.value);
  const candidate = chooseCandidate(
    catalog,
    assetsByName,
    releaseBodies,
    excludedReleaseMetadataIds(),
  );
  outputMetadata(candidate ?? unavailable());
}

main().catch(() => {
  reportFailure('Metadata resolution failed unexpectedly.');
});
