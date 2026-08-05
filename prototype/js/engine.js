// ABDM-M3 simulated download system. Mirrors the original engine's observable behavior:
// statuses (Added/Downloading/Paused/Error/Completed + IDLE/Preparing/Resuming/Retrying/Waiting),
// multi-part downloads w/ dynamic part creation, queues w/ maxConcurrent + scheduler + auto-stop +
// shutdown-on-completion, global/per-item speed limits, retries, error taxonomy. No real network.

const M = 1024 * 1024;
export function hash32(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
export function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

export function nameFromUrl(url) {
  try {
    const u = new URL(url);
    const last = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || '');
    if (last && /\.[a-z0-9]{1,5}$/i.test(last)) return last;
    if (last) return last + '.html';
    return (u.hostname || 'download') + '.html';
  } catch { return 'download.bin'; }
}
const EXT_KIND = [
  [/^(zip|rar|7z|tar|gz|bz2|xz|iso|dmg|tgz)$/i, 'archive'], [/^(apk|exe|msi|bat|sh|jar|app|deb|rpm|bin|appimage)$/i, 'program'],
  [/^(mp4|avi|mkv|mov|wmv|flv|webm|m4v|3gp|mpeg|ts)$/i, 'video'], [/^(mp3|wav|aac|flac|ogg|aiff|wma|m4a)$/i, 'audio'],
  [/^(jpg|jpeg|png|gif|bmp|tiff|tif|svg|webp|heic|ico|raw|psd)$/i, 'image'], [/^(doc|docx|pdf|txt|rtf|odt|xls|xlsx|ppt|pptx|csv|epub|pages)$/i, 'document'],
];
export function fileKind(name) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  for (const [re, kind] of EXT_KIND) if (re.test(ext)) return kind;
  return 'other';
}
export function extOf(name) { const p = name.split('.'); return p.length > 1 ? p.pop().toLowerCase() : ''; }

// Deterministic simulated HEAD request. Test hooks in hostname/path: 404, 403, 401, 500, timeout,
// noresume, auth, slow, flaky, huge, nosize.
export function linkCheck(url) {
  const h = hash32(url); const r = rng(h);
  let u; try { u = new URL(url); } catch { return { ok: false, error: { kind: 'invalid_url' } }; }
  const s = url.toLowerCase();
  const err = k => ({ ok: false, error: { kind: k } });
  if (s.includes('404')) return err('http_404');
  if (s.includes('403')) return err('http_403');
  if (s.includes('401')) return { ok: false, requiresAuth: true, error: { kind: 'http_401' } };
  if (s.includes('500') || s.includes('503')) return err('http_5xx');
  if (s.includes('timeout')) return err('timeout');
  if (s.includes('unknownhost') || u.hostname.endsWith('.invalid')) return err('unknown_host');
  const name = nameFromUrl(url);
  const size = s.includes('nosize') ? null : s.includes('huge') ? Math.floor(6 * 1024 + r() * 4 * 1024) * M : Math.floor((3 + r() * 2400) * M) / (r() < 0.5 ? 8 : 1) | 0;
  return {
    ok: true, name, size,
    resumeSupport: s.includes('noresume') ? false : r() > 0.08,
    requiresAuth: s.includes('auth'),
    baseSpeed: (s.includes('slow') ? 0.35 : (2.5 + r() * 15)) * M, // bytes/sec ceiling from "server"
    flaky: s.includes('flaky') ? 0.03 : (r() < 0.06 ? 0.004 : 0),
    etag: 'W/"' + h.toString(16) + '"',
  };
}

