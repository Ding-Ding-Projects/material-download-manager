#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { TextDecoder } from 'node:util';

const CATEGORY_NAMES = ['source', 'tests', 'styles/markup', 'generated', 'other'];
const EXCLUDED_NAMES = [
  'dependency',
  'lockfile',
  'vendored',
  'build-output',
  'binary',
  'unreadable',
];

const SOURCE_EXTENSIONS = new Set([
  '.c',
  '.cc',
  '.cpp',
  '.cxx',
  '.cs',
  '.go',
  '.h',
  '.hh',
  '.hpp',
  '.java',
  '.js',
  '.jsx',
  '.kt',
  '.kts',
  '.m',
  '.mm',
  '.mjs',
  '.mts',
  '.php',
  '.pl',
  '.pm',
  '.ps1',
  '.py',
  '.rb',
  '.rs',
  '.sh',
  '.swift',
  '.ts',
  '.tsx',
  '.vue',
  '.zig',
]);

const MARKUP_EXTENSIONS = new Set([
  '.astro',
  '.css',
  '.htm',
  '.html',
  '.less',
  '.md',
  '.mdx',
  '.sass',
  '.scss',
  '.svelte',
  '.svg',
  '.styl',
  '.xhtml',
  '.xml',
]);

const BINARY_EXTENSIONS = new Set([
  '.7z',
  '.avi',
  '.bin',
  '.bmp',
  '.class',
  '.db',
  '.dll',
  '.dmg',
  '.doc',
  '.docx',
  '.eot',
  '.exe',
  '.gif',
  '.gz',
  '.ico',
  '.jar',
  '.jpeg',
  '.jpg',
  '.m4a',
  '.mp3',
  '.mp4',
  '.nupkg',
  '.obj',
  '.odt',
  '.ogg',
  '.otf',
  '.pdf',
  '.png',
  '.ppt',
  '.pptx',
  '.so',
  '.tar',
  '.ttf',
  '.wav',
  '.webm',
  '.webp',
  '.woff',
  '.woff2',
  '.xls',
  '.xlsx',
  '.zip',
]);

const LOCKFILE_NAMES = new Set([
  'bun.lockb',
  'cargo.lock',
  'composer.lock',
  'gemfile.lock',
  'go.sum',
  'gradle.lockfile',
  'npm-shrinkwrap.json',
  'package-lock.json',
  'packages.lock.json',
  'pipfile.lock',
  'pnpm-lock.yaml',
  'poetry.lock',
  'project.assets.json',
  'yarn.lock',
]);

const DEPENDENCY_SEGMENTS = new Set([
  '.venv',
  'env',
  'node_modules',
  'site-packages',
  'venv',
  'vendor/bundle',
]);

const VENDORED_SEGMENTS = new Set([
  'external',
  'third-party',
  'third_party',
  'vendor',
  'vendored',
]);

const BUILD_SEGMENTS = new Set([
  '.cache',
  '.next',
  '.parcel-cache',
  '.turbo',
  '.vite',
  'artifacts',
  'build',
  'coverage',
  'dist',
  'out',
  'release',
  'releases',
  'target',
]);

const GENERATED_SEGMENTS = new Set([
  '__generated__',
  'autogen',
  'auto-generated',
  'codegen',
  'generated',
  'gen',
]);

const AUTOMATION_MARKERS = [
  '[bot]',
  'actions@',
  'automation',
  'automated',
  'buildkite',
  'circleci',
  'codecov',
  'dependabot',
  'github actions',
  'github-actions',
  'jenkins',
  'renovate',
  'release-please',
  'semantic-release',
  'travis',
];

const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true });
const commitTrailerCache = new Map();
const warnings = [];
let repositoryRoot;

function samePath(left, right) {
  const normalize = (value) => path.normalize(path.resolve(value));
  const leftValue = normalize(left);
  const rightValue = normalize(right);
  return process.platform === 'win32'
    ? leftValue.toLowerCase() === rightValue.toLowerCase()
    : leftValue === rightValue;
}

