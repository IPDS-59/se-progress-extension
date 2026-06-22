const FASIH_HOST = 'fasih-sm.bps.go.id';
const FASIH_APP = 'fasih-sm.bps.go.id/app';

const ROLES = {
  pengawas: { id: '93bcf446-c4c1-4462-8ed0-4b0f7ae89e52', label: 'pengawas' },
  pencacah: { id: '6d7d919a-45e5-4779-bb87-2905b49fd31a', label: 'pencacah' },
};

let selectedRole = null;
let selectedProv = '72';
let kabList = [];
let activeTabId = null;

function show(stepId) {
  document.querySelectorAll('.step').forEach(el => el.classList.add('hidden'));
  document.getElementById(stepId).classList.remove('hidden');
}

function appendLog(text, type = 'info') {
  const logEl = document.getElementById('log');
  if (!logEl) return;
  const line = document.createElement('div');
  line.className = 'log-' + type;
  line.textContent = text;
  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight;
}

function showDone(result) {
  show('step-done');
  if (result) {
    document.getElementById('done-summary').innerHTML =
      `<br>Petugas unik: <strong>${result.total}</strong> &nbsp;|&nbsp; Baris CSV: <strong>${result.csvRows}</strong>`;
  }
}

// Listen for messages from content script
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'PROGRESS') {
    appendLog(message.text, message.logType || 'info');
    if (message.statusText) {
      const el = document.getElementById('progress-text');
      if (el) el.textContent = message.statusText;
    }
  } else if (message.type === 'DONE') {
    chrome.storage.session.set({ fasih: { state: 'done', result: message.result } });
    showDone(message.result);
  } else if (message.type === 'FETCH_ERROR') {
    appendLog('Error: ' + message.error, 'error');
    chrome.storage.session.set({ fasih: { state: 'idle' } });
    document.getElementById('progress-text').textContent = 'Gagal';
  }
});

async function getCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab;
}

async function init() {
  show('step-init');

  const stored = await chrome.storage.session.get('fasih');
  const state = stored.fasih?.state;

  if (state === 'running') {
    show('step-progress');
    const el = document.getElementById('progress-text');
    if (el) el.textContent = stored.fasih.statusText || 'Memproses...';
    const buffered = stored.fasih.log || [];
    buffered.forEach(entry => appendLog(entry.text, entry.logType));
    return;
  }

  if (state === 'done') {
    showDone(stored.fasih.result);
    return;
  }

  const tab = await getCurrentTab();
  if (!tab?.url?.includes(FASIH_HOST)) {
    show('step-wrong-page');
    return;
  }

  if (!tab.url.includes(FASIH_APP)) {
    document.querySelector('#step-wrong-page .notice-warn').innerHTML =
      'Buka <strong>fasih-sm.bps.go.id/app</strong> (bukan halaman lama), lalu klik ikon ekstensi ini lagi.';
    show('step-wrong-page');
    return;
  }

  activeTabId = tab.id;

  // Confirm content script is active (it won't be if the page was open before extension was installed)
  chrome.tabs.sendMessage(tab.id, { type: 'PING' }, (response) => {
    if (chrome.runtime.lastError || !response?.ok) {
      document.querySelector('#step-wrong-page .notice-warn').innerHTML =
        'Tab FASIH ditemukan, tapi perlu <strong>reload halaman</strong> terlebih dahulu (Ctrl+R / Cmd+R).';
      show('step-wrong-page');
      return;
    }
    show('step-prov');
  });
}

async function selectRole(roleKey) {
  selectedRole = ROLES[roleKey];
  document.getElementById('btn-pengawas').disabled = true;
  document.getElementById('btn-pencacah').disabled = true;
  show('step-loading');

  const tab = activeTabId ? { id: activeTabId } : await getCurrentTab();
  chrome.tabs.sendMessage(tab.id, { type: 'GET_KABS', role: selectedRole, prov: selectedProv }, (response) => {
    if (chrome.runtime.lastError || !response?.ok) {
      const detail = response?.error || chrome.runtime.lastError?.message || 'Periksa koneksi VPN lalu coba lagi.';
      document.getElementById('error-detail').textContent = detail;
      show('step-error');
      return;
    }
    kabList = response.kabs;
    renderKabList();
    show('step-select-kabs');
  });
}

function renderKabList() {
  const listEl = document.getElementById('kab-list');
  listEl.innerHTML = '';
  kabList.forEach((kab, i) => {
    const label = document.createElement('label');
    label.className = 'kab-item';
    const chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.dataset.index = i;
    chk.addEventListener('change', updateStartBtn);
    const span = document.createElement('span');
    span.textContent = kab.name;
    label.appendChild(chk);
    label.appendChild(span);
    listEl.appendChild(label);
  });
}

function updateStartBtn() {
  const checked = document.querySelectorAll('#kab-list input:checked').length;
  document.getElementById('btn-start').disabled = checked === 0;
  document.getElementById('kab-count').textContent = checked + ' dipilih';
}

document.getElementById('chk-all').addEventListener('change', function () {
  document.querySelectorAll('#kab-list input').forEach(c => { c.checked = this.checked; });
  updateStartBtn();
});

document.getElementById('btn-prov-next').addEventListener('click', () => {
  selectedProv = document.getElementById('sel-prov').value;
  show('step-role');
});

document.getElementById('btn-pengawas').addEventListener('click', () => selectRole('pengawas'));
document.getElementById('btn-pencacah').addEventListener('click', () => selectRole('pencacah'));

document.getElementById('btn-start').addEventListener('click', async () => {
  const chosen = [...document.querySelectorAll('#kab-list input:checked')]
    .map(c => kabList[+c.dataset.index]);

  show('step-progress');
  await chrome.storage.session.set({ fasih: { state: 'running', statusText: 'Memulai...' } });

  const tab = activeTabId ? { id: activeTabId } : await getCurrentTab();
  chrome.tabs.sendMessage(tab.id, { type: 'FETCH_DATA', role: selectedRole, kabs: chosen });
});

document.getElementById('btn-view-results').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('results.html') });
});

document.getElementById('btn-retry').addEventListener('click', () => {
  document.getElementById('btn-pengawas').disabled = false;
  document.getElementById('btn-pencacah').disabled = false;
  show('step-prov');
});

document.getElementById('btn-restart').addEventListener('click', async () => {
  await chrome.storage.session.remove('fasih');
  document.getElementById('btn-pengawas').disabled = false;
  document.getElementById('btn-pencacah').disabled = false;
  show('step-prov');
});

init();