export const ERROR_KEYS = {
  http_4xx: 'download_error_reason_http_4xx', http_401: 'download_error_reason_http_401', http_403: 'download_error_reason_http_403',
  http_404: 'download_error_reason_http_404', http_407: 'download_error_reason_http_407', http_429: 'download_error_reason_http_429',
  http_5xx: 'download_error_reason_http_5xx', http_503: 'download_error_reason_http_503', http_default: 'download_error_reason_http_default',
  etag: 'download_error_reason_changed_etag', size_changed: 'download_error_reason_changed_size', web_page: 'download_error_reason_changed_web',
  no_space: 'download_error_reason_no_space', destination: 'download_error_reason_destination', resume_changed: 'download_error_reason_server_resume_change',
  timeout: 'download_error_reason_timeout', unknown_host: 'download_error_reason_unknown_host', connection_reset: 'download_error_reason_connection_reset',
  ssl: 'download_error_reason_ssl_verification_failed', default: 'download_error_reason_default', invalid_url: 'download_error_reason_default',
};

export function fakeChecksum(seedStr, algo) {
  const len = { 'MD5': 32, 'SHA-1': 40, 'SHA-256': 64, 'SHA-384': 96, 'SHA-512': 128 }[algo] || 64;
  let out = ''; const r = rng(hash32(seedStr + algo));
  while (out.length < len) out += Math.floor(r() * 16).toString(16);
  return out;
}

// ---------- formatting ----------
export function formatBytes(bytes, unitCfg = { base: 'bytes', factor: 1024 }, dec = 1) {
  if (bytes == null || isNaN(bytes)) return null;
  let v = unitCfg.base === 'bits' ? bytes * 8 : bytes;
  const f = unitCfg.factor;
  const units = unitCfg.base === 'bits'
    ? (f === 1024 ? ['b', 'Kib', 'Mib', 'Gib', 'Tib'] : ['b', 'kb', 'Mb', 'Gb', 'Tb'])
    : (f === 1024 ? ['B', 'KiB', 'MiB', 'GiB', 'TiB'] : ['B', 'kB', 'MB', 'GB', 'TB']);
  let i = 0; while (v >= f && i < units.length - 1) { v /= f; i++; }
  return (i === 0 ? Math.round(v) : v.toFixed(dec)) + ' ' + units[i];
}
export function formatEta(seconds) {
  if (seconds == null || !isFinite(seconds) || seconds < 0) return null;
  const s = Math.round(seconds);
  if (s < 60) return s + 's';
  if (s < 3600) return Math.floor(s / 60) + 'm ' + (s % 60) + 's';
  if (s < 86400) return Math.floor(s / 3600) + 'h ' + Math.floor((s % 3600) / 60) + 'm';
  return Math.floor(s / 86400) + 'd ' + Math.floor((s % 86400) / 3600) + 'h';
}

