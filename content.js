const BASE = 'https://fasih-sm.bps.go.id/app/api';
const ASSIGN = BASE + '/analytic/api/v2/assignment/report-progress-by-responsibility';
const REGION = BASE + '/region/api/v1/region';
const GROUP_ID = 'a45adac1-e711-4c15-b3f9-1f30fc151565';
const SIZE_CANDIDATES = [10, 5];
const CAP = 1000, DELAY_MS = 400, DELAY_JITTER_MS = 300, MAX_RETRY = 4;

let isRunning = false;
let currentRoleId = null;
let SIZE = null;
let seenRequests = null;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const jitter = (base, spread = DELAY_JITTER_MS) => base + Math.random() * spread;

const getCookie = (n) => {
  const m = document.cookie.match(new RegExp('(^|; )' + n + '=([^;]+)'));
  return m ? decodeURIComponent(m[2]) : null;
};

const getHeaders = () => {
  const xsrf = getCookie('XSRF-TOKEN');
  return { 'Content-Type': 'application/json', 'Accept': 'application/json', ...(xsrf ? { 'X-XSRF-TOKEN': xsrf } : {}) };
};

const findArr = (j) => {
  if (Array.isArray(j)) return j;
  for (const v of Object.values(j || {})) if (Array.isArray(v)) return v;
  if (j && j.data) return findArr(j.data);
  return [];
};
const pickId = (o) => { for (const v of Object.values(o)) if (typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}/i.test(v)) return v; };
const pickCode = (o) => { let b = null; for (const [k, v] of Object.entries(o)) { const s = String(v); if (/^\d{2,}$/.test(s)) { if (/code/i.test(k)) return s; b = b == null ? s : b; } } return b; };
const pickName = (o) => { for (const k of ['name', 'nama', 'regionName', 'label', 'namaWilayah']) if (o[k]) return o[k]; for (const v of Object.values(o)) if (typeof v === 'string' && /[a-zA-Z]/.test(v) && !/^\d/.test(v) && !v.includes('-')) return v; return ''; };
const regionObj = (r2 = null, r3 = null, r4 = null) => ({ region1Id: null, region2Id: r2, region3Id: r3, region4Id: r4, region5Id: null, region6Id: null, region7Id: null, region8Id: null, region9Id: null, region10Id: null });

function sendProgress(text, logType = 'info', statusText = null) {
  const msg = { type: 'PROGRESS', text, logType };
  if (statusText) msg.statusText = statusText;
  chrome.runtime.sendMessage(msg).catch(() => {});
  chrome.storage.session.get('fasih').then(s => {
    const prev = s.fasih || {};
    const log = prev.log || [];
    log.push({ text, logType });
    if (log.length > 500) log.splice(0, log.length - 500);
    const update = { ...prev, log };
    if (statusText) { update.state = 'running'; update.statusText = statusText; }
    chrome.storage.session.set({ fasih: update });
  }).catch(() => {});
}

async function getRegion(level, params) {
  const url = REGION + '/' + level + '?' + new URLSearchParams(params);
  for (let a = 0; a < MAX_RETRY; a++) {
    const res = await fetch(url, { credentials: 'include', headers: getHeaders() });
    if (res.ok) return findArr(await res.json()).map(o => ({ id: pickId(o), code: pickCode(o), name: pickName(o) }));
    if ([502, 503, 504].includes(res.status)) { await sleep(jitter(2000 * 2 ** a)); continue; }
    throw new Error('region/' + level + ' HTTP ' + res.status);
  }
  return [];
}

async function callAssign(page, size, region) {
  const payload = {
    surveyPeriodId: 'fd68e454-ba45-4b85-8205-f3bf777ded24',
    surveyRoleId: currentRoleId,
    search: '', target: 'TARGET_ONLY', regionSummaryLevel: 6,
    page, size, region,
  };
  const cacheKey = JSON.stringify({ page, size, region });
  if (seenRequests && seenRequests.has(cacheKey)) return seenRequests.get(cacheKey);
  const res = await fetch(ASSIGN, { method: 'POST', credentials: 'include', headers: getHeaders(), body: JSON.stringify(payload) });
  const result = { ok: res.ok, status: res.status, json: res.ok ? await res.json() : null };
  if (seenRequests && result.ok) seenRequests.set(cacheKey, result);
  return result;
}