function gitOutput(args, cwd = repositoryRoot) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
}

function gitBytes(args, cwd = repositoryRoot) {
  return execFileSync('git', args, {
    cwd,
    maxBuffer: 256 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
}

function findRepositoryRoot() {
  const currentDirectory = process.cwd();
  const reportedRoot = gitOutput(['rev-parse', '--show-toplevel'], currentDirectory).trim();
  if (!reportedRoot) {
    throw new Error('Could not determine the repository root.');
  }
  if (!samePath(currentDirectory, reportedRoot)) {
    throw new Error('Run scripts/count-lines.mjs from the repository root.');
  }
  return path.resolve(reportedRoot);
}

function makeStats() {
  return {
    files: 0,
    lines: 0,
    nonBlank: 0,
    bytes: 0,
  };
}

function makeAttribution() {
  return {
    lines: 0,
    nonBlank: 0,
    agentLines: 0,
    humanOtherLines: 0,
    agentNonBlank: 0,
    humanOtherNonBlank: 0,
  };
}

function addStats(target, source) {
  target.files += source.files;
  target.lines += source.lines;
  target.nonBlank += source.nonBlank;
  target.bytes += source.bytes;
}

function addAttribution(target, isAgent, isNonBlank) {
  target.lines += 1;
  if (isNonBlank) {
    target.nonBlank += 1;
  }
  if (isAgent) {
    target.agentLines += 1;
    if (isNonBlank) {
      target.agentNonBlank += 1;
    }
  } else {
    target.humanOtherLines += 1;
    if (isNonBlank) {
      target.humanOtherNonBlank += 1;
    }
  }
}

function splitGitPath(relativePath) {
  return relativePath.split('/').filter(Boolean);
}

function isLockfile(relativePath) {
  const basename = path.posix.basename(relativePath).toLowerCase();
  return (
    LOCKFILE_NAMES.has(basename) ||
    basename.endsWith('.lock') ||
    basename.endsWith('.lock.json') ||
    basename.endsWith('.lock.yaml') ||
    basename.endsWith('.lock.yml')
  );
}

function hasSegment(segments, candidates) {
  return segments.some((segment) => candidates.has(segment));
}

function pathExclusion(relativePath) {
  const lowerPath = relativePath.toLowerCase();
  const segments = splitGitPath(lowerPath);

  if (
    hasSegment(segments, DEPENDENCY_SEGMENTS) ||
    lowerPath.startsWith('vendor/bundle/') ||
    lowerPath.includes('/vendor/bundle/')
  ) {
    return 'dependency';
  }
  if (isLockfile(relativePath)) {
    return 'lockfile';
  }
  if (hasSegment(segments, VENDORED_SEGMENTS)) {
    return 'vendored';
  }
  if (
    hasSegment(segments, BUILD_SEGMENTS) ||
    path.posix.basename(lowerPath).endsWith('.map')
  ) {
    return 'build-output';
  }
  return null;
}

function isBinaryExtension(relativePath) {
  return BINARY_EXTENSIONS.has(path.posix.extname(relativePath).toLowerCase());
}

function decodeUtf8(buffer, relativePath) {
  if (isBinaryExtension(relativePath) || buffer.includes(0)) {
    return { isBinary: true, text: null };
  }
  try {
    return { isBinary: false, text: UTF8_DECODER.decode(buffer) };
  } catch {
    return { isBinary: true, text: null };
  }
}

function splitLines(text) {
  if (text.length === 0) {
    return [];
  }
  const lines = text.split(/\r\n|\n|\r/u);
  if (lines.at(-1) === '') {
    lines.pop();
  }
  return lines;
}

function isNonBlank(line) {
  return /\S/u.test(line.replace(/^\uFEFF/u, ''));
}

function isGenerated(relativePath) {
  const lowerPath = relativePath.toLowerCase();
  const segments = splitGitPath(lowerPath);
  const basename = path.posix.basename(lowerPath);
  return (
    hasSegment(segments, GENERATED_SEGMENTS) ||
    basename.includes('.generated.') ||
    basename.includes('.generated-') ||
    basename.includes('.gen.') ||
    basename.endsWith('.generated') ||
    basename.endsWith('.gen') ||
    basename.startsWith('generated-')
  );
}

function classifyIncluded(relativePath) {
  if (isGenerated(relativePath)) {
    return 'generated';
  }

  const lowerPath = relativePath.toLowerCase();
  const segments = splitGitPath(lowerPath);
  const basename = path.posix.basename(lowerPath);
  const extension = path.posix.extname(basename);
  const testPath = /(^|\/)(test|tests|__tests__|spec|specs)(\/|$)/u.test(lowerPath);
  const testName = /(?:^|[._-])(test|spec)(?:[._-]|$)/u.test(basename);

  if (testPath || testName || segments.some((segment) => segment.endsWith('.test'))) {
    return 'tests';
  }
  if (MARKUP_EXTENSIONS.has(extension)) {
    return 'styles/markup';
  }
  if (SOURCE_EXTENSIONS.has(extension)) {
    return 'source';
  }
  return 'other';
}

function automationIdentity(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  if (normalized.includes('bot@') || normalized.includes('@bot')) {
    return true;
  }
  if (/\bbot\b/u.test(normalized)) {
    return true;
  }
  return AUTOMATION_MARKERS.some((marker) => normalized.includes(marker));
}

function trailerNamesAgent(commitMessage) {
  const trailerPattern = /^\s*co-authored-by:\s*(.+?)\s*$/gimu;
  for (const match of commitMessage.matchAll(trailerPattern)) {
    if (/\b(agent|automation|automated|claude|codex|copilot|gpt|openai|bot)\b/iu.test(match[1])) {
      return true;
    }
  }
  return false;
}

function commitHasAgentTrailer(commitHash) {
  if (/^0+$/u.test(commitHash)) {
    return false;
  }
  if (commitTrailerCache.has(commitHash)) {
    return commitTrailerCache.get(commitHash);
  }

  let hasTrailer = false;
  try {
    const message = gitOutput(['show', '-s', '--format=%B', commitHash]);
    hasTrailer = trailerNamesAgent(message);
  } catch {
    warnings.push(`Could not read commit message for blame commit ${commitHash}.`);
  }
  commitTrailerCache.set(commitHash, hasTrailer);
  return hasTrailer;
}

function parseBlame(output) {
  const records = [];
  let current = null;
  for (const line of output.split(/\r?\n/u)) {
    const header = /^(?<hash>[0-9a-f]{40,64})\s+\d+\s+\d+(?:\s+\d+)?$/u.exec(line);
    if (header) {
      current = {
        hash: header.groups.hash,
        author: '',
        authorMail: '',
        committer: '',
        committerMail: '',
      };
      continue;
    }
    if (!current) {
      continue;
    }
    if (line.startsWith('author ')) {
      current.author = line.slice('author '.length);
    } else if (line.startsWith('author-mail ')) {
      current.authorMail = line.slice('author-mail '.length);
    } else if (line.startsWith('committer ')) {
      current.committer = line.slice('committer '.length);
    } else if (line.startsWith('committer-mail ')) {
      current.committerMail = line.slice('committer-mail '.length);
    } else if (line.startsWith('\t')) {
      records.push({ ...current, text: line.slice(1) });
    }
  }
  return records;
}

function blameFile(relativePath, expectedLines) {
  if (expectedLines.length === 0) {
    return [];
  }
  try {
    const output = gitOutput(['blame', '--line-porcelain', '--', relativePath]);
    const records = parseBlame(output);
    if (records.length !== expectedLines.length) {
      warnings.push(
        `Blame returned ${records.length} lines for ${relativePath}; counted ${expectedLines.length}.`,
      );
      return [];
    }
    return records;
  } catch {
    warnings.push(`Could not run git blame for ${relativePath}.`);
    return [];
  }
}

function blameRecordIsAgent(record) {
  if (!record) {
    return false;
  }
  if (
    automationIdentity(record.author) ||
    automationIdentity(record.authorMail) ||
    automationIdentity(record.committer) ||
    automationIdentity(record.committerMail)
  ) {
    return true;
  }
  return commitHasAgentTrailer(record.hash);
}

function inspectTrackedFile(relativePath) {
  const absolutePath = path.join(repositoryRoot, ...relativePath.split('/'));
  const staticExclusion = pathExclusion(relativePath);
  let buffer;
  try {
    buffer = readFileSync(absolutePath);
  } catch {
    warnings.push(`Could not read tracked file ${relativePath}.`);
    return {
      scope: 'excluded',
      name: staticExclusion ?? 'unreadable',
      bytes: 0,
      lines: [],
      blame: [],
    };
  }

  const decoded = decodeUtf8(buffer, relativePath);
  if (decoded.isBinary) {
    return {
      scope: 'excluded',
      name: staticExclusion ?? 'binary',
      bytes: buffer.length,
      lines: [],
      blame: [],
    };
  }

  const lines = splitLines(decoded.text);
  if (staticExclusion) {
    return {
      scope: 'excluded',
      name: staticExclusion,
      bytes: buffer.length,
      lines,
      blame: [],
    };
  }

  const category = classifyIncluded(relativePath);
  return {
    scope: 'project',
    name: category,
    bytes: buffer.length,
    lines,
    blame: blameFile(relativePath, lines),
  };
}

function makeRowStats(lines, bytes) {
  return {
    files: 1,
    lines: lines.length,
    nonBlank: lines.reduce((count, line) => count + (isNonBlank(line) ? 1 : 0), 0),
    bytes,
  };
}

function addFileToStats(stats, file) {
  const fileStats = makeRowStats(file.lines, file.bytes);
  addStats(stats[file.scope][file.name], fileStats);
}

function sumStats(statsByName, names) {
  const result = makeStats();
  for (const name of names) {
    addStats(result, statsByName[name]);
  }
  return result;
}

function sumAttribution(attributionByName, names) {
  const result = makeAttribution();
  for (const name of names) {
    const source = attributionByName[name];
    result.lines += source.lines;
    result.nonBlank += source.nonBlank;
    result.agentLines += source.agentLines;
    result.humanOtherLines += source.humanOtherLines;
    result.agentNonBlank += source.agentNonBlank;
    result.humanOtherNonBlank += source.humanOtherNonBlank;
  }
  return result;
}

function assertReconciles(label, counted, attributed) {
  if (
    counted.lines !== attributed.lines ||
    counted.nonBlank !== attributed.nonBlank ||
    attributed.agentLines + attributed.humanOtherLines !== counted.lines ||
    attributed.agentNonBlank + attributed.humanOtherNonBlank !== counted.nonBlank
  ) {
    throw new Error(
      `${label} attribution does not reconcile: counted ${counted.lines}/${counted.nonBlank}, ` +
        `attributed ${attributed.lines}/${attributed.nonBlank}.`,
    );
  }
}

function tsvCell(value) {
  return String(value ?? '').replace(/[\t\r\n]/gu, ' ');
}

function printReport(projectStats, excludedStats, projectAttribution, handwrittenStats, handwrittenAttribution) {
  const grandStats = sumStats(
    { ...projectStats, ...excludedStats },
    [...CATEGORY_NAMES, ...EXCLUDED_NAMES],
  );
  const trackedFiles = grandStats.files;
  const binaryStats = excludedStats.binary;
  const columns = [
    'record',
    'scope',
    'name',
    'files',
    'lines',
    'nonBlank',
    'bytes',
    'agentLines',
    'humanOtherLines',
    'agentNonBlank',
    'humanOtherNonBlank',
  ];
  console.log(columns.join('\t'));

  const printStatsRow = (record, scope, name, stats, attribution = null) => {
    console.log(
      [
        record,
        scope,
        name,
        stats.files,
        stats.lines,
        stats.nonBlank,
        stats.bytes,
        attribution?.agentLines ?? 0,
        attribution?.humanOtherLines ?? 0,
        attribution?.agentNonBlank ?? 0,
        attribution?.humanOtherNonBlank ?? 0,
      ]
        .map(tsvCell)
        .join('\t'),
    );
  };

  for (const name of CATEGORY_NAMES) {
    printStatsRow('row', 'project', name, projectStats[name], projectAttribution[name]);
  }
  for (const name of EXCLUDED_NAMES) {
    printStatsRow('row', 'excluded', name, excludedStats[name]);
  }
  printStatsRow('summary', 'project', 'total', projectStats.total, projectAttribution.total);
  printStatsRow('summary', 'project', 'hand-written-total', handwrittenStats, handwrittenAttribution);
  printStatsRow('summary', 'all', 'grand-total', grandStats);
  printStatsRow('summary', 'all', 'tracked-files', { ...makeStats(), files: trackedFiles });
  printStatsRow('summary', 'excluded', 'binary-files', binaryStats);
  printStatsRow('attribution', 'project', 'all-included', projectStats.total, projectAttribution.total);
  printStatsRow('attribution', 'project', 'hand-written', handwrittenStats, handwrittenAttribution);
}

function run() {
  repositoryRoot = findRepositoryRoot();
  const trackedOutput = gitBytes(['ls-files', '--cached', '-z']);
  const trackedPaths = trackedOutput
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
    .map((relativePath) => relativePath.replaceAll('\\', '/'));

  const projectStats = Object.fromEntries(
    [...CATEGORY_NAMES, 'total'].map((name) => [name, makeStats()]),
  );
  const excludedStats = Object.fromEntries(EXCLUDED_NAMES.map((name) => [name, makeStats()]));
  const projectAttribution = Object.fromEntries(
    [...CATEGORY_NAMES, 'total'].map((name) => [name, makeAttribution()]),
  );
  const handwrittenNames = CATEGORY_NAMES.filter((name) => name !== 'generated');
  const categoryAttribution = Object.fromEntries(
    CATEGORY_NAMES.map((name) => [name, makeAttribution()]),
  );

  for (const relativePath of trackedPaths) {
    const file = inspectTrackedFile(relativePath);
    addFileToStats(file.scope === 'project' ? { project: projectStats } : { excluded: excludedStats }, file);

    if (file.scope !== 'project') {
      continue;
    }

    addStats(projectStats.total, makeRowStats(file.lines, file.bytes));
    const attributionRecords = file.blame.length === file.lines.length ? file.blame : [];
    for (let index = 0; index < file.lines.length; index += 1) {
      const isAgent = blameRecordIsAgent(attributionRecords[index]);
      const nonBlank = isNonBlank(file.lines[index]);
      addAttribution(categoryAttribution[file.name], isAgent, nonBlank);
      addAttribution(projectAttribution[file.name], isAgent, nonBlank);
      addAttribution(projectAttribution.total, isAgent, nonBlank);
    }
  }

  for (const name of CATEGORY_NAMES) {
    projectAttribution[name] = categoryAttribution[name];
  }
  const handwrittenStats = sumStats(projectStats, handwrittenNames);
  const handwrittenAttribution = sumAttribution(categoryAttribution, handwrittenNames);
  assertReconciles('All included project', projectStats.total, projectAttribution.total);
  assertReconciles('Hand-written', handwrittenStats, handwrittenAttribution);
  printReport(
    projectStats,
    excludedStats,
    projectAttribution,
    handwrittenStats,
    handwrittenAttribution,
  );

  for (const warning of [...new Set(warnings)]) {
    console.error(`warning: ${warning}`);
  }
}

try {
  run();
} catch (error) {
  console.error(`count-lines: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}