// ---------- engine ----------
let _id = 1;
export function createEngine({ emit, getCfg }) {
  const E = {
    downloads: [], queues: [], nextId: () => Date.now() * 100 + (_id++ % 100),
    byId(id) { return E.downloads.find(d => d.id === id); },
    queueById(id) { return E.queues.find(q => q.id === id); },
    queueOf(item) { return E.queues.find(q => q.items.includes(item.id)); },

    createQueue(name) {
      const q = { id: E.nextId(), name, maxConcurrent: 2, items: [], active: false, stopOnEmpty: true, shutdownOnFinish: false, scheduler: { days: [1, 2, 3, 4, 5, 6, 0], startEnabled: false, start: '09:00', endEnabled: false, end: '23:00' }, _lastSchedCheck: '' };
      E.queues.push(q); return q;
    },

    add(info, opts = {}) {
      const it = {
        id: E.nextId(), url: info.url, name: opts.name || info.name, folder: opts.folder,
        categoryId: opts.categoryId ?? null, status: 'added', sub: 'idle', percent: 0, downloaded: 0,
        size: info.size ?? null, resumeSupport: info.resumeSupport ?? null, baseSpeed: info.baseSpeed || 5 * M,
        flaky: info.flaky || 0, etag: info.etag, parts: [], speed: 0, _speedSmooth: 0, timeLeft: null,
        dateAdded: Date.now(), startedAt: null, completedAt: null, activeTime: 0, error: null, retries: 0,
        threadCount: 0, speedLimit: 0, completionDialog: null, shutdownOnFinish: false,
        username: opts.username || '', password: opts.password || '', downloadPage: opts.downloadPage || '',
        checksum: opts.checksum || '', userAgent: opts.userAgent || '', waiting: false,
      };
      E.downloads.push(it);
      if (opts.queueId != null) { const q = E.queueById(opts.queueId); if (q && !q.items.includes(it.id)) q.items.push(it.id); }
      emit('added', it);
      return it;
    },

    partsFor(it) {
      const cfg = getCfg();
      const n = Math.max(1, it.threadCount || cfg.threadCount || 8);
      if (it.size == null || !it.resumeSupport) return [{ id: 1, offset: 0, length: it.size, got: 0, status: 'connecting', _conn: 0 }];
      const per = Math.floor(it.size / n);
      return Array.from({ length: n }, (_, i) => ({ id: i + 1, offset: i * per, length: i === n - 1 ? it.size - per * i : per, got: 0, status: 'idle', _conn: 0 }));
    },

    start(id, { fromQueue = false } = {}) {
      const it = E.byId(id); if (!it || it.status === 'completed' || it.status === 'downloading') return;
      const cfg = getCfg();
      if (!fromQueue && !E.queueOf(it)) {
        const activeLoose = E.downloads.filter(d => d.status === 'downloading' && !E.queueOf(d)).length;
        if (cfg.maxConcurrentDownloads > 0 && activeLoose >= cfg.maxConcurrentDownloads) { it.status = 'downloading'; it.sub = 'idle'; it.waiting = true; return; }
      }
      it.status = 'downloading'; it.waiting = false; it.error = null;
      it.sub = it.parts.length && it.resumeSupport && it.downloaded > 0 ? 'resuming' : 'preparing';
      it._prepT = 0;
      if (!it.parts.length || !it.resumeSupport) { it.parts = E.partsFor(it); it.downloaded = 0; }
      it.startedAt = it.startedAt || Date.now();
      emit('started', it);
    },
    pause(id) {
      const it = E.byId(id); if (!it || it.status !== 'downloading') return;
      it.status = 'paused'; it.sub = 'idle'; it.speed = 0; it._speedSmooth = 0; it.waiting = false;
      it.parts.forEach(p => { if (p.status === 'receiving' || p.status === 'connecting') p.status = 'disconnected'; });
      if (!it.resumeSupport) { it.downloaded = 0; it.percent = 0; it.parts = []; }
      emit('paused', it);
    },
    cancel(id) { const it = E.byId(id); if (!it) return; const cfg = getCfg(); E.pause(id); if (cfg.deletePartialFileOnDownloadCancellation) { it.downloaded = 0; it.percent = 0; it.parts = []; } },
    restart(id) { const it = E.byId(id); if (!it) return; it.downloaded = 0; it.percent = 0; it.parts = []; it.retries = 0; it.completedAt = null; if (it.status === 'completed') it.status = 'added'; E.start(id); emit('restarted', it); },
    remove(ids) {
      const removed = [];
      for (const id of ids) { const i = E.downloads.findIndex(d => d.id === id); if (i >= 0) { removed.push(E.downloads[i]); E.downloads.splice(i, 1); } }
      E.queues.forEach(q => q.items = q.items.filter(i => !ids.includes(i)));
      if (removed.length) emit('deleted', removed);
      return removed;
    },

    startQueue(id) { const q = E.queueById(id); if (!q || q.active) return; q.active = true; emit('queue-started', q); },
    stopQueue(id) {
      const q = E.queueById(id); if (!q || !q.active) return; q.active = false;
      q.items.forEach(i => { const it = E.byId(i); if (it && it.status === 'downloading') E.pause(i); });
      emit('queue-stopped', q);
    },
    stopAll() {
      E.queues.forEach(q => { if (q.active) E.stopQueue(q.id); });
      E.downloads.forEach(d => { if (d.status === 'downloading') E.pause(d.id); });
      emit('stopped-all');
    },

    _finish(it) {
      it.status = 'completed'; it.sub = 'idle'; it.percent = 100; it.speed = 0; it.completedAt = Date.now();
      if (it.size == null) it.size = it.downloaded;
      it.parts.forEach(p => p.status = 'completed');
      emit('finished', it);
      if (it.shutdownOnFinish) emit('power-action', { reason: 'download', item: it });
      const q = E.queueOf(it);
      if (q && q.active) {
        const remaining = q.items.map(E.byId).filter(d => d && d.status !== 'completed');
        if (!remaining.length) {
          emit('queue-finished', q);
          if (q.shutdownOnFinish) emit('power-action', { reason: 'queue', queue: q });
          if (q.stopOnEmpty) { q.active = false; emit('queue-stopped', q); }
        }
      }
    },
    _fail(it, kind) {
      const cfg = getCfg();
      it.retries++;
      if (it.retries <= (cfg.maxDownloadRetryCount ?? 3)) { it.sub = 'retrying'; it._retryT = 1.2 + Math.random() * 2; return; }
      it.status = 'error'; it.sub = 'idle'; it.speed = 0; it.error = { kind, at: Date.now() };
      it.parts.forEach(p => { if (p.status !== 'completed') p.status = 'disconnected'; });
      emit('failed', it);
    },

    tick(dt) {
      const cfg = getCfg();
      const now = new Date();
      // queue scheduler (check each ~2s)
      for (const q of E.queues) {
        const sched = q.scheduler; if (!sched) continue;
        const stamp = now.getHours() + ':' + now.getMinutes();
        if (q._lastSchedCheck === stamp) continue;
        q._lastSchedCheck = stamp;
        const hm = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
        const dayOk = sched.days.includes(now.getDay());
        if (sched.startEnabled && dayOk && hm === sched.start && !q.active) E.startQueue(q.id);
        if (sched.endEnabled && hm === sched.end && q.active) { E.stopQueue(q.id); if (q.shutdownOnFinish) emit('power-action', { reason: 'queue-end', queue: q }); }
      }
      // queue slot management
      for (const q of E.queues) {
        if (!q.active) continue;
        const items = q.items.map(E.byId).filter(Boolean);
        let active = items.filter(d => d.status === 'downloading' && !d.waiting).length;
        for (const d of items) {
          if (active >= q.maxConcurrent) break;
          if (d.status !== 'completed' && d.status !== 'downloading') { E.start(d.id, { fromQueue: true }); active++; }
        }
        items.forEach(d => { d.waiting = d.status === 'downloading' && items.filter(x => x.status === 'downloading' && !x.waiting).indexOf(d) === -1 && active > q.maxConcurrent; });
      }
      // loose-download concurrency waiting list
      const loose = E.downloads.filter(d => !E.queueOf(d) && d.status === 'downloading');
      if (cfg.maxConcurrentDownloads > 0) {
        let slots = cfg.maxConcurrentDownloads;
        for (const d of loose) { if (!d.waiting && slots > 0) slots--; else if (d.waiting && slots > 0) { d.waiting = false; slots--; } }
      } else loose.forEach(d => { if (d.waiting) d.waiting = false; });

      const activeItems = E.downloads.filter(d => d.status === 'downloading' && !d.waiting);
      const globalLimit = cfg.speedLimit > 0 ? cfg.speedLimit : Infinity;
      const share = activeItems.length ? globalLimit / activeItems.length : Infinity;

      for (const it of activeItems) {
        if (it.sub === 'retrying') { it._retryT -= dt; if (it._retryT <= 0) { it.sub = 'preparing'; it._prepT = 0; if (!it.resumeSupport) { it.parts = E.partsFor(it); it.downloaded = 0; } } continue; }
        if (it.sub === 'preparing' || it.sub === 'resuming') {
          it._prepT = (it._prepT || 0) + dt;
          if (it._prepT > 0.5 + (hash32(it.url) % 10) / 12) { it.sub = 'downloading'; it.parts.forEach(p => { if (p.status === 'idle' || p.status === 'disconnected') p.status = 'connecting'; }); }
          continue;
        }
        // random mid-flight failure for flaky sources
        if (it.flaky && Math.random() < it.flaky * dt) { E._fail(it, Math.random() < 0.5 ? 'connection_reset' : 'timeout'); continue; }
        const perItemLimit = it.speedLimit > 0 ? it.speedLimit : Infinity;
        const jitter = 0.75 + 0.25 * Math.sin(Date.now() / 900 + it.id % 7) + Math.random() * 0.18;
        const target = Math.min(it.baseSpeed * jitter, perItemLimit, share);
        it._speedSmooth += (target - it._speedSmooth) * Math.min(1, dt * 1.8);
        const budget = it._speedSmooth * dt;
        const open = it.parts.filter(p => p.status === 'connecting' || p.status === 'receiving');
        // connect
        it.parts.forEach(p => { if (p.status === 'connecting') { p._conn += dt; if (p._conn > 0.3 + (p.id % 5) * 0.22) p.status = 'receiving'; } });
        const rec = it.parts.filter(p => p.status === 'receiving');
        if (rec.length) {
          const per = budget / rec.length;
          for (const p of rec) {
            const room = p.length == null ? per : Math.min(per, p.length - p.got);
            p.got += room; it.downloaded += room;
            if (p.length != null && p.got >= p.length) {
              p.status = 'completed'; p.got = p.length;
              if (cfg.dynamicPartCreation && it.resumeSupport) {
                const big = it.parts.filter(x => x.status === 'receiving').sort((a, b) => (b.length - b.got) - (a.length - a.got))[0];
                if (big && big.length - big.got > 4 * M) {
                  const remain = big.length - big.got, half = Math.floor(remain / 2);
                  big.length -= half;
                  it.parts.push({ id: Math.max(...it.parts.map(x => x.id)) + 1, offset: big.offset + big.length, length: half, got: 0, status: 'connecting', _conn: 0 });
                }
              }
            }
          }
        }
        it.activeTime += dt;
        it.speed = it._speedSmooth * (rec.length ? 1 : 0);
        if (it.size != null) {
          it.percent = Math.min(100, it.downloaded / it.size * 100);
          it.timeLeft = it.speed > 1 ? (it.size - it.downloaded) / it.speed : null;
          if (it.downloaded >= it.size) E._finish(it);
        } else {
          it.percent = null; it.timeLeft = null;
          if (it.downloaded > 0 && Math.random() < dt / 40) { it.size = it.downloaded; E._finish(it); } // unknown-size stream eventually ends
        }
      }
      // idle speeds decay
      E.downloads.forEach(d => { if (d.status !== 'downloading' || d.waiting) { d.speed = 0; } });
    },

    globalSpeed() { return E.downloads.reduce((s, d) => s + (d.status === 'downloading' ? d.speed : 0), 0); },
    activeCount() { return E.downloads.filter(d => d.status === 'downloading').length; },
    avgSpeed(it) { return it.activeTime > 0.5 ? it.downloaded / it.activeTime : it.speed; },

    serialize() {
      return {
        downloads: E.downloads.map(d => ({ ...d, parts: d.parts.map(p => ({ ...p })), speed: 0, _speedSmooth: 0 })),
        queues: E.queues.map(q => ({ ...q, active: q.active })),
      };
    },
    load(data) {
      if (!data) return;
      E.downloads = (data.downloads || []).map(d => ({ ...d, speed: 0, _speedSmooth: 0, sub: d.status === 'downloading' ? 'preparing' : 'idle', waiting: false }));
      E.downloads.forEach(d => { if (d.status === 'downloading') d.status = 'paused'; }); // app restart pauses actives, like a real restart
      E.queues = (data.queues || []).map(q => ({ _lastSchedCheck: '', ...q, active: false }));
    },
  };
  return E;
}
