// Kakuyomu Filter Specifications (matching auto-novel / web/src/pages/list/option.ts)
const KAKUYOMU_GENRES = [
  '综合', '异世界幻想', '现代幻想', '科幻', '恋爱', '浪漫喜剧',
  '现代戏剧', '恐怖', '推理', '散文·纪实', '历史·时代·传奇',
  '创作论·评论', '诗·童话·其他'
];
const KAKUYOMU_RANGES = ['总计', '每年', '每月', '每周', '每日'];
const KAKUYOMU_STATUSES = ['全部', '长篇', '短篇'];

// Application State
const state = {
  genre: '综合',
  range: '总计',
  status: '全部',
  page: 1,
  maxPage: 5,
  searchQuery: '',
  onlyTranslated: false,
  items: [],
  isLoading: false,
};

// DOM References
const elements = {
  themeToggleBtn: document.getElementById('themeToggleBtn'),
  themeIcon: document.getElementById('themeIcon'),
  themeText: document.getElementById('themeText'),
  mobileMenuBtn: document.getElementById('mobileMenuBtn'),
  sidebar: document.getElementById('sidebar'),
  drawerOverlay: document.getElementById('drawerOverlay'),
  closeDrawerBtn: document.getElementById('closeDrawerBtn'),
  drawerBody: document.getElementById('drawerBody'),
  genreTags: document.getElementById('genreTags'),
  rangeTags: document.getElementById('rangeTags'),
  statusTags: document.getElementById('statusTags'),
  searchInput: document.getElementById('searchInput'),
  clearSearchBtn: document.getElementById('clearSearchBtn'),
  onlyTranslatedCheckbox: document.getElementById('onlyTranslatedCheckbox'),
  rankCountLabel: document.getElementById('rankCountLabel'),
  refreshBtn: document.getElementById('refreshBtn'),
  loadingBox: document.getElementById('loadingBox'),
  errorBox: document.getElementById('errorBox'),
  errorText: document.getElementById('errorText'),
  retryBtn: document.getElementById('retryBtn'),
  novelListContainer: document.getElementById('novelListContainer'),
  paginationBar: document.getElementById('paginationBar'),
  prevPageBtn: document.getElementById('prevPageBtn'),
  nextPageBtn: document.getElementById('nextPageBtn'),
  pageNumbersContainer: document.getElementById('pageNumbersContainer'),
  toast: document.getElementById('toast'),
};

// Toast
function showToast(msg, duration = 2500) {
  if (!elements.toast) return;
  elements.toast.textContent = msg;
  elements.toast.classList.remove('hidden');
  setTimeout(() => {
    elements.toast.classList.add('hidden');
  }, duration);
}

// Theme
function initTheme() {
  const saved = localStorage.getItem('theme') || 'dark';
  applyThemeUI(saved);

  elements.themeToggleBtn.addEventListener('click', () => {
    const curr = document.documentElement.getAttribute('data-theme');
    const next = curr === 'dark' ? 'light' : 'dark';
    applyThemeUI(next);
  });
}

function applyThemeUI(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('theme', theme);
  elements.themeIcon.textContent = theme === 'dark' ? '🌙' : '☀️';
  if (elements.themeText) {
    elements.themeText.textContent = theme === 'dark' ? '暗色模式' : '亮色模式';
  }
}

// Render Filter Tags (Exact Naive UI n-text tag style)
function renderTags(container, tags, activeTag, onSelect) {
  container.innerHTML = '';
  tags.forEach((tag) => {
    const span = document.createElement('span');
    span.className = `filter-tag ${tag === activeTag ? 'active' : ''}`;
    span.textContent = tag;
    span.addEventListener('click', () => {
      onSelect(tag);
    });
    container.appendChild(span);
  });
}

// Update Filter UI
function updateFilters() {
  renderTags(elements.genreTags, KAKUYOMU_GENRES, state.genre, (t) => {
    state.genre = t;
    state.page = 1;
    updateFilters();
    fetchList();
  });

  renderTags(elements.rangeTags, KAKUYOMU_RANGES, state.range, (t) => {
    state.range = t;
    state.page = 1;
    updateFilters();
    fetchList();
  });

  renderTags(elements.statusTags, KAKUYOMU_STATUSES, state.status, (t) => {
    state.status = t;
    state.page = 1;
    updateFilters();
    fetchList();
  });
}

// ==========================================
// Auto-Recovery Network Client
// ==========================================
let wakeIframe = null;
function triggerServerWake() {
  try {
    if (!wakeIframe) {
      wakeIframe = document.createElement('iframe');
      wakeIframe.style.display = 'none';
      document.body.appendChild(wakeIframe);
    }
    wakeIframe.src = 'novelia-rank://wake';
  } catch (err) {
    console.warn('[Auto-Recovery] Protocol trigger warning:', err);
  }
}

