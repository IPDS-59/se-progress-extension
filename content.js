const BASE = 'https://fasih-sm.bps.go.id/app/api';
const ASSIGN = BASE + '/analytic/api/v2/assignment/report-progress-by-responsibility';
const REGION = BASE + '/region/api/v1/region';
const GROUP_ID = 'a45adac1-e711-4c15-b3f9-1f30fc151565';
const PROV = '18';
const SIZE_CANDIDATES = [10, 5];
const CAP = 1000, DELAY_MS = 400, MAX_RETRY = 4;

let isRunning = false;
let currentRoleId = null;
let SIZE = null;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

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
  if (statusText) {
    chrome.storage.session.get('fasih').then(s => {
      chrome.storage.session.set({ fasih: { ...(s.fasih || {}), state: 'running', statusText } });
    }).catch(() => {});
  }
}

async function getRegion(level, params) {
  const url = REGION + '/' + level + '?' + new URLSearchParams(params);
  for (let a = 0; a < MAX_RETRY; a++) {
    const res = await fetch(url, { credentials: 'include', headers: getHeaders() });
    if (res.ok) return findArr(await res.json()).map(o => ({ id: pickId(o), code: pickCode(o), name: pickName(o) }));
    if ([502, 503, 504].includes(res.status)) { await sleep(2000 * 2 ** a); continue; }
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
  const res = await fetch(ASSIGN, { method: 'POST', credentials: 'include', headers: getHeaders(), body: JSON.stringify(payload) });
  return { ok: res.ok, status: res.status, json: res.ok ? await res.json() : null };
}

async function callRetry(page, size, region, label) {
  for (let a = 0; a < MAX_RETRY; a++) {
    let r;
    try { r = await callAssign(page, size, region); } catch (e) { r = { ok: false, status: 0 }; }
    if (r.ok) return r;
    if ([0, 502, 503, 504].includes(r.status)) {
      const w = 2000 * 2 ** a;
      sendProgress('   retry ' + label + ' p' + page + ' (HTTP ' + r.status + ') ' + (w / 1000) + 's', 'warn');
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
    await sleep(DELAY_MS);
  }
  return { recs, total, error, capped: total != null && total > recs.length };
}

function triggerDownload(content, mimeType, filename) {
  const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

async function handleGetKabs(role) {
  try {
    currentRoleId = role.id;
    let kabs = await getRegion('level2', { groupId: GROUP_ID, level1FullCode: PROV });
    if (!kabs.length) kabs = await getRegion('level2', { groupId: GROUP_ID });
    if (!kabs.length || !kabs[0].id) return { ok: false, error: 'Struktur region tidak terdeteksi' };
    return { ok: true, kabs };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function handleFetchData(role, chosenKabs) {
  isRunning = true;
  currentRoleId = role.id;

  SIZE = null;
  for (const s of SIZE_CANDIDATES) {
    const r = await callAssign(0, s, regionObj());
    if (r.ok) { SIZE = s; break; }
  }
  if (!SIZE) {
    const msg = 'Gagal: semua ukuran halaman ditolak server';
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
          }
        } catch (e) {
          sendProgress('     gagal desa ' + kec.name, 'error');
          incomplete.push(kab.name + '/' + kec.name);
        }
      }
      await sleep(DELAY_MS);
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
  const tgl = new Date().toISOString().slice(0, 10);

  triggerDownload(
    JSON.stringify(all, null, 2),
    'application/json',
    'fasih_' + role.label + '_' + tag + '_raw_' + tgl + '.json'
  );

  const rows = [];
  for (const u of all)
    for (const reg of (u.regionSummary || []))
      for (const st of (reg.statusBreakdown || []))
        rows.push({ userId: u.userId, username: u.username, email: u.email, roleName: u.roleName, userTotal: u.total, regionCode: reg.regionCode, regionTotal: reg.total, status: st.status, count: st.count });

  const cols = ['userId', 'username', 'email', 'roleName', 'userTotal', 'regionCode', 'regionTotal', 'status', 'count'];
  const esc = (v) => { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  const csv = '﻿' + cols.join(',') + '\n' + rows.map(r => cols.map(c => esc(r[c])).join(',')).join('\n');

  triggerDownload(csv, 'text/csv;charset=utf-8', 'fasih_' + role.label + '_' + tag + '_flat_' + tgl + '.csv');

  const result = { total: all.length, csvRows: rows.length };
  chrome.storage.session.set({ fasih: { state: 'done', result } }).catch(() => {});
  chrome.runtime.sendMessage({ type: 'DONE', result }).catch(() => {});

  isRunning = false;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'GET_KABS') {
    handleGetKabs(message.role).then(sendResponse);
    return true;
  }
  if (message.type === 'FETCH_DATA') {
    if (isRunning) { sendResponse({ ok: false, error: 'already running' }); return false; }
    handleFetchData(message.role, message.kabs);
    sendResponse({ ok: true });
    return false;
  }
});
