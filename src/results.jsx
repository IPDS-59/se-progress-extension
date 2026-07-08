import React, { useState, useEffect, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import {
  PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from 'recharts';

// ─── Helpers ────────────────────────────────────────────────────────────────

function statusColor(s = '') {
  const t = s.toLowerCase();
  if (/selesai|done|complete|finish|approved/i.test(t)) return 'bg-green-100 text-green-700';
  if (/jalan|progress|proses|dikerjakan|submitted/i.test(t)) return 'bg-yellow-100 text-yellow-800';
  if (/tolak|reject|batal|cancel/i.test(t))                  return 'bg-red-100 text-red-700';
  if (/belum|not.start|pending|tersedia|draft/i.test(t))     return 'bg-gray-100 text-gray-600';
  if (/open/i.test(t))                                        return 'bg-blue-100 text-blue-700';
  return 'bg-indigo-100 text-indigo-700';
}

const CHART_COLORS = ['#22c55e','#3b82f6','#f59e0b','#ef4444','#6366f1','#14b8a6','#f97316','#8b5cf6'];

function isDone(s = '') {
  return /selesai|done|complete|finish|approved/i.test(s);
}

function parseRegionCode(code = '') {
  const s = String(code || '').padStart(16, '0');
  return {
    prov:   s.slice(0, 2),
    kab:    s.slice(2, 4),
    kec:    s.slice(4, 7),
    desa:   s.slice(7, 10),
    sls:    s.slice(10, 14),
    subSls: s.slice(14, 16),
  };
}

function aggregateUsers(rows = []) {
  const map = new Map();
  const statusSet = new Set();
  for (const row of rows) {
    if (!map.has(row.userId)) {
      map.set(row.userId, {
        userId:   row.userId,
        username: row.username || '-',
        email:    row.email    || '-',
        roleName: row.roleName || '-',
        total:    Number(row.userTotal) || 0,
        byStatus: {},
        regions:  new Set(),
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

function aggregateDetail(rows = []) {
  const map = new Map();
  const statusSet = new Set();
  for (const row of rows) {
    const key = row.userId + '_' + (row.regionCode || '');
    if (!map.has(key)) {
      const parts = parseRegionCode(row.regionCode);
      map.set(key, {
        userId:     row.userId,
        username:   row.username  || '-',
        email:      row.email     || '-',
        roleName:   row.roleName  || '-',
        regionCode: row.regionCode || '',
        desa:       parts.desa,
        sls:        parts.sls,
        subSls:     parts.subSls,
        total:      Number(row.regionTotal) || 0,
        byStatus:   {},
      });
    }
    const u = map.get(key);
    u.byStatus[row.status] = (u.byStatus[row.status] || 0) + Number(row.count);
    statusSet.add(row.status);
  }
  const regions  = [...map.values()];
  const statuses = [...statusSet].sort();
  return { regions, statuses };
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
  return new Date(iso).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}

function applyXlsxTypes(ws, headers) {
  const TEXT_COLS = new Set(['Username', 'Email', 'Peran', 'Kode Desa', 'Kode SLS', 'Sub-SLS', 'Status']);
  const range = XLSX.utils.decode_range(ws['!ref']);
  for (let R = range.s.r + 1; R <= range.e.r; R++) {
    for (let C = range.s.c; C <= range.e.c; C++) {
      const addr = XLSX.utils.encode_cell({ r: R, c: C });
      const cell = ws[addr];
      if (!cell) continue;
      const h = headers[C];
      if (TEXT_COLS.has(h)) {
        cell.t = 's'; cell.v = String(cell.v ?? '');
      } else if (h === 'Progress (%)') {
        cell.t = 'n'; cell.z = '0"%"';
      } else if (h !== 'No.') {
        cell.t = 'n'; cell.z = '#,##0';
      }
    }
  }
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

function StatusBadge({ s }) {
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${statusColor(s)}`}>{s}</span>
  );
}

function TabBtn({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-sm font-medium rounded-lg transition ${
        active ? 'bg-[#1a5276] text-white' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
      }`}
    >
      {children}
    </button>
  );
}

// ─── Charts ──────────────────────────────────────────────────────────────────

function StatusPieChart({ users, statuses }) {
  const data = statuses.map(s => ({
    name: s,
    value: users.reduce((acc, u) => acc + (u.byStatus[s] || 0), 0),
  })).filter(d => d.value > 0);

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <p className="text-sm font-semibold text-gray-700 mb-3">Distribusi Status</p>
      <ResponsiveContainer width="100%" height={220}>
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} innerRadius={45} paddingAngle={2}>
            {data.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
          </Pie>
          <Tooltip formatter={v => v.toLocaleString('id-ID')} />
          <Legend formatter={v => <span className="text-xs">{v}</span>} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

function TopUsersChart({ users, doneStatus }) {
  if (!doneStatus) return null;
  const data = [...users]
    .sort((a, b) => (b.byStatus[doneStatus] || 0) - (a.byStatus[doneStatus] || 0))
    .slice(0, 10)
    .map(u => ({
      name:    u.username.length > 14 ? u.username.slice(0, 14) + '…' : u.username,
      Selesai: u.byStatus[doneStatus] || 0,
      Sisa:    Math.max(0, u.total - (u.byStatus[doneStatus] || 0)),
    }));

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <p className="text-sm font-semibold text-gray-700 mb-3">Top 10 Petugas (Selesai)</p>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data} layout="vertical" margin={{ left: 10, right: 20 }}>
          <CartesianGrid strokeDasharray="3 3" horizontal={false} />
          <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={v => v.toLocaleString('id-ID')} />
          <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={90} />
          <Tooltip formatter={v => v.toLocaleString('id-ID')} />
          <Bar dataKey="Selesai" stackId="a" fill="#22c55e" radius={[0, 2, 2, 0]} />
          <Bar dataKey="Sisa"    stackId="a" fill="#e5e7eb" radius={[0, 2, 2, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── Main App ────────────────────────────────────────────────────────────────

function App() {
  const [data,      setData]      = useState(null);
  const [loading,   setLoading]   = useState(true);
  const [activeTab, setActiveTab] = useState('summary');

  // Summary sort/search
  const [search,    setSearch]    = useState('');
  const [sortField, setSortField] = useState('total');
  const [sortDir,   setSortDir]   = useState('desc');

  // Detail search
  const [detailSearch, setDetailSearch] = useState('');

  useEffect(() => {
    chrome.storage.local.get('fasih_result', ({ fasih_result }) => {
      setData(fasih_result ?? null);
      setLoading(false);
    });
  }, []);

  // ── Summary aggregation ───────────────────────────────────────────────────
  const { users, statuses } = useMemo(() => {
    if (!data?.rows?.length) return { users: [], statuses: [] };
    return aggregateUsers(data.rows);
  }, [data]);

  const doneStatus = useMemo(() => statuses.find(isDone), [statuses]);

  const totals = useMemo(() => {
    const target = users.reduce((s, u) => s + (u.total || 0), 0);
    const done   = doneStatus ? users.reduce((s, u) => s + (u.byStatus[doneStatus] || 0), 0) : 0;
    return { target, done, pct: target > 0 ? Math.round(done / target * 100) : 0 };
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

  // ── Detail aggregation ────────────────────────────────────────────────────
  const { regions: allRegions, statuses: detailStatuses } = useMemo(() => {
    if (!data?.rows?.length) return { regions: [], statuses: [] };
    return aggregateDetail(data.rows);
  }, [data]);

  const detailDoneStatus = useMemo(() => detailStatuses.find(isDone), [detailStatuses]);

  const filteredDetail = useMemo(() => {
    if (!detailSearch.trim()) return allRegions;
    const q = detailSearch.trim().toLowerCase();
    return allRegions.filter(r =>
      r.username.toLowerCase().includes(q) ||
      r.desa.includes(q) ||
      r.sls.includes(q) ||
      r.subSls.includes(q)
    );
  }, [allRegions, detailSearch]);

  // ── Exports ───────────────────────────────────────────────────────────────
  const downloadJSON = () => {
    if (!data?.all) return;
    const blob = new Blob([JSON.stringify(data.all, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `fasih_${data.role}_${data.tag}_raw_${data.date?.slice(0, 10)}.json`;
    a.click();
  };

  const downloadCSV = () => {
    const esc = v => { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };

    if (activeTab === 'summary') {
      if (!users.length) return;
      const headers = ['No.', 'Username', 'Email', 'Peran', 'Target', ...statuses, ...(doneStatus ? ['Progress (%)'] : [])];
      const rows = users.map((u, i) => {
        const done = doneStatus ? (u.byStatus[doneStatus] || 0) : 0;
        const pct  = u.total > 0 ? Math.round(done / u.total * 100) : 0;
        return [i + 1, u.username, u.email, u.roleName, u.total, ...statuses.map(s => u.byStatus[s] || 0), ...(doneStatus ? [pct] : [])].map(esc).join(',');
      });
      const csv = '﻿' + headers.map(esc).join(',') + '\n' + rows.join('\n');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      a.download = `fasih_${data.role}_${data.tag}_ringkasan_${data.date?.slice(0, 10)}.csv`;
      a.click();
    } else {
      if (!allRegions.length) return;
      const headers = ['No.', 'Username', 'Email', 'Peran', 'Kode Desa', 'Kode SLS', 'Sub-SLS', 'Total', ...detailStatuses, 'Status'];
      const rows = filteredDetail.map((r, i) => {
        const done   = detailDoneStatus ? (r.byStatus[detailDoneStatus] || 0) : 0;
        const status = r.total > 0 && done >= r.total ? 'Sudah' : 'Belum';
        return [i + 1, r.username, r.email, r.roleName, r.desa, r.sls, r.subSls, r.total, ...detailStatuses.map(s => r.byStatus[s] || 0), status].map(esc).join(',');
      });
      const csv = '﻿' + headers.map(esc).join(',') + '\n' + rows.join('\n');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      a.download = `fasih_${data.role}_${data.tag}_detail_${data.date?.slice(0, 10)}.csv`;
      a.click();
    }
  };

  const downloadXLSX = async () => {
    if (!users.length && !allRegions.length) return;
    try {
      await loadSheetJS();

      // ── Sheet 1: Ringkasan ──
      const summaryRows = users.map((u, i) => {
        const done = doneStatus ? (u.byStatus[doneStatus] || 0) : 0;
        const pct  = u.total > 0 ? Math.round(done / u.total * 100) : 0;
        const row  = { 'No.': i + 1, 'Username': u.username, 'Email': u.email, 'Peran': u.roleName, 'Target': u.total };
        statuses.forEach(s => { row[s] = u.byStatus[s] || 0; });
        if (doneStatus) row['Progress (%)'] = pct;
        return row;
      });
      const sumHeaders = summaryRows.length ? Object.keys(summaryRows[0]) : [];
      const ws1 = XLSX.utils.json_to_sheet(summaryRows);
      applyXlsxTypes(ws1, sumHeaders);
      ws1['!cols'] = [
        { wch: 5 }, { wch: 22 }, { wch: 32 }, { wch: 14 }, { wch: 10 },
        ...sumHeaders.slice(5).map(h => ({ wch: h === 'Progress (%)' ? 12 : 22 })),
      ];

      // ── Sheet 2: Detail ──
      const detailRows = allRegions.map((r, i) => {
        const done   = detailDoneStatus ? (r.byStatus[detailDoneStatus] || 0) : 0;
        const status = r.total > 0 && done >= r.total ? 'Sudah' : 'Belum';
        const row    = { 'No.': i + 1, 'Username': r.username, 'Email': r.email, 'Peran': r.roleName, 'Kode Desa': r.desa, 'Kode SLS': r.sls, 'Sub-SLS': r.subSls, 'Total': r.total };
        detailStatuses.forEach(s => { row[s] = r.byStatus[s] || 0; });
        row['Status'] = status;
        return row;
      });
      const detHeaders = detailRows.length ? Object.keys(detailRows[0]) : [];
      const ws2 = XLSX.utils.json_to_sheet(detailRows);
      applyXlsxTypes(ws2, detHeaders);
      ws2['!cols'] = [
        { wch: 5 }, { wch: 22 }, { wch: 32 }, { wch: 14 },
        { wch: 10 }, { wch: 10 }, { wch: 8 }, { wch: 10 },
        ...detHeaders.slice(8).map(h => ({ wch: h === 'Status' ? 10 : 22 })),
      ];

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws1, 'Ringkasan');
      XLSX.utils.book_append_sheet(wb, ws2, 'Detail Wilayah');
      XLSX.writeFile(wb, `fasih_${data.role}_${data.tag}_rekap_${data.date?.slice(0, 10)}.xlsx`);
    } catch (e) {
      alert('Gagal membuat file Excel: ' + e.message);
    }
  };

  // ── Loading ───────────────────────────────────────────────────────────────
  if (loading) return (
    <div className="flex items-center justify-center min-h-screen bg-gray-50">
      <div className="text-center">
        <div className="animate-spin h-10 w-10 border-4 border-blue-700 border-t-transparent rounded-full mx-auto mb-4" />
        <p className="text-gray-500 text-sm">Memuat data...</p>
      </div>
    </div>
  );

  if (!data) return (
    <div className="flex items-center justify-center min-h-screen bg-gray-50">
      <div className="text-center text-gray-500">
        <p className="text-2xl mb-2">📭</p>
        <p className="font-medium">Belum ada data</p>
        <p className="text-sm mt-1">Ekstrak data terlebih dahulu melalui ekstensi FASIH SE Progress.</p>
      </div>
    </div>
  );

  // ── Main ──────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-[#1a5276] text-white shadow">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-base font-semibold leading-tight">Hasil Ekstraksi FASIH SE</h1>
            <p className="text-blue-200 text-xs mt-0.5 truncate">
              Peran:&nbsp;<span className="capitalize font-medium text-white">{data.role}</span>
              &nbsp;·&nbsp;{fmtDate(data.date)}
              &nbsp;·&nbsp;Wilayah:&nbsp;<span className="font-medium text-white">{data.tag}</span>
            </p>
          </div>
          <div className="flex gap-2 flex-shrink-0">
            <button onClick={downloadJSON}   className="flex items-center gap-1.5 px-3 py-1.5 bg-white/10 hover:bg-white/20 rounded-lg text-sm font-medium transition">↓ JSON</button>
            <button onClick={downloadCSV}    className="flex items-center gap-1.5 px-3 py-1.5 bg-white/10 hover:bg-white/20 rounded-lg text-sm font-medium transition">↓ CSV</button>
            <button onClick={downloadXLSX}   className="flex items-center gap-1.5 px-3 py-1.5 bg-white text-[#1a5276] rounded-lg text-sm font-semibold hover:bg-blue-50 transition">↓ Excel</button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-6 space-y-5">
        {/* Summary cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <SummaryCard label="Petugas Unik" value={users.length.toLocaleString('id-ID')} />
          <SummaryCard label="Total Target"  value={totals.target.toLocaleString('id-ID')} />
          {doneStatus && (
            <SummaryCard label="Selesai" value={totals.done.toLocaleString('id-ID')} sub={`${totals.pct}% dari total target`} accent />
          )}
          <SummaryCard label="Total Wilayah" value={allRegions.length.toLocaleString('id-ID')} />
        </div>

        {/* Overall progress bar */}
        {doneStatus && (
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="flex justify-between text-sm mb-2">
              <span className="font-medium text-gray-700">
                Progress Keseluruhan
                <StatusBadge s={doneStatus} />
              </span>
              <span className="text-gray-500 tabular-nums">
                {totals.done.toLocaleString('id-ID')} / {totals.target.toLocaleString('id-ID')}
              </span>
            </div>
            <div className="w-full bg-gray-100 rounded-full h-3">
              <div className="bg-green-500 h-3 rounded-full transition-all duration-500" style={{ width: `${totals.pct}%` }} />
            </div>
            <p className="text-xs text-gray-400 mt-1.5">{totals.pct}% selesai</p>
          </div>
        )}

        {/* Charts */}
        {users.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <StatusPieChart users={users} statuses={statuses} />
            <TopUsersChart  users={users} doneStatus={doneStatus} />
          </div>
        )}

        {/* Tab switcher */}
        <div className="flex gap-2">
          <TabBtn active={activeTab === 'summary'} onClick={() => setActiveTab('summary')}>Ringkasan Petugas</TabBtn>
          <TabBtn active={activeTab === 'detail'}  onClick={() => setActiveTab('detail')}>Detail Wilayah</TabBtn>
        </div>

        {/* ── Summary tab ── */}
        {activeTab === 'summary' && (
          <>
            <div className="flex items-center gap-3 flex-wrap">
              <input
                type="text"
                placeholder="Cari username, email, atau peran..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-72 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-500">
                Menampilkan <strong>{filtered.length}</strong> dari {users.length} petugas
              </span>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide w-10">#</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Username</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Email</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide cursor-pointer hover:bg-gray-100 select-none" onClick={() => toggleSort('total')}>
                        Target <SortIcon field="total" sortField={sortField} sortDir={sortDir} />
                      </th>
                      {statuses.map(s => (
                        <th key={s} className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide cursor-pointer hover:bg-gray-100 select-none whitespace-nowrap" onClick={() => toggleSort(s)}>
                          {s} <SortIcon field={s} sortField={sortField} sortDir={sortDir} />
                        </th>
                      ))}
                      {doneStatus && <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">Progress</th>}
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
                          <td className="px-4 py-3 text-right font-semibold text-gray-900 tabular-nums">{user.total.toLocaleString('id-ID')}</td>
                          {statuses.map(s => (
                            <td key={s} className="px-4 py-3 text-right tabular-nums">
                              <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${statusColor(s)}`}>
                                {(user.byStatus[s] || 0).toLocaleString('id-ID')}
                              </span>
                            </td>
                          ))}
                          {doneStatus && <td className="px-4 py-3"><MiniBar value={done} max={user.total} /></td>}
                        </tr>
                      );
                    })}
                    {filtered.length === 0 && (
                      <tr><td colSpan={4 + statuses.length + (doneStatus ? 1 : 0)} className="text-center py-10 text-gray-400 text-sm">Tidak ada data yang sesuai pencarian.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {/* ── Detail tab ── */}
        {activeTab === 'detail' && (
          <>
            <div className="flex items-center gap-3 flex-wrap">
              <input
                type="text"
                placeholder="Cari username, kode desa, atau SLS..."
                value={detailSearch}
                onChange={e => setDetailSearch(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-72 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-500">
                Menampilkan <strong>{filteredDetail.length}</strong> dari {allRegions.length} wilayah
              </span>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide w-10">#</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Username</th>
                      <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Desa</th>
                      <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">SLS</th>
                      <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Sub-SLS</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Total</th>
                      {detailStatuses.map(s => (
                        <th key={s} className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">{s}</th>
                      ))}
                      <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filteredDetail.map((r, i) => {
                      const done   = detailDoneStatus ? (r.byStatus[detailDoneStatus] || 0) : 0;
                      const sudah  = r.total > 0 && done >= r.total;
                      return (
                        <tr key={r.userId + '_' + r.regionCode} className="hover:bg-gray-50 transition-colors">
                          <td className="px-4 py-3 text-gray-400 tabular-nums">{i + 1}</td>
                          <td className="px-4 py-3 font-medium text-gray-900">{r.username}</td>
                          <td className="px-4 py-3 text-center font-mono text-gray-600">{r.desa}</td>
                          <td className="px-4 py-3 text-center font-mono text-gray-600">{r.sls}</td>
                          <td className="px-4 py-3 text-center font-mono text-gray-600">{r.subSls}</td>
                          <td className="px-4 py-3 text-right font-semibold text-gray-900 tabular-nums">{r.total.toLocaleString('id-ID')}</td>
                          {detailStatuses.map(s => (
                            <td key={s} className="px-4 py-3 text-right tabular-nums">
                              <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${statusColor(s)}`}>
                                {(r.byStatus[s] || 0).toLocaleString('id-ID')}
                              </span>
                            </td>
                          ))}
                          <td className="px-4 py-3 text-center">
                            <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${sudah ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
                              {sudah ? 'Sudah' : 'Belum'}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                    {filteredDetail.length === 0 && (
                      <tr><td colSpan={6 + detailStatuses.length + 1} className="text-center py-10 text-gray-400 text-sm">Tidak ada data yang sesuai pencarian.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

const root = createRoot(document.getElementById('root'));
root.render(<App />);
