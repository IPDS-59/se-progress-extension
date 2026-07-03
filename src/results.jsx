import React, { useState, useEffect, useMemo } from 'react';
import { createRoot } from 'react-dom/client';

// ─── Helpers ────────────────────────────────────────────────────────────────

function statusColor(s = '') {
  const t = s.toLowerCase();
  if (/selesai|done|complete|finish/.test(t))        return 'bg-green-100 text-green-700';
  if (/jalan|progress|proses|dikerjakan/.test(t))    return 'bg-yellow-100 text-yellow-800';
  if (/tolak|reject|batal|cancel/.test(t))           return 'bg-red-100 text-red-700';
  if (/belum|not.start|pending|tersedia/.test(t))    return 'bg-gray-100 text-gray-600';
  return 'bg-indigo-100 text-indigo-700';
}

function isDone(s = '') {
  return /selesai|done|complete|finish/i.test(s);
}

function aggregateUsers(rows = []) {
  const map = new Map();
  const statusSet = new Set();

  for (const row of rows) {
    const key = row.userId + '::' + (row.regionCode || '');
    if (!map.has(key)) {
      map.set(key, {
        userId:     row.userId,
        username:   row.username   || '-',
        email:      row.email      || '-',
        roleName:   row.roleName   || '-',
        regionCode: row.regionCode || '-',
        total:      Number(row.regionTotal) || 0,
        byStatus:   {},
      });
    }
    const u = map.get(key);
    u.byStatus[row.status] = (u.byStatus[row.status] || 0) + Number(row.count);
    statusSet.add(row.status);
  }

  const users    = [...map.values()];
  const statuses = [...statusSet].sort();
  return { users, statuses };
}

function loadSheetJS() {
  return new Promise((resolve, reject) => {
    if (typeof XLSX !== 'undefined') return resolve();
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    s.onload = resolve;
    s.onerror = () => reject(new Error('Gagal memuat SheetJS'));
    document.head.appendChild(s);
  });
}


