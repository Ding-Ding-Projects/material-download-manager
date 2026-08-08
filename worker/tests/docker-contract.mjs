import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const dockerfile = readFileSync(new URL("../Dockerfile", import.meta.url), "utf8");
const compose = readFileSync(new URL("../compose.yaml", import.meta.url), "utf8");

assert.match(dockerfile, /^FROM node:[^\s]+ AS dependencies$/mu);
assert.match(dockerfile, /^FROM dependencies AS build$/mu);
assert.match(dockerfile, /^FROM node:[^\s]+ AS production-dependencies$/mu);
assert.match(dockerfile, /^FROM node:[^\s]+ AS runtime$/mu);
assert.match(dockerfile, /npm ci --ignore-scripts --no-audit --no-fund/u);
assert.match(dockerfile, /npm ci --omit=dev --ignore-scripts/u);
assert.match(dockerfile, /useradd --uid 10001 --gid 10001[^\n]+--shell \/usr\/sbin\/nologin/u);
assert.match(dockerfile, /^USER 10001:10001$/mu);
assert.match(dockerfile, /^ENTRYPOINT \["node", "dist\/cli\.js"\]$/mu);
assert.match(dockerfile, /^HEALTHCHECK[^\n]+\\$/mu);
assert.doesNotMatch(dockerfile, /(?:id_rsa|authorized_keys|\.pem|Docker\.sock)/iu);

for (const required of [
  "read_only: true",
  "cap_drop:",
  "- ALL",
  "no-new-privileges:true",
  "pids_limit: 64",
  'cpus: "1.0"',
  "mem_limit: 512m",
  "memswap_limit: 512m",
  '127.0.0.1:${MDM_WORKER_HOST_PORT:-2222}:2222',
  "/tmp:rw,noexec,nosuid,nodev,size=16m,mode=1777",
  'max-size: "1m"',
  'max-file: "2"',
  "com.material-download-manager.owner:",
  "com.material-download-manager.component:",
  "com.material-download-manager.managed:",
]) assert.equal(compose.includes(required), true, required);

assert.doesNotMatch(compose, /\/var\/run\/docker\.sock/iu);
assert.doesNotMatch(compose, /^\s*(?:privileged:\s*true|network_mode:\s*host|pid:\s*host|ipc:\s*host|devices:|extra_hosts:)/mu);
const serviceVolumes = /^    volumes:\s*\n((?:      - [^\n]+\n)+)/mu.exec(compose)?.[1] ?? "";
assert.notEqual(serviceVolumes, "");
assert.doesNotMatch(serviceVolumes, /^\s*-\s*(?:\.|\/|[A-Za-z]:\\)[^:\n]*:/mu);
assert.match(compose, /^\s+- worker-state:\/var\/lib\/mdm-worker$/mu);
assert.match(compose, /^\s+worker-state:\s*$/mu);

process.stdout.write("Docker contract checks passed.\n");
