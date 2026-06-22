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
    if (!map.has(row.userId)) {
      map.set(row.userId, {
        userId:    row.userId,
        username:  row.username  || '-',
        email:     row.email     || '-',
        roleName:  row.roleName  || '-',
        total:     Number(row.userTotal) || 0,
        byStatus:  {},
        regions:   new Set(),
      });
    }
    const u = map.get(row.userId);
    u.byStatus[row.status] = (u.byStatus[row.status] || 0) + Number(row.count);
    statusSet.add(row.status);
    if (row.regionCode) u.regions.add(row.regionCode);
  }

  const users    = [...map.values()].map(u => ({ ...u, regionCount: u.regions.size }));
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

function buildPivot(rows = []) {
  const STATUS_COLS = ['DRAFT', 'OPEN', 'SUBMITTED BY Pencacah', 'APPROVED BY Pengawas', 'REJECTED BY Pengawas'];
  const pivot = {};
  for (const row of rows) {
    const key = row.email + '_' + row.regionCode;
    if (!pivot[key]) {
      pivot[key] = {
        'Email Petugas':            row.email     || '',
        'Username':                 row.username  || '',
        'Peran':                    row.roleName  || '',
        'Kode Wilayah (SubSLS)':    row.regionCode || '',
        'Total Assign':             Number(row.userTotal) || 0,
        'DRAFT': 0, 'OPEN': 0,
        'SUBMITTED BY Pencacah': 0,
        'APPROVED BY Pengawas':  0,
        'REJECTED BY Pengawas':  0,
      };
    }
    const s = (row.status || '').toUpperCase();
    if (s.includes('DRAFT'))     pivot[key]['DRAFT']                  += Number(row.count);
    else if (s.includes('OPEN')) pivot[key]['OPEN']                   += Number(row.count);
    else if (s.includes('SUBMITTED')) pivot[key]['SUBMITTED BY Pencacah'] += Number(row.count);
    else if (s.includes('APPROVED'))  pivot[key]['APPROVED BY Pengawas']  += Number(row.count);
    else if (s.includes('REJECTED'))  pivot[key]['REJECTED BY Pengawas']  += Number(row.count);
  }
  return Object.values(pivot);
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
        u.roleName.toLowerCase().includes(q)
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
    if (!data?.rows) return;
    try {
      await loadSheetJS();
      const pivotRows = buildPivot(data.rows);
      const ws = XLSX.utils.json_to_sheet(pivotRows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Rekap FASIH');
      XLSX.writeFile(wb, `fasih_${data.role}_${data.tag}_rekap_${data.date?.slice(0, 10)}.xlsx`);
    } catch (e) {
      alert('Gagal membuat file Excel: ' + e.message);
    }
  };

  const downloadCSV = () => {
    if (!data?.rows) return;
    const cols = ['userId','username','email','roleName','userTotal','regionCode','regionTotal','status','count'];
    const esc  = v => { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    const csv  = '﻿' + cols.join(',') + '\n' + data.rows.map(r => cols.map(c => esc(r[c])).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a    = document.createElement('a');
    a.href     = URL.createObjectURL(blob);
    a.download = `fasih_${data.role}_${data.tag}_flat_${data.date?.slice(0, 10)}.csv`;
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
          <SummaryCard label="Petugas Unik"  value={users.length.toLocaleString('id-ID')} />
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
            Menampilkan <strong>{filtered.length}</strong> dari {users.length} petugas
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
                    <tr key={user.userId} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 text-gray-400 tabular-nums">{i + 1}</td>
                      <td className="px-4 py-3 font-medium text-gray-900">{user.username}</td>
                      <td className="px-4 py-3 text-gray-500">{user.email}</td>
                      <td className="px-4 py-3 text-right font-semibold text-gray-900 tabular-nums">{user.total}</td>
                      {statuses.map(s => (
                        <td key={s} className="px-4 py-3 text-right tabular-nums">
                          <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${statusColor(s)}`}>
                            {user.byStatus[s] || 0}
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
                      colSpan={4 + statuses.length + (doneStatus ? 1 : 0)}
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