async function waitForServerHealth(maxTimeoutMs = 6000) {
  const start = Date.now();
  while (Date.now() - start < maxTimeoutMs) {
    try {
      const controller = new AbortController();
      const tId = setTimeout(() => controller.abort(), 350);
      const resp = await fetch('/api/health', {
        signal: controller.signal,
        cache: 'no-store'
      });
      clearTimeout(tId);
      if (resp.ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

async function fetchWithAutoWake(url, options = {}) {
  try {
    const resp = await fetch(url, options);
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${resp.status}`);
    }
    return resp;
  } catch (err) {
    const isNetworkError =
      err instanceof TypeError ||
      (err.message && (err.message.includes('Failed to fetch') || err.message.includes('NetworkError')));

    if (isNetworkError) {
      console.log('[Auto-Recovery] Server offline detected. Silently waking up backend...');
      showToast('正在唤醒本地服务...', 3000);
      triggerServerWake();

      const isReady = await waitForServerHealth(6000);
      if (isReady) {
        console.log('[Auto-Recovery] Server ready! Retrying request...');
        registerTab();
        initLifecycleWs();
        const retryResp = await fetch(url, options);
        if (!retryResp.ok) {
          const retryErr = await retryResp.json().catch(() => ({}));
          throw new Error(retryErr.error || `HTTP ${retryResp.status}`);
        }
        return retryResp;
      }
    }
    throw err;
  }
}

// Fetch Kakuyomu list
async function fetchList() {
  if (state.isLoading) return;
  state.isLoading = true;

  elements.loadingBox.classList.remove('hidden');
  elements.errorBox.classList.add('hidden');
  elements.novelListContainer.innerHTML = '';
  elements.rankCountLabel.textContent = '加载中...';

  try {
    const p = new URLSearchParams({
      genre: state.genre,
      range: state.range,
      status: state.status,
      page: state.page.toString(),
    });
    const url = `/api/rank/kakuyomu?${p.toString()}`;

    const resp = await fetchWithAutoWake(url);
    const data = await resp.json();
    state.items = data.items || [];
    state.maxPage = data.pageNumber || 5;

    updatePaginationBar();
    renderItems();
  } catch (err) {
    console.error('Fetch error:', err);
    elements.errorText.textContent = `加载失败: ${err.message}`;
    elements.errorBox.classList.remove('hidden');
    elements.rankCountLabel.textContent = '加载失败';
  } finally {
    state.isLoading = false;
    elements.loadingBox.classList.add('hidden');
  }
}

// Render Novel List Items (Exact NovelListWeb.vue markup & structure)
function renderItems() {
  elements.novelListContainer.innerHTML = '';
  const q = state.searchQuery.trim().toLowerCase();

  const filtered = state.items.filter((item) => {
    if (state.onlyTranslated && !item.titleZh) return false;
    if (!q) return true;
    const matchZh = (item.titleZh || '').toLowerCase().includes(q);
    const matchJp = (item.title || '').toLowerCase().includes(q);
    const matchExtra = (item.extra || '').toLowerCase().includes(q);
    const matchKw = (item.keywords || []).some((k) => k.toLowerCase().includes(q));
    return matchZh || matchJp || matchExtra || matchKw;
  });

  const zhCount = state.items.filter((i) => i.titleZh).length;
  elements.rankCountLabel.textContent = `第 ${state.page} 页 (共 ${filtered.length} 本，${zhCount}/${state.items.length} 已录入中文)`;

  if (filtered.length === 0) {
    elements.novelListContainer.innerHTML = `
      <div style="text-align: center; padding: 48px 0; color: var(--n-text-color-3);">
        空列表
      </div>
    `;
    return;
  }

  filtered.forEach((novel) => {
    const itemEl = document.createElement('div');
    itemEl.className = 'n-list-item';

    // Attentions & Keywords string (separated by /)
    const tagParts = [];
    (novel.attentions || []).forEach((att) => {
      let label = att;
      if (att === 'Cruelty' || att === '残酷描写有り') label = '残酷描写有り';
      else if (att === 'Violence' || att === '暴力描写有り') label = '暴力描写有り';
      else if (att === 'SexualContent' || att === '性描写有り') label = '性描写有り';
      else if (att === 'R18') label = 'R18';
      tagParts.push(`<span>${label}</span>`);
    });
    (novel.keywords || []).forEach((kw) => {
      tagParts.push(`<span>${kw}</span>`);
    });
    const tagsHtml = tagParts.length > 0 ? tagParts.join(' / ') + ' /' : '';

    // Translation stats (e.g. 总计 753 / 有道 752 / GPT 736 / Sakura 753 /)
    let transHtml = '';
    if (novel.translationStats) {
      const { totalChapters, youdao, gpt, sakura } = novel.translationStats;
      transHtml = `
        <div class="n-text-depth-3">
          总计 ${totalChapters} / 有道 ${youdao} / GPT ${gpt} / Sakura ${sakura} /
        </div>
      `;
    }

    itemEl.innerHTML = `
      <!-- Line 1: Japanese Title Link to n.novelia.cc -->
      <div>
        <a href="${novel.noveliaUrl}" target="_blank" rel="noopener noreferrer" class="c-a">
          ${novel.title}
        </a>
      </div>

      <!-- Line 2: Chinese Title (if exists on novelia) -->
      ${novel.titleZh ? `<div class="n-text-zh">${novel.titleZh}</div>` : ''}

      <!-- Line 3: Provider & Novel ID Link -->
      <div>
        <a href="${novel.originUrl}" target="_blank" rel="noopener noreferrer" class="n-a-source">
          ${novel.providerId}.${novel.novelId}
        </a>
      </div>

      <!-- Line 4: Extra Meta (Author / Characters / Points) -->
      ${novel.extra ? `<div class="n-text-depth-3">${novel.extra}</div>` : ''}

      <!-- Line 5: Attention Warnings & Keyword Tags -->
      ${tagsHtml ? `<div class="n-text-depth-3">${tagsHtml}</div>` : ''}

      <!-- Line 6: Translation stats -->
      ${transHtml}
    `;

    elements.novelListContainer.appendChild(itemEl);
  });
}

// Pagination Controls
function updatePaginationBar() {
  if (state.maxPage <= 1) {
    elements.paginationBar.classList.add('hidden');
    return;
  }
  elements.paginationBar.classList.remove('hidden');
  elements.prevPageBtn.disabled = state.page <= 1;
  elements.nextPageBtn.disabled = state.page >= state.maxPage;

  if (elements.pageNumbersContainer) {
    elements.pageNumbersContainer.innerHTML = '';
    for (let i = 1; i <= state.maxPage; i++) {
      const btn = document.createElement('button');
      btn.className = `page-num-btn ${i === state.page ? 'active' : ''}`;
      btn.textContent = i.toString();
      btn.addEventListener('click', () => {
        if (state.page !== i) {
          state.page = i;
          fetchList();
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }
      });
      elements.pageNumbersContainer.appendChild(btn);
    }
  }
}

elements.prevPageBtn.addEventListener('click', () => {
  if (state.page > 1) {
    state.page--;
    fetchList();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
});

elements.nextPageBtn.addEventListener('click', () => {
  if (state.page < state.maxPage) {
    state.page++;
    fetchList();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
});

// Mobile Drawer
elements.mobileMenuBtn.addEventListener('click', () => {
  elements.drawerBody.innerHTML = elements.sidebar.querySelector('.n-menu').outerHTML;
  elements.drawerOverlay.classList.remove('hidden');
});

elements.closeDrawerBtn.addEventListener('click', () => {
  elements.drawerOverlay.classList.add('hidden');
});

elements.drawerOverlay.addEventListener('click', (e) => {
  if (e.target === elements.drawerOverlay) {
    elements.drawerOverlay.classList.add('hidden');
  }
});

// Search & Toggle
elements.searchInput.addEventListener('input', (e) => {
  state.searchQuery = e.target.value;
  elements.clearSearchBtn.classList.toggle('hidden', !state.searchQuery);
  renderItems();
});

elements.clearSearchBtn.addEventListener('click', () => {
  state.searchQuery = '';
  elements.searchInput.value = '';
  elements.clearSearchBtn.classList.add('hidden');
  renderItems();
});

elements.onlyTranslatedCheckbox.addEventListener('change', (e) => {
  state.onlyTranslated = e.target.checked;
  renderItems();
});

elements.refreshBtn.addEventListener('click', () => {
  fetchList();
});

elements.retryBtn.addEventListener('click', () => {
  fetchList();
});

// ==========================================
// Active Tab Lifecycle Registration & Beacon
// ==========================================
const tabId = sessionStorage.getItem('novelia_tab_id') || (() => {
  const id = 'tab_' + Math.random().toString(36).substring(2, 10) + '_' + Date.now();
  sessionStorage.setItem('novelia_tab_id', id);
  return id;
})();

function registerTab() {
  try {
    fetch(`/api/lifecycle/register?tabId=${encodeURIComponent(tabId)}`, {
      method: 'POST',
      cache: 'no-store',
    }).catch(() => {});
  } catch {}
}

function unregisterTab() {
  try {
    const url = `/api/lifecycle/unregister?tabId=${encodeURIComponent(tabId)}`;
    if (navigator.sendBeacon) {
      navigator.sendBeacon(url);
    } else {
      fetch(url, { method: 'POST', keepalive: true }).catch(() => {});
    }
  } catch {}
}

// Register on load and on visibility change
registerTab();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    registerTab();
  }
});

// Unregister ONLY when the tab/window is actively being closed
window.addEventListener('pagehide', () => {
  unregisterTab();
});
window.addEventListener('beforeunload', () => {
  unregisterTab();
});

// WebSocket Lifecycle Connection
function initLifecycleWs() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  let ws = null;

  try {
    ws = new WebSocket(`${protocol}//${location.host}/ws/lifecycle`);
  } catch {
    return;
  }

  ws.onclose = () => {
    // If page is still visible, attempt auto-reconnect
    setTimeout(() => {
      if (document.visibilityState !== 'hidden') {
        initLifecycleWs();
      }
    }, 2000);
  };

  ws.onerror = () => {
    try { ws.close(); } catch {}
  };

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
        initLifecycleWs();
      }
    }
  });
}

initLifecycleWs();

// Initialize
initTheme();
updateFilters();
fetchList();