async function callRetry(page, size, region, label) {
  for (let a = 0; a < MAX_RETRY; a++) {
    let r;
    try { r = await callAssign(page, size, region); } catch (e) { r = { ok: false, status: 0 }; }
    if (r.ok) return r;
    if ([0, 502, 503, 504].includes(r.status)) {
      const w = jitter(2000 * 2 ** a);
      sendProgress('   retry ' + label + ' p' + page + ' (HTTP ' + r.status + ') ' + (w / 1000).toFixed(1) + 's', 'warn');
      await sleep(w);
      continue;
    }
    return r;
  }
  return { ok: false, status: 'exhausted' };
}

async function fetchAll(region, label) {
  let recs = [], page = 0, total = null, error = false;
  while (true) {
    const r = await callRetry(page, SIZE, region, label);
    if (!r.ok) { error = true; sendProgress('   gagal permanen ' + label + ' p' + page + ' (' + r.status + ')', 'error'); break; }
    total = r.json.data.totalElements;
    recs = recs.concat(r.json.data.content);
    if (r.json.data.last) break;
    if (recs.length >= CAP) break;
    page++;
    await sleep(jitter(DELAY_MS));
  }
  return { recs, total, error, capped: total != null && total > recs.length };
}


async function handleGetKabs(role, prov) {
  try {
    currentRoleId = role.id;
    let kabs = await getRegion('level2', { groupId: GROUP_ID, level1FullCode: prov });
    if (!kabs.length) kabs = await getRegion('level2', { groupId: GROUP_ID });
    if (!kabs.length || !kabs[0].id) return { ok: false, error: 'Struktur region tidak terdeteksi' };
    return { ok: true, kabs };
  } catch (e) {
    const msg = /HTTP 403/.test(e.message)
      ? 'Akses ditolak (403). Pastikan Anda membuka fasih-sm.bps.go.id/app (bukan halaman lama) dan akun ini memiliki akses ke data SE2026.'
      : /HTTP 401/.test(e.message)
        ? 'Sesi FASIH kedaluwarsa. Refresh halaman FASIH (Ctrl+R / Cmd+R) lalu coba lagi.'
        : e.message;
    return { ok: false, error: msg };
  }
}