function fmtDate(iso = '') {
  if (!iso) return '-';
  const d = new Date(iso);
  return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function SummaryCard({ label, value, sub, accent }) {
  return (
    <div className={`bg-white rounded-xl border p-5 ${accent ? 'border-green-300' : 'border-gray-200'}`}>
      <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">{label}</p>
      <p className={`text-3xl font-bold mt-1 ${accent ? 'text-green-700' : 'text-gray-900'}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </div>
  );
}

function SortIcon({ field, sortField, sortDir }) {
  if (sortField !== field) return <span className="text-gray-300 ml-0.5">↕</span>;
  return <span className="text-blue-600 ml-0.5">{sortDir === 'asc' ? '↑' : '↓'}</span>;
}

function MiniBar({ value, max }) {
  if (!max) return null;
  const pct = Math.min(100, Math.round((value / max) * 100));
  return (
    <div className="flex items-center gap-2 justify-end">
      <div className="w-20 bg-gray-200 rounded-full h-2">
        <div className="bg-green-500 h-2 rounded-full" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-gray-500 w-8 text-right tabular-nums">{pct}%</span>
    </div>
  );
}

// ─── Main App ────────────────────────────────────────────────────────────────

function App() {
  const [data,     setData]     = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [search,   setSearch]   = useState('');
  const [sortField, setSortField] = useState('total');
  const [sortDir,   setSortDir]   = useState('desc');

  useEffect(() => {
    chrome.storage.local.get('fasih_result', ({ fasih_result }) => {
      setData(fasih_result ?? null);
      setLoading(false);
    });
  }, []);

  const { users, statuses } = useMemo(() => {
    if (!data?.rows?.length) return { users: [], statuses: [] };
    return aggregateUsers(data.rows);
  }, [data]);

  const doneStatus = useMemo(() => statuses.find(isDone), [statuses]);

  const uniqueUserCount = useMemo(() => new Set(users.map(u => u.userId)).size, [users]);

  const totals = useMemo(() => {
    const target = users.reduce((s, u) => s + (u.total || 0), 0);
    const done   = doneStatus
      ? users.reduce((s, u) => s + (u.byStatus[doneStatus] || 0), 0)
      : 0;
    const pct = target > 0 ? Math.round(done / target * 100) : 0;
    return { target, done, pct };
  }, [users, doneStatus]);

  const filtered = useMemo(() => {
    let list = users;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(u =>
        u.username.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        u.roleName.toLowerCase().includes(q) ||
        u.regionCode.toLowerCase().includes(q)
      );
    }
    return [...list].sort((a, b) => {
      const av = sortField === 'total' ? a.total : (a.byStatus[sortField] || 0);
      const bv = sortField === 'total' ? b.total : (b.byStatus[sortField] || 0);
      return sortDir === 'asc' ? av - bv : bv - av;
    });
  }, [users, search, sortField, sortDir]);

  const toggleSort = (field) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('desc'); }
  };

  const downloadJSON = () => {
    if (!data?.all) return;
    const blob = new Blob([JSON.stringify(data.all, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `fasih_${data.role}_${data.tag}_raw_${data.date?.slice(0, 10)}.json`;
    a.click();
  };

  const downloadXLSX = async () => {
    if (!users.length) return;
    try {
      await loadSheetJS();

      const TEXT_COLS = new Set(['Username', 'Email', 'Peran', 'Kode Wilayah']);
      const NUM_FMT   = '#,##0';
      const PCT_FMT   = '0"%"';

      const pivotRows = users.map((u, i) => {
        const done = doneStatus ? (u.byStatus[doneStatus] || 0) : 0;
        const pct  = u.total > 0 ? Math.round(done / u.total * 100) : 0;
        const row  = { 'No.': i + 1, 'Username': u.username, 'Email': u.email, 'Peran': u.roleName, 'Kode Wilayah': u.regionCode, 'Target': u.total };
        statuses.forEach(s => { row[s] = u.byStatus[s] || 0; });
        if (doneStatus) row['Progress (%)'] = pct;
        return row;
      });

      const headers = Object.keys(pivotRows[0] || {});
      const ws      = XLSX.utils.json_to_sheet(pivotRows);
      const range   = XLSX.utils.decode_range(ws['!ref']);

      for (let R = range.s.r + 1; R <= range.e.r; R++) {
        for (let C = range.s.c; C <= range.e.c; C++) {
          const addr = XLSX.utils.encode_cell({ r: R, c: C });
          const cell = ws[addr];
          if (!cell) continue;
          const header = headers[C];
          if (TEXT_COLS.has(header)) {
            cell.t = 's';
            cell.v = String(cell.v ?? '');
          } else if (header === 'Progress (%)') {
            cell.t = 'n';
            cell.z = PCT_FMT;
          } else if (header !== 'No.') {
            cell.t = 'n';
            cell.z = NUM_FMT;
          }
        }
      }

      ws['!cols'] = [
        { wch: 5 },
        { wch: 22 },
        { wch: 32 },
        { wch: 14 },
        { wch: 18 },
        { wch: 10 },
        ...headers.slice(6).map(h => ({ wch: h === 'Progress (%)' ? 12 : 20 })),
      ];

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Rekap FASIH');
      XLSX.writeFile(wb, `fasih_${data.role}_${data.tag}_rekap_${data.date?.slice(0, 10)}.xlsx`);
    } catch (e) {
      alert('Gagal membuat file Excel: ' + e.message);
    }
  };

  const downloadCSV = () => {
    if (!users.length) return;
    const esc = v => { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    const headers = ['No.', 'Username', 'Email', 'Peran', 'Kode Wilayah', 'Target', ...statuses, ...(doneStatus ? ['Progress (%)'] : [])];
    const rows = users.map((u, i) => {
      const done = doneStatus ? (u.byStatus[doneStatus] || 0) : 0;
      const pct  = u.total > 0 ? Math.round(done / u.total * 100) : 0;
      const cols = [i + 1, u.username, u.email, u.roleName, u.regionCode, u.total, ...statuses.map(s => u.byStatus[s] || 0), ...(doneStatus ? [pct] : [])];
      return cols.map(esc).join(',');
    });
    const csv  = '﻿' + headers.map(esc).join(',') + '\n' + rows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a    = document.createElement('a');
    a.href     = URL.createObjectURL(blob);
    a.download = `fasih_${data.role}_${data.tag}_rekap_${data.date?.slice(0, 10)}.csv`;
    a.click();
  };

  // ── Loading ──────────────────────────────────────────────────────────────
  if (loading) return (
    <div className="flex items-center justify-center min-h-screen bg-gray-50">
      <div className="text-center">
        <div className="animate-spin h-10 w-10 border-4 border-blue-700 border-t-transparent rounded-full mx-auto mb-4" />
        <p className="text-gray-500 text-sm">Memuat data...</p>
      </div>
    </div>
  );

  // ── Empty ────────────────────────────────────────────────────────────────
  if (!data) return (
    <div className="flex items-center justify-center min-h-screen bg-gray-50">
      <div className="text-center text-gray-500">
        <p className="text-2xl mb-2">📭</p>
        <p className="font-medium">Belum ada data</p>
        <p className="text-sm mt-1">Ekstrak data terlebih dahulu melalui ekstensi FASIH SE Progress.</p>
      </div>
    </div>
  );

  // ── Main ─────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-50">
      {/* ── Sticky header ─── */}
      <header className="sticky top-0 z-10 bg-[#1a5276] text-white shadow">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-base font-semibold leading-tight">Hasil Ekstraksi FASIH SE</h1>
            <p className="text-blue-200 text-xs mt-0.5 truncate">
              Peran:&nbsp;
              <span className="capitalize font-medium text-white">{data.role}</span>
              &nbsp;·&nbsp;{fmtDate(data.date)}
              &nbsp;·&nbsp;Wilayah:&nbsp;
              <span className="font-medium text-white">{data.tag}</span>
            </p>
          </div>
          <div className="flex gap-2 flex-shrink-0">
            <button
              onClick={downloadJSON}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white/10 hover:bg-white/20 rounded-lg text-sm font-medium transition"
            >
              ↓ JSON
            </button>
            <button
              onClick={downloadCSV}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white/10 hover:bg-white/20 rounded-lg text-sm font-medium transition"
            >
              ↓ CSV
            </button>
            <button
              onClick={downloadXLSX}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white text-[#1a5276] rounded-lg text-sm font-semibold hover:bg-blue-50 transition"
            >
              ↓ Excel
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-6 space-y-5">
        {/* ── Summary cards ─── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <SummaryCard label="Petugas Unik"  value={uniqueUserCount.toLocaleString('id-ID')} />
          <SummaryCard label="Total Target"  value={totals.target.toLocaleString('id-ID')} />
          {doneStatus && (
            <SummaryCard
              label="Selesai"
              value={totals.done.toLocaleString('id-ID')}
              sub={`${totals.pct}% dari total target`}
              accent
            />
          )}
          <SummaryCard label="Baris CSV" value={(data.rows?.length ?? 0).toLocaleString('id-ID')} />
        </div>

        {/* ── Overall progress bar ─── */}
        {doneStatus && (
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="flex justify-between text-sm mb-2">
              <span className="font-medium text-gray-700">
                Progress Keseluruhan
                <span className={`ml-2 text-xs px-2 py-0.5 rounded-full ${statusColor(doneStatus)}`}>{doneStatus}</span>
              </span>
              <span className="text-gray-500 tabular-nums">
                {totals.done.toLocaleString('id-ID')} / {totals.target.toLocaleString('id-ID')}
              </span>
            </div>
            <div className="w-full bg-gray-100 rounded-full h-3">
              <div
                className="bg-green-500 h-3 rounded-full transition-all duration-500"
                style={{ width: `${totals.pct}%` }}
              />
            </div>
            <p className="text-xs text-gray-400 mt-1.5">{totals.pct}% selesai</p>
          </div>
        )}

        {/* ── Search + count ─── */}
        <div className="flex items-center gap-3 flex-wrap">
          <input
            type="text"
            placeholder="Cari nama, username, atau email..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-72 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <span className="text-sm text-gray-500">
            Menampilkan <strong>{filtered.length}</strong> dari {users.length} baris wilayah ({uniqueUserCount} petugas)
          </span>
        </div>

        {/* ── Table ─── */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide w-10">#</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Username</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Email</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">Kode Wilayah</th>
                  <th
                    className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide cursor-pointer hover:bg-gray-100 select-none"
                    onClick={() => toggleSort('total')}
                  >
                    Target <SortIcon field="total" sortField={sortField} sortDir={sortDir} />
                  </th>
                  {statuses.map(s => (
                    <th
                      key={s}
                      className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide cursor-pointer hover:bg-gray-100 select-none whitespace-nowrap"
                      onClick={() => toggleSort(s)}
                    >
                      {s} <SortIcon field={s} sortField={sortField} sortDir={sortDir} />
                    </th>
                  ))}
                  {doneStatus && (
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">
                      Progress
                    </th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map((user, i) => {
                  const done = doneStatus ? (user.byStatus[doneStatus] || 0) : 0;
                  return (
                    <tr key={user.userId + '::' + user.regionCode} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 text-gray-400 tabular-nums">{i + 1}</td>
                      <td className="px-4 py-3 font-medium text-gray-900">{user.username}</td>
                      <td className="px-4 py-3 text-gray-500">{user.email}</td>
                      <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{user.regionCode}</td>
                      <td className="px-4 py-3 text-right font-semibold text-gray-900 tabular-nums">{user.total.toLocaleString('id-ID')}</td>
                      {statuses.map(s => (
                        <td key={s} className="px-4 py-3 text-right tabular-nums">
                          <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${statusColor(s)}`}>
                            {(user.byStatus[s] || 0).toLocaleString('id-ID')}
                          </span>
                        </td>
                      ))}
                      {doneStatus && (
                        <td className="px-4 py-3">
                          <MiniBar value={done} max={user.total} />
                        </td>
                      )}
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr>
                    <td
                      colSpan={5 + statuses.length + (doneStatus ? 1 : 0)}
                      className="text-center py-10 text-gray-400 text-sm"
                    >
                      Tidak ada data yang sesuai pencarian.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}

const root = createRoot(document.getElementById('root'));
root.render(<App />);