async function handleFetchData(role, chosenKabs) {
  isRunning = true;
  currentRoleId = role.id;
  seenRequests = new Map();

  chrome.storage.session.get('fasih').then(s => {
    chrome.storage.session.set({ fasih: { ...(s.fasih || {}), log: [] } });
  }).catch(() => {});

  SIZE = null;
  let lastProbeStatus = 0;
  for (const s of SIZE_CANDIDATES) {
    const r = await callAssign(0, s, regionObj());
    lastProbeStatus = r.status;
    if (r.ok) { SIZE = s; break; }
  }
  if (!SIZE) {
    const msg = (lastProbeStatus === 403 || lastProbeStatus === 401)
      ? 'Sesi FASIH kedaluwarsa. Refresh halaman FASIH (Ctrl+R / Cmd+R) lalu coba lagi.'
      : 'Gagal: server menolak semua ukuran halaman. Periksa koneksi VPN.';
    sendProgress(msg, 'error');
    chrome.runtime.sendMessage({ type: 'FETCH_ERROR', error: msg }).catch(() => {});
    isRunning = false;
    return;
  }
  sendProgress('size=' + SIZE + ' | peran=' + role.label, 'info', 'Memproses ' + chosenKabs.length + ' kabupaten...');

  const byUser = new Map();
  const add = (arr) => arr.forEach(u => byUser.set(u.userId, u));
  const report = [], incomplete = [];

  for (const kab of chosenKabs) {
    sendProgress('Proses ' + kab.name + '...', 'info', kab.name);
    let res = await fetchAll(regionObj(kab.id), kab.name);
    await sleep(jitter(DELAY_MS));

    if (!res.error && !res.capped) {
      add(res.recs);
      report.push(kab.name + ': ' + res.recs.length + '/' + res.total + ' OK');
      sendProgress('OK ' + kab.name + ': ' + res.recs.length + '/' + res.total + ' | unik:' + byUser.size, 'ok');
      continue;
    }

    if (res.recs.length) add(res.recs);
    sendProgress(kab.name + ': ' + (res.error ? 'TIMEOUT' : res.total + '>' + CAP) + ' → drill kecamatan', 'warn');

    let kecs = [];
    try {
      kecs = await getRegion('level3', { groupId: GROUP_ID, level2FullCode: kab.code });
    } catch (e) {
      sendProgress('   gagal kecamatan ' + kab.name + ': ' + e.message, 'error');
      incomplete.push(kab.name);
      continue;
    }

    let cnt = 0;
    for (const kec of kecs) {
      const rk = await fetchAll(regionObj(kab.id, kec.id), kab.name + '/' + kec.name);
      if (rk.recs.length) add(rk.recs);
      cnt += rk.recs.length;
      if (!rk.error && !rk.capped) {
        sendProgress('   . ' + kec.name + ': ' + rk.recs.length + '/' + rk.total + ' OK', 'ok');
      } else {
        sendProgress('   . ' + kec.name + ': ' + (rk.error ? 'TIMEOUT' : rk.total + '>' + CAP) + ' → drill desa', 'warn');
        try {
          const desas = await getRegion('level4', { groupId: GROUP_ID, level3FullCode: kec.code });
          for (const d of desas) {
            const rd = await fetchAll(regionObj(kab.id, kec.id, d.id), kec.name + '/' + d.name);
            if (rd.recs.length) add(rd.recs);
            cnt += rd.recs.length;
            if (rd.error) incomplete.push(kab.name + '/' + kec.name + '/' + d.name);
            await sleep(jitter(DELAY_MS));
          }
        } catch (e) {
          sendProgress('     gagal desa ' + kec.name, 'error');
          incomplete.push(kab.name + '/' + kec.name);
        }
      }
      await sleep(jitter(DELAY_MS));
    }
    report.push(kab.name + ': ~' + cnt + ' via ' + kecs.length + ' kec');
  }

  const all = [...byUser.values()];
  sendProgress('===== REKAP (' + role.label + ') =====', 'info');
  report.forEach(r => sendProgress(r, 'ok'));
  if (incomplete.length) sendProgress('BELUM lengkap: ' + incomplete.join(', '), 'warn');
  sendProgress('TOTAL ' + role.label.toUpperCase() + ' UNIK: ' + all.length, 'info', 'Selesai');

  const tag = chosenKabs.length === 1
    ? chosenKabs[0].name.toLowerCase().replace(/[^a-z0-9]+/g, '_')
    : chosenKabs.length + 'kab';

  const rows = [];
  for (const u of all)
    for (const reg of (u.regionSummary || []))
      for (const st of (reg.statusBreakdown || []))
        rows.push({ userId: u.userId, username: u.username, email: u.email, roleName: u.roleName, userTotal: u.total, regionCode: reg.regionCode, regionTotal: reg.total, status: st.status, count: st.count });

  const result = { total: all.length, csvRows: rows.length };

  chrome.storage.local.set({
    fasih_result: { role: role.label, tag, date: new Date().toISOString(), all, rows, report, incomplete },
  }).catch(() => {});

  chrome.storage.session.set({ fasih: { state: 'done', result } }).catch(() => {});
  chrome.runtime.sendMessage({ type: 'DONE', result }).catch(() => {});

  isRunning = false;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'PING') {
    sendResponse({ ok: true });
    return false;
  }
  if (message.type === 'GET_KABS') {
    handleGetKabs(message.role, message.prov || '72').then(sendResponse);
    return true;
  }
  if (message.type === 'FETCH_DATA') {
    if (isRunning) { sendResponse({ ok: false, error: 'already running' }); return false; }
    handleFetchData(message.role, message.kabs);
    sendResponse({ ok: true });
    return false;
  }
});
