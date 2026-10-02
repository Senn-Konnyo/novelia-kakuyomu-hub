// ==UserScript==
// @name         Novelia Kakuyomu Next
// @namespace    https://n.novelia.cc/
// @version      3.0.0
// @description  在 novelia.cc 内以纯前端无后端模式无缝浏览完整 Kakuyomu 排行榜
// @author       Novelia Hub Team
// @license      GPL-3.0
// @match        *://n.novelia.cc/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      kakuyomu.jp
// @connect      n.novelia.cc
// @run-at       document-start
// @noframes
// ==/UserScript==

/**
 * Novelia Kakuyomu Next v3.0.0 (Clean-Room Standalone Edition)
 */

(function () {
  'use strict';

  /* ==========================================================================
   * 1. 全局配置与选项映射 (Config & Constants)
   * ========================================================================== */

  const CONFIG = Object.freeze({
    KAKUYOMU_BASE: 'https://kakuyomu.jp',
    NOVELIA_BASE: 'https://n.novelia.cc',
    TOTAL_PAGES: 5,
    PAGE_SIZE: 100,
    ENRICH_CONCURRENCY: 12,
    CACHE_RANKING_TTL_MS: 5 * 60 * 1000,       // 榜单内存缓存 5 分钟
    CACHE_META_TTL_MS: 24 * 60 * 60 * 1000,    // 已收录中文元数据缓存 24 小时
    CACHE_MISS_TTL_MS: 60 * 60 * 1000,        // 未收录元数据缓存 1 小时
    TIMEOUT_RANKING_MS: 15000,
    TIMEOUT_META_MS: 10000,
    MAX_RETRY_ATTEMPTS: 2,
    RETRY_BACKOFF_MS: 400,
    STORAGE_KEY_META: 'novelia_kakuyomu_meta_v3',
    STORAGE_KEY_PREFS: 'novelia_kakuyomu_prefs_v3',
    DEBOUNCE_SEARCH_MS: 200,
    DEBOUNCE_FLUSH_MS: 800,
    HOST_ELEMENT_ID: 'novelia-kakuyomu-next-host',
    PANEL_HASH: '#kakuyomu-rank',
    Z_INDEX: '2147483600',
  });

  const GENRES = [
    { label: '综合', slug: 'all' },
    { label: '异世界幻想', slug: 'fantasy' },
    { label: '现代幻想', slug: 'action' },
    { label: '科幻', slug: 'sf' },
    { label: '恋爱', slug: 'love_story' },
    { label: '浪漫喜剧', slug: 'romance' },
    { label: '现代戏剧', slug: 'drama' },
    { label: '恐怖', slug: 'horror' },
    { label: '推理', slug: 'mystery' },
    { label: '散文·纪实', slug: 'nonfiction' },
    { label: '历史·时代·传奇', slug: 'history' },
    { label: '创作论·评论', slug: 'criticism' },
    { label: '诗·童话·其他', slug: 'others' },
  ];

  const RANGES = [
    { label: '总计', slug: 'entire' },
    { label: '每年', slug: 'yearly' },
    { label: '每月', slug: 'monthly' },
    { label: '每周', slug: 'weekly' },
    { label: '每日', slug: 'daily' },
  ];

  const STATUSES = [
    { label: '全部', slug: 'all' },
    { label: '长篇', slug: 'long' },
    { label: '短篇', slug: 'short' },
  ];

  const ATTENTION_FLAGS = {
    isCruel: '残酷描写有り',
    isViolent: '暴力描写有り',
    isSexual: '性描写有り',
    R18: 'R18',
  };

  /* ==========================================================================
   * 2. 基础工具模块 (Utility Toolkit)
   * ========================================================================== */

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function createElement(tag, className, textContent) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (textContent !== undefined && textContent !== null) el.textContent = textContent;
    return el;
  }

  function debounce(fn, delayMs) {
    let timer = null;
    return function (...args) {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        fn.apply(this, args);
      }, delayMs);
    };
  }

  function safeNumber(val) {
    return typeof val === 'number' && Number.isFinite(val) ? val : 0;
  }

  /**
   * 格式化最后更新相对时间 (如：刚刚、2 天前、11 年前)
   */
  function formatTimeAgo(isoString) {
    if (!isoString) return '';
    const timestamp = new Date(isoString).getTime();
    if (isNaN(timestamp)) return '';
    const elapsedMs = Date.now() - timestamp;
    if (elapsedMs < 0) return '';

    const seconds = Math.floor(elapsedMs / 1000);
    if (seconds < 60) return '刚刚';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes} 分钟前`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} 小时前`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days} 天前`;
    const months = Math.floor(days / 30.4375);
    if (months < 12) return `${months} 个月前`;
    const years = Math.floor(days / 365.25);
    return `${years} 年前`;
  }

  /**
   * 受控并发池异步执行器
   */
  async function runConcurrentPool(items, maxWorkers, taskFn) {
    const outputs = new Array(items.length).fill(null);
    let indexCursor = 0;

    async function worker() {
      while (indexCursor < items.length) {
        const currentIdx = indexCursor++;
        try {
          outputs[currentIdx] = await taskFn(items[currentIdx], currentIdx);
        } catch {
          outputs[currentIdx] = null;
        }
      }
    }

    const workerList = Array.from({ length: Math.min(maxWorkers, items.length) }, worker);
    await Promise.all(workerList);
    return outputs;
  }

  /* ==========================================================================
   * 3. 存储与元数据缓存子系统 (Storage & Metadata Cache)
   * ========================================================================== */

  const memoryMetaCache = new Map();
  let metaFlushTimer = null;

  const userPrefs = {
    theme: 'dark',
    onlyTranslated: false,
  };

  function gmRead(key, fallbackValue) {
    try {
      return Promise.resolve(GM_getValue(key, fallbackValue)).then(
        (res) => (res === undefined ? fallbackValue : res),
        () => fallbackValue
      );
    } catch {
      return Promise.resolve(fallbackValue);
    }
  }

  function gmWrite(key, value) {
    try {
      return Promise.resolve(GM_setValue(key, value)).then(
        () => undefined,
        () => undefined
      );
    } catch {
      return Promise.resolve(undefined);
    }
  }

  async function initializeStorage() {
    const [savedPrefs, savedMeta] = await Promise.all([
      gmRead(CONFIG.STORAGE_KEY_PREFS, null),
      gmRead(CONFIG.STORAGE_KEY_META, null),
    ]);

    if (savedPrefs && typeof savedPrefs === 'object') {
      if (savedPrefs.theme === 'light' || savedPrefs.theme === 'dark') userPrefs.theme = savedPrefs.theme;
      userPrefs.onlyTranslated = Boolean(savedPrefs.onlyTranslated);
    }

    if (savedMeta && typeof savedMeta === 'object') {
      Object.keys(savedMeta).forEach((novelId) => {
        const item = savedMeta[novelId];
        if (item && typeof item.ts === 'number') {
          memoryMetaCache.set(novelId, item);
        }
      });
    }
  }

  function persistPrefs() {
    void gmWrite(CONFIG.STORAGE_KEY_PREFS, {
      theme: userPrefs.theme,
      onlyTranslated: userPrefs.onlyTranslated,
    });
  }

  function getMetaCache(novelId) {
    const cached = memoryMetaCache.get(novelId);
    if (!cached) return null;
    const ttl = cached.zh ? CONFIG.CACHE_META_TTL_MS : CONFIG.CACHE_MISS_TTL_MS;
    return Date.now() - cached.ts < ttl ? cached : null;
  }

  function queueMetaFlush() {
    if (metaFlushTimer) return;
    metaFlushTimer = setTimeout(() => {
      metaFlushTimer = null;
      void flushMetaToStorage();
    }, CONFIG.DEBOUNCE_FLUSH_MS);
  }

  async function flushMetaToStorage() {
    const now = Date.now();
    const payload = {};
    memoryMetaCache.forEach((item, novelId) => {
      const ttl = item.zh ? CONFIG.CACHE_META_TTL_MS : CONFIG.CACHE_MISS_TTL_MS;
      if (now - item.ts < ttl) {
        payload[novelId] = item;
      } else {
        memoryMetaCache.delete(novelId);
      }
    });
    await gmWrite(CONFIG.STORAGE_KEY_META, payload);
  }

  /* ==========================================================================
   * 4. 抢占式网络请求层 (Preemptive HttpClient)
   * ========================================================================== */

  let inFlightRankingRequest = null;

  function executeHttpRequest(url, timeoutMs) {
    let isCancelled = false;
    let requestHandle = null;

    const promise = new Promise((resolve, reject) => {
      requestHandle = GM_xmlhttpRequest({
        method: 'GET',
        url,
        timeout: timeoutMs,
        headers: { 'Accept-Language': 'ja,zh-CN;q=0.9,en;q=0.8' },
        onload: (res) => {
          if (isCancelled) return;
          resolve(res);
        },
        onerror: () => {
          if (isCancelled) return;
          reject(new Error('NETWORK_ERROR'));
        },
        ontimeout: () => {
          if (isCancelled) return;
          reject(new Error('TIMEOUT'));
        },
        onabort: () => {
          reject(new Error('ABORTED'));
        },
      });
    });

    return {
      promise,
      abort: () => {
        isCancelled = true;
        try {
          if (requestHandle && typeof requestHandle.abort === 'function') {
            requestHandle.abort();
          }
        } catch {}
      },
    };
  }

  async function fetchRankingHtmlWithRetry(url, expectedToken) {
    let lastErr = new Error('UNKNOWN_ERROR');

    for (let attempt = 0; attempt <= CONFIG.MAX_RETRY_ATTEMPTS; attempt++) {
      if (expectedToken !== appState.requestToken) throw new Error('ABORTED');
      if (attempt > 0) await wait(CONFIG.RETRY_BACKOFF_MS * attempt);
      if (expectedToken !== appState.requestToken) throw new Error('ABORTED');

      try {
        const client = executeHttpRequest(url, CONFIG.TIMEOUT_RANKING_MS);
        inFlightRankingRequest = client;
        const resp = await client.promise;
        inFlightRankingRequest = null;

        if (expectedToken !== appState.requestToken) throw new Error('ABORTED');
        if (resp.status !== 200) throw new Error(`HTTP_${resp.status}`);
        return resp.responseText;
      } catch (err) {
        if (err && err.message === 'ABORTED') throw err;
        lastErr = err;
      }
    }
    throw lastErr;
  }

  /* ==========================================================================
   * 5. Kakuyomu Apollo 解析器与 Novelia 元数据查询 (Engines)
   * ========================================================================== */

  function parseWorkNode(apolloState, rawNode) {
    const work = apolloState[rawNode && rawNode.__ref];
    if (!work || !work.id) return null;

    const rawTitle = work.alternateTitle || work.alternativeTitle || work.title || '';
    const title = String(rawTitle).trim();
    if (!title) return null;

    const authorNode = apolloState[work.author && work.author.__ref];
    const metaParts = [];

    if (authorNode && authorNode.activityName) metaParts.push(authorNode.activityName);
    if (work.totalCharacterCount) metaParts.push(`${work.totalCharacterCount.toLocaleString()} 字`);
    if (work.totalReviewPoint !== undefined && work.totalReviewPoint !== null) {
      metaParts.push(`${work.totalReviewPoint.toLocaleString()} ★`);
    }

    const updateDate = work.lastEpisodePublishedAt || work.lastPublishedAt || work.publishedAt;
    const timeAgo = formatTimeAgo(updateDate);
    if (timeAgo) metaParts.push(timeAgo);

    const attentions = Object.keys(ATTENTION_FLAGS)
      .filter((flagKey) => Boolean(work[flagKey]))
      .map((flagKey) => ATTENTION_FLAGS[flagKey]);

    return {
      novelId: work.id,
      title,
      attentions,
      keywords: Array.isArray(work.tagLabels) ? work.tagLabels : [],
      extra: metaParts.join(' / '),
    };
  }

  function parseKakuyomuPage(htmlString) {
    const parserDoc = new DOMParser().parseFromString(htmlString, 'text/html');
    const nextDataScript = parserDoc.querySelector('#__NEXT_DATA__');
    if (!nextDataScript) throw new Error('NO_NEXT_DATA');

    let apolloState = null;
    try {
      const nextJson = JSON.parse(nextDataScript.textContent);
      apolloState = nextJson.props?.pageProps?.__APOLLO_STATE__;
    } catch {
      throw new Error('NO_NEXT_DATA');
    }
    if (!apolloState || !apolloState.ROOT_QUERY) throw new Error('NO_NEXT_DATA');

    const rootKey = Object.keys(apolloState.ROOT_QUERY).find((key) => key.startsWith('rankedWorks'));
    const workNodes = rootKey ? apolloState.ROOT_QUERY[rootKey].nodes : null;
    if (!Array.isArray(workNodes) || workNodes.length === 0) throw new Error('EMPTY_RANKING');

    return workNodes.map((node) => parseWorkNode(apolloState, node)).filter(Boolean);
  }

  const memoryRankingCache = new Map();

  function resolveRankingEndpoint() {
    const selectedGenre = GENRES.find((g) => g.label === appState.genre) || GENRES[0];
    const selectedRange = RANGES.find((r) => r.label === appState.range) || RANGES[0];
    const selectedStatus = STATUSES.find((s) => s.label === appState.status) || STATUSES[0];

    return {
      targetUrl: `${CONFIG.KAKUYOMU_BASE}/rankings/${selectedGenre.slug}/${selectedRange.slug}?work_variation=${selectedStatus.slug}&page=${appState.page}`,
      cacheKey: `${selectedGenre.slug}|${selectedRange.slug}|${selectedStatus.slug}|${appState.page}`,
    };
  }

  async function fetchKakuyomuRanking(expectedToken, forceBypassCache = false) {
    const { targetUrl, cacheKey } = resolveRankingEndpoint();

    if (forceBypassCache) {
      memoryRankingCache.delete(cacheKey);
    } else {
      const cached = memoryRankingCache.get(cacheKey);
      if (cached && Date.now() - cached.ts < CONFIG.CACHE_RANKING_TTL_MS) {
        return cached.items;
      }
    }

    const html = await fetchRankingHtmlWithRetry(targetUrl, expectedToken);
    const novelItems = parseKakuyomuPage(html);
    memoryRankingCache.set(cacheKey, { ts: Date.now(), items: novelItems });
    return novelItems;
  }

  async function fetchNoveliaMetaForNovel(novelId) {
    const cached = getMetaCache(novelId);
    if (cached) return cached;

    let result = { zh: null, stats: null };
    try {
      const metaUrl = `${CONFIG.NOVELIA_BASE}/api/novel/kakuyomu/${encodeURIComponent(novelId)}`;
      const httpTask = executeHttpRequest(metaUrl, CONFIG.TIMEOUT_META_MS);
      const resp = await httpTask.promise;

      if (resp.status === 200) {
        const data = JSON.parse(resp.responseText);
        const hasStats = [data.jp, data.youdao, data.gpt, data.sakura].some((v) => typeof v === 'number');
        result = {
          zh: data.titleZh || null,
          stats: hasStats ? {
            total: safeNumber(data.jp),
            youdao: safeNumber(data.youdao),
            gpt: safeNumber(data.gpt),
            sakura: safeNumber(data.sakura),
          } : null,
        };
      }
    } catch {
      result = { zh: null, stats: null };
    }

    const cacheEntry = { zh: result.zh, stats: result.stats, ts: Date.now() };
    memoryMetaCache.set(novelId, cacheEntry);
    queueMetaFlush();
    return cacheEntry;
  }

  /* ==========================================================================
   * 6. 界面设计系统与 CSS 样式 (Naive UI Design Tokens)
   * ========================================================================== */

  const DESIGN_SYSTEM_CSS = `
:host {
  --n-font-family: v-sans, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  --n-body-color: #101014;
  --n-header-color: #18181c;
  --n-sider-color: #18181c;
  --n-card-color: #18181c;
  --n-border-color: rgba(255, 255, 255, 0.09);
  --n-text-color: rgba(255, 255, 255, 0.82);
  --n-text-color-2: rgba(255, 255, 255, 0.65);
  --n-text-color-3: rgba(255, 255, 255, 0.45);
  --n-primary-color: #63e2b7;
  --n-primary-color-hover: #7fe7c4;
  --n-tag-color: rgba(255, 255, 255, 0.06);
  --n-input-color: rgba(255, 255, 255, 0.06);
}

:host([data-theme='light']) {
  --n-body-color: #ffffff;
  --n-header-color: #ffffff;
  --n-sider-color: #ffffff;
  --n-card-color: #ffffff;
  --n-border-color: rgba(0, 0, 0, 0.09);
  --n-text-color: #1f2225;
  --n-text-color-2: #333639;
  --n-text-color-3: #767c82;
  --n-primary-color: #18a058;
  --n-primary-color-hover: #36ad6a;
  --n-tag-color: rgba(0, 0, 0, 0.04);
  --n-input-color: rgba(0, 0, 0, 0.04);
}

* { margin: 0; padding: 0; box-sizing: border-box; }
.hidden { display: none !important; }

/* 页面根容器 */
.hub-root {
  position: fixed;
  inset: 0;
  background-color: var(--n-body-color);
  color: var(--n-text-color);
  font-family: var(--n-font-family);
  font-size: 14px;
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
  z-index: ${CONFIG.Z_INDEX};
  overflow: hidden;
}

a { color: inherit; text-decoration: none; }

/* 双栏框架 */
.n-layout {
  position: fixed;
  inset: 0;
  overflow: hidden;
}

/* 顶部固定导航栏 (50px) */
.n-layout-header {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 50px;
  background-color: var(--n-header-color);
  border-bottom: 1px solid var(--n-border-color);
  z-index: 100;
}

.header-inner {
  display: flex;
  align-items: center;
  height: 100%;
  padding: 0 16px;
  gap: 12px;
}

.logo-wrapper {
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  user-select: none;
}

.robot-icon {
  color: var(--n-primary-color);
  display: flex;
  align-items: center;
  justify-content: center;
}

.logo-title {
  font-size: 14px;
  font-weight: 500;
  color: var(--n-text-color);
}

.header-spacer { flex: 1; }

/* 左侧常驻侧边栏 (240px) */
.n-layout-sider {
  width: 240px;
  background-color: var(--n-sider-color);
  border-right: 1px solid var(--n-border-color);
  position: absolute;
  top: 50px;
  bottom: 0;
  left: 0;
  z-index: 90;
  overflow-y: auto;
  scrollbar-width: thin;
}

.n-layout-sider::-webkit-scrollbar { width: 6px; }
.n-layout-sider::-webkit-scrollbar-thumb {
  background: var(--n-border-color);
  border-radius: 3px;
}

.sider-content {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 14px 10px 18px 10px;
}

.n-menu {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.n-menu-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 13px 16px;
  min-height: 44px;
  border-radius: 4px;
  font-size: 14px;
  font-weight: 400;
  color: var(--n-text-color);
  background: transparent;
  border: none;
  width: 100%;
  text-align: left;
  cursor: pointer;
  font-family: inherit;
  box-sizing: border-box;
  transition: background-color 0.15s ease, color 0.15s ease;
}

.n-menu-item:hover {
  background-color: var(--n-tag-color);
  color: var(--n-primary-color);
}

.n-menu-item-icon {
  width: 22px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 17px;
  line-height: 1;
  flex-shrink: 0;
}

.n-menu-item-text {
  font-size: 14px;
  font-weight: 400;
  flex: 1;
}

.n-menu-group {
  margin-top: 6px;
}

.n-menu-group-header {
  font-size: 14px;
  font-weight: 400;
  color: var(--n-text-color);
  cursor: default;
  user-select: none;
}

.n-menu-subitems {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding-left: 0;
  margin-top: 2px;
}

.n-menu-subitem {
  display: flex;
  align-items: center;
  padding: 11px 16px 11px 50px;
  min-height: 40px;
  border-radius: 4px;
  font-size: 14px;
  font-weight: 400;
  color: var(--n-text-color-2);
  background: transparent;
  border: none;
  text-align: left;
  cursor: pointer;
  font-family: inherit;
  box-sizing: border-box;
  transition: all 0.15s ease;
  width: 100%;
}

.n-menu-subitem:hover {
  background-color: var(--n-tag-color);
  color: var(--n-primary-color);
}

.n-menu-subitem.active {
  color: var(--n-primary-color);
  background-color: rgba(99, 226, 183, 0.1);
  font-weight: 500;
}

/* 右侧独立滚动内容区 (从 50px 起始，滚动条顶部不被遮盖) */
.n-layout-content {
  position: absolute;
  top: 50px;
  bottom: 0;
  left: 240px;
  right: 0;
  overflow-y: auto;
  padding: 24px 32px 64px;
  scrollbar-width: thin;
}

.n-layout-content::-webkit-scrollbar { width: 8px; }
.n-layout-content::-webkit-scrollbar-thumb {
  background: var(--n-border-color);
  border-radius: 4px;
}

.layout-content-inner {
  max-width: 1080px;
  margin: 0 auto;
}

.n-h1 {
  font-size: 28px;
  font-weight: 500;
  color: var(--n-text-color);
  margin-top: 0;
  margin-bottom: 20px;
  letter-spacing: -0.2px;
}

/* 筛选区域 */
.n-list-filter {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 8px;
  margin-bottom: 16px;
}

.filter-row {
  display: flex;
  align-items: baseline;
  gap: 16px;
}

.filter-label {
  font-size: 14px;
  font-weight: 500;
  color: var(--n-text-color);
  min-width: 42px;
  flex-shrink: 0;
}

.filter-tags {
  display: flex;
  flex-wrap: wrap;
  column-gap: 16px;
  row-gap: 6px;
}

.filter-tag {
  font-size: 14px;
  font-weight: 400;
  color: var(--n-text-color);
  cursor: pointer;
  user-select: none;
  transition: color 0.15s ease;
}
.filter-tag:hover { color: var(--n-primary-color-hover); }
.filter-tag.active { color: var(--n-primary-color); font-weight: 500; }

/* 搜索与工具条 */
.filter-search-row {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-top: 8px;
  flex-wrap: wrap;
}

.search-box {
  position: relative;
  width: 320px;
  max-width: 100%;
}

.search-box input {
  width: 100%;
  height: 34px;
  background-color: var(--n-input-color);
  border: 1px solid var(--n-border-color);
  border-radius: 4px;
  padding: 0 28px 0 10px;
  font-size: 13px;
  color: var(--n-text-color);
  outline: none;
  font-family: inherit;
  transition: border-color 0.2s ease;
}
.search-box input:focus { border-color: var(--n-primary-color); }

.clear-btn {
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  background: none;
  border: none;
  color: var(--n-text-color-3);
  font-size: 12px;
  cursor: pointer;
}

.checkbox-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--n-text-color-2);
  cursor: pointer;
  user-select: none;
}
.checkbox-label input { display: none; }
.checkbox-custom {
  width: 16px;
  height: 16px;
  border: 1px solid var(--n-border-color);
  border-radius: 3px;
  background-color: var(--n-input-color);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s ease;
}
.checkbox-label input:checked + .checkbox-custom {
  background-color: var(--n-primary-color);
  border-color: var(--n-primary-color);
}
.checkbox-label input:checked + .checkbox-custom::after {
  content: '✓';
  font-size: 11px;
  color: #000000;
  font-weight: 800;
}

.rank-count-label {
  font-size: 13px;
  color: var(--n-text-color-3);
  margin-left: auto;
}

.refresh-btn {
  background: transparent;
  border: 1px solid var(--n-border-color);
  color: var(--n-text-color);
  padding: 5px 12px;
  border-radius: 4px;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s ease;
}
.refresh-btn:hover {
  border-color: var(--n-primary-color);
  color: var(--n-primary-color);
}

.n-divider {
  height: 1px;
  background-color: var(--n-border-color);
  margin: 16px 0;
}

/* 状态加载框 */
.loading-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 0;
  gap: 16px;
  color: var(--n-text-color-3);
}

.n-spin {
  width: 36px;
  height: 36px;
  border: 3px solid rgba(99, 226, 183, 0.15);
  border-top-color: var(--n-primary-color);
  border-radius: 50%;
  animation: n-spin 0.7s linear infinite;
}
@keyframes n-spin { to { transform: rotate(360deg); } }

.error-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 0;
  gap: 16px;
  color: #e88080;
}

.n-button--primary {
  background-color: var(--n-primary-color);
  color: #000000;
  border: 1px solid var(--n-primary-color);
  padding: 6px 16px;
  border-radius: 3px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
}

/* 小说列表项 */
.n-list { display: flex; flex-direction: column; }

.n-list-item {
  padding: 12px 0;
  border-bottom: 1px solid var(--n-border-color);
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-family: var(--n-font-family);
  font-size: 14px;
  line-height: 1.5;
}
.n-list-item:hover { background-color: rgba(255, 255, 255, 0.015); }

.c-a {
  font-size: 14px;
  color: var(--n-primary-color);
  cursor: pointer;
  display: inline;
  font-weight: 500;
  transition: color 0.15s ease;
}
.c-a:hover {
  color: var(--n-primary-color-hover);
  text-decoration: underline;
}

.n-text-zh { font-size: 14px; color: var(--n-text-color); }
.n-text-zh.muted { color: var(--n-text-color-3); }

.n-a-source {
  font-size: 14px;
  color: var(--n-primary-color);
  display: inline-block;
  transition: color 0.15s ease;
}
.n-a-source:hover {
  color: var(--n-primary-color-hover);
  text-decoration: underline;
}

.n-text-depth-3 { font-size: 14px; color: var(--n-text-color-3); }

/* 分页控件 */
.pagination-bar {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 8px;
  margin: 24px 0;
}

.page-numbers-container {
  display: flex;
  align-items: center;
  gap: 6px;
}

.n-button-page, .page-num-btn {
  background: transparent;
  border: 1px solid var(--n-border-color);
  color: var(--n-text-color);
  min-width: 32px;
  height: 32px;
  padding: 0 10px;
  border-radius: 3px;
  font-size: 13px;
  cursor: pointer;
  font-family: inherit;
  transition: all 0.15s ease;
}
.n-button-page:hover:not(:disabled), .page-num-btn:hover {
  border-color: var(--n-primary-color);
  color: var(--n-primary-color);
}
.n-button-page:disabled { opacity: 0.35; cursor: not-allowed; }
.page-num-btn.active {
  background-color: rgba(99, 226, 183, 0.12);
  border-color: var(--n-primary-color);
  color: var(--n-primary-color);
  font-weight: 600;
}

@media (max-width: 768px) {
  .n-layout-sider { display: none; }
  .n-layout-content { left: 0; padding: 16px; }
  .search-box { width: 100%; }
  .rank-count-label { margin-left: 0; }
}
`;

  const TEMPLATE_HTML = `
<div class="hub-root">
  <div class="n-layout">
    <!-- 顶部导航栏 -->
    <header class="n-layout-header">
      <div class="header-inner">
        <div class="logo-wrapper" data-act="nav-home" title="返回主站">
          <div class="robot-icon">
            <svg viewBox="0 0 1024 1024" width="28" height="28" fill="currentColor">
              <path d="M512 64a448 448 0 1 1-448 448 448 448 0 0 1 448-448m0-64a512 512 0 1 0 512 512A512 512 0 0 0 512 0z" />
              <path d="M512 256a64 64 0 0 0-64 64v64h128v-64a64 64 0 0 0-64-64m-160 256a64 64 0 1 0 64 64 64 64 0 0 0-64-64m320 0a64 64 0 1 0 64 64 64 64 0 0 0-64-64m-384 192a64 64 0 0 0 64 64h320a64 64 0 0 0 64-64z" />
            </svg>
          </div>
          <span class="logo-title">轻小说机翻机器人</span>
        </div>
        <div class="header-spacer"></div>
      </div>
    </header>

    <!-- 左侧常驻导航栏 -->
    <aside class="n-layout-sider">
      <div class="sider-content">
        <nav class="n-menu">
          <a href="https://n.novelia.cc/" class="n-menu-item" data-act="nav-home">
            <span class="n-menu-item-icon">🏠</span>
            <span class="n-menu-item-text">首页</span>
          </a>
          <a href="https://n.novelia.cc/favorite/web" class="n-menu-item" data-act="nav-out">
            <span class="n-menu-item-icon">⭐</span>
            <span class="n-menu-item-text">我的收藏</span>
          </a>
          <a href="https://n.novelia.cc/read-history" class="n-menu-item" data-act="nav-out">
            <span class="n-menu-item-icon">🕒</span>
            <span class="n-menu-item-text">历史记录</span>
          </a>
          <a href="https://n.novelia.cc/novel" class="n-menu-item" data-act="nav-out">
            <span class="n-menu-item-icon">🌐</span>
            <span class="n-menu-item-text">网络小说</span>
          </a>
          <a href="https://n.novelia.cc/wenku" class="n-menu-item" data-act="nav-out">
            <span class="n-menu-item-icon">📚</span>
            <span class="n-menu-item-text">文库小说</span>
          </a>

          <!-- 排行榜导航组 -->
          <div class="n-menu-group">
            <div class="n-menu-group-header n-menu-item">
              <span class="n-menu-item-icon">🔥</span>
              <span class="n-menu-item-text">小说排行</span>
            </div>
            <div class="n-menu-subitems">
              <a href="https://n.novelia.cc/rank/web/syosetu/1" class="n-menu-subitem" data-act="nav-out">
                <span>成为小说家：流派</span>
              </a>
              <a href="https://n.novelia.cc/rank/web/syosetu/2" class="n-menu-subitem" data-act="nav-out">
                <span>成为小说家：综合</span>
              </a>
              <a href="https://n.novelia.cc/rank/web/syosetu/3" class="n-menu-subitem" data-act="nav-out">
                <span>成为小说家：异世界转移/转生</span>
              </a>
              <button class="n-menu-subitem active">
                <span>Kakuyomu：流派</span>
              </button>
            </div>
          </div>

          <!-- 主题切换键 -->
          <button class="n-menu-item" data-act="theme" title="切换暗色/亮色模式">
            <span class="n-menu-item-icon theme-icon">🌙</span>
            <span class="n-menu-item-text theme-text">暗色模式</span>
          </button>
        </nav>
      </div>
    </aside>

    <!-- 右侧主体内容滚动区 -->
    <main class="n-layout-content">
      <div class="layout-content-inner">
        <h1 class="n-h1">Kakuyomu：流派</h1>

        <!-- 筛选栏 -->
        <div class="n-list-filter">
          <div class="filter-row">
            <span class="filter-label">流派</span>
            <div class="filter-tags" data-filter="genre"></div>
          </div>
          <div class="filter-row">
            <span class="filter-label">范围</span>
            <div class="filter-tags" data-filter="range"></div>
          </div>
          <div class="filter-row">
            <span class="filter-label">状态</span>
            <div class="filter-tags" data-filter="status"></div>
          </div>

          <div class="filter-search-row">
            <div class="search-box">
              <input type="text" class="search-input" placeholder="搜索中文译名 / 日文标题 / 作者..." autocomplete="off" />
              <button class="clear-btn hidden" data-act="clear-search">✕</button>
            </div>
            <label class="checkbox-label" title="只展示已被 novelia 收录并拥有中文译名的小说">
              <input type="checkbox" class="only-zh" />
              <span class="checkbox-custom"></span>
              <span class="checkbox-text">仅看已收录中文</span>
            </label>
            <span class="rank-count-label">加载中...</span>
            <button class="refresh-btn" data-act="refresh" title="强制刷新榜单数据">🔄 刷新</button>
          </div>
        </div>

        <div class="n-divider"></div>

        <!-- 状态呈现 -->
        <div class="loading-box hidden">
          <div class="n-spin"></div>
          <p>正在获取实时榜单数据...</p>
        </div>

        <div class="error-box hidden">
          <p class="error-text">获取榜单失败</p>
          <button class="n-button--primary" data-act="retry">重试</button>
        </div>

        <!-- 小说列表容器 -->
        <div class="n-list"></div>

        <!-- 分页栏 -->
        <div class="pagination-bar hidden">
          <button class="n-button-page" data-act="prev" disabled>上一页</button>
          <div class="page-numbers-container"></div>
          <button class="n-button-page" data-act="next">下一页</button>
        </div>

        <div class="n-divider"></div>
      </div>
    </main>
  </div>
</div>
`;

  /* ==========================================================================
   * 7. 响应式状态管理 (Reactive State Store)
   * ========================================================================== */

  const appState = {
    genre: '综合',
    range: '总计',
    status: '全部',
    page: 1,
    searchQuery: '',
    onlyTranslated: false,
    items: [],
    isLoading: false,
    errorMessage: '',
    viewState: 'loading',
    requestToken: 0,
  };

  let shadowHostNode = null;
  let shadowRootRefs = null;
  let isPanelVisible = false;

  /* ==========================================================================
   * 8. 视图构建与渲染引擎 (View & Render Engine)
   * ========================================================================== */

  function mountShadowApp() {
    const host = createElement('div');
    host.id = CONFIG.HOST_ELEMENT_ID;
    host.style.setProperty('position', 'fixed', 'important');
    host.style.setProperty('top', '0', 'important');
    host.style.setProperty('left', '0', 'important');
    host.style.setProperty('right', '0', 'important');
    host.style.setProperty('bottom', '0', 'important');
    host.style.setProperty('z-index', CONFIG.Z_INDEX, 'important');
    host.style.setProperty('display', 'none', 'important');

    const shadow = host.attachShadow({ mode: 'open' });
    const styleEl = createElement('style');
    styleEl.textContent = DESIGN_SYSTEM_CSS;
    shadow.appendChild(styleEl);

    const rootEl = createElement('div');
    rootEl.innerHTML = TEMPLATE_HTML;
    shadow.appendChild(rootEl);

    const refs = {
      host,
      root: rootEl,
      genreTags: rootEl.querySelector('[data-filter="genre"]'),
      rangeTags: rootEl.querySelector('[data-filter="range"]'),
      statusTags: rootEl.querySelector('[data-filter="status"]'),
      searchInput: rootEl.querySelector('.search-input'),
      searchClear: rootEl.querySelector('.clear-btn'),
      onlyZhCheckbox: rootEl.querySelector('.only-zh'),
      statusLabel: rootEl.querySelector('.rank-count-label'),
      loadingBox: rootEl.querySelector('.loading-box'),
      errorBox: rootEl.querySelector('.error-box'),
      errorText: rootEl.querySelector('.error-text'),
      novelList: rootEl.querySelector('.n-list'),
      paginationBar: rootEl.querySelector('.pagination-bar'),
      pageNumsContainer: rootEl.querySelector('.page-numbers-container'),
      prevBtn: rootEl.querySelector('[data-act="prev"]'),
      nextBtn: rootEl.querySelector('[data-act="next"]'),
      themeIcon: rootEl.querySelector('.theme-icon'),
      themeText: rootEl.querySelector('.theme-text'),
      contentScroll: rootEl.querySelector('.n-layout-content'),
    };

    bindDOMEvents(refs);
    return { host, refs };
  }

  function getOrMountApp() {
    if (!shadowHostNode) {
      const { host, refs } = mountShadowApp();
      shadowHostNode = host;
      shadowRootRefs = refs;
      document.body.appendChild(host);
    }
    return shadowRootRefs;
  }

  function renderTagRow(container, options, activeLabel, onSelect) {
    container.textContent = '';
    options.forEach((opt) => {
      const tagSpan = createElement('span', `filter-tag${opt.label === activeLabel ? ' active' : ''}`, opt.label);
      tagSpan.addEventListener('click', () => onSelect(opt.label));
      container.appendChild(tagSpan);
    });
  }

  function renderAllFilterTags(refs) {
    renderTagRow(refs.genreTags, GENRES, appState.genre, (val) => {
      if (appState.genre === val) return;
      appState.genre = val;
      appState.page = 1;
      renderAllFilterTags(refs);
      void executeRankingPipeline(refs);
    });

    renderTagRow(refs.rangeTags, RANGES, appState.range, (val) => {
      if (appState.range === val) return;
      appState.range = val;
      appState.page = 1;
      renderAllFilterTags(refs);
      void executeRankingPipeline(refs);
    });

    renderTagRow(refs.statusTags, STATUSES, appState.status, (val) => {
      if (appState.status === val) return;
      appState.status = val;
      appState.page = 1;
      renderAllFilterTags(refs);
      void executeRankingPipeline(refs);
    });
  }

  function createNovelRowNode(item) {
    const rowEl = createElement('div', 'n-list-item');
    rowEl.dataset.novelId = item.novelId;

    // Line 1: 日文原名链接
    const line1 = createElement('div');
    const titleLink = createElement('a', 'c-a', item.title);
    titleLink.href = `${CONFIG.NOVELIA_BASE}/novel/kakuyomu/${item.novelId}`;
    titleLink.target = '_blank';
    titleLink.rel = 'noopener noreferrer';
    line1.appendChild(titleLink);
    rowEl.appendChild(line1);

    // Line 2: 中文译名
    const zhDiv = createElement('div', 'n-text-zh');
    rowEl.appendChild(zhDiv);

    // Line 3: 来源 ID 链接
    const line3 = createElement('div');
    const sourceLink = createElement('a', 'n-a-source', `kakuyomu.${item.novelId}`);
    sourceLink.href = `${CONFIG.KAKUYOMU_BASE}/works/${item.novelId}`;
    sourceLink.target = '_blank';
    sourceLink.rel = 'noopener noreferrer';
    line3.appendChild(sourceLink);
    rowEl.appendChild(line3);

    // Line 4: 元数据 (作者 / 字数 / ★评分 / 更新时间)
    if (item.extra) {
      rowEl.appendChild(createElement('div', 'n-text-depth-3', item.extra));
    }

    // Line 5: 警告标签与关键词
    const tagsCombined = item.attentions.concat(item.keywords);
    if (tagsCombined.length > 0) {
      rowEl.appendChild(createElement('div', 'n-text-depth-3', `${tagsCombined.join(' / ')} /`));
    }

    // Line 6: 翻译进度统计
    rowEl.appendChild(createElement('div', 'n-text-depth-3 stats-row'));

    updateRowWithMeta(rowEl, item);
    return rowEl;
  }

  function updateRowWithMeta(rowEl, item) {
    const zhNode = rowEl.querySelector('.n-text-zh');
    if (item.titleZh) {
      zhNode.textContent = item.titleZh;
      zhNode.classList.remove('muted');
    } else {
      zhNode.textContent = item.metaLoaded ? '（n.novelia.cc 暂未收录）' : '（载入中…）';
      zhNode.classList.add('muted');
    }

    const statsNode = rowEl.querySelector('.stats-row');
    if (item.stats) {
      const { total, youdao, gpt, sakura } = item.stats;
      statsNode.textContent = `总计 ${total} / 有道 ${youdao} / GPT ${gpt} / Sakura ${sakura} /`;
    } else {
      statsNode.textContent = '';
    }
  }

  function getFilteredNovelList() {
    const query = appState.searchQuery.trim().toLowerCase();
    return appState.items.filter((item) => {
      if (appState.onlyTranslated && !item.titleZh) return false;
      if (!query) return true;
      const matchPool = [item.title, item.titleZh, item.extra].concat(item.keywords || []);
      return matchPool.some((text) => text && String(text).toLowerCase().includes(query));
    });
  }

  function renderNovelList(refs) {
    const filtered = getFilteredNovelList();
    refs.novelList.textContent = '';

    if (filtered.length === 0) {
      refs.novelList.appendChild(
        createElement('div', 'n-text-depth-3', appState.isLoading ? '正在载入…' : '空列表')
      );
      return;
    }

    const fragment = document.createDocumentFragment();
    filtered.forEach((novel) => fragment.appendChild(createNovelRowNode(novel)));
    refs.novelList.appendChild(fragment);
  }

  function renderPagination(refs) {
    refs.paginationBar.classList.toggle('hidden', CONFIG.TOTAL_PAGES <= 1);
    refs.prevBtn.disabled = appState.page <= 1;
    refs.nextBtn.disabled = appState.page >= CONFIG.TOTAL_PAGES;

    refs.pageNumsContainer.textContent = '';
    for (let p = 1; p <= CONFIG.TOTAL_PAGES; p++) {
      const numBtn = createElement('button', `page-num-btn${p === appState.page ? ' active' : ''}`, String(p));
      numBtn.addEventListener('click', () => {
        if (appState.page === p) return;
        appState.page = p;
        refs.contentScroll.scrollTo({ top: 0, behavior: 'smooth' });
        renderPagination(refs);
        void executeRankingPipeline(refs);
      });
      refs.pageNumsContainer.appendChild(numBtn);
    }
  }

  function updateStatusSummary(refs) {
    if (appState.isLoading && appState.items.length === 0) {
      refs.statusLabel.textContent = '加载中...';
      return;
    }
    if (appState.errorMessage) {
      refs.statusLabel.textContent = '加载失败';
      return;
    }
    if (appState.items.length === 0) {
      refs.statusLabel.textContent = '';
      return;
    }
    const zhCount = appState.items.filter((item) => item.titleZh).length;
    refs.statusLabel.textContent = `第 ${appState.page} 页 (共 ${getFilteredNovelList().length} 本，${zhCount}/${appState.items.length} 已录入中文)`;
  }

  const debouncedRefreshStatus = debounce((refs) => updateStatusSummary(refs), 150);

  function setDisplayView(refs, viewMode) {
    appState.viewState = viewMode;
    refs.loadingBox.classList.toggle('hidden', viewMode !== 'loading');
    refs.errorBox.classList.toggle('hidden', viewMode !== 'error');
    if (viewMode === 'error') refs.paginationBar.classList.add('hidden');
  }

  function applyActiveTheme(refs) {
    refs.host.setAttribute('data-theme', userPrefs.theme);
    if (refs.themeIcon) refs.themeIcon.textContent = userPrefs.theme === 'dark' ? '🌙' : '☀️';
    if (refs.themeText) refs.themeText.textContent = userPrefs.theme === 'dark' ? '暗色模式' : '亮色模式';
  }

  /* ==========================================================================
   * 9. 核心加载与异步数据补全流水线 (Pipeline Controller)
   * ========================================================================== */

  async function asynchronouslyEnrichMetadata(refs, token) {
    const listSnapshot = appState.items.slice();
    await runConcurrentPool(listSnapshot, CONFIG.ENRICH_CONCURRENCY, async (item) => {
      const meta = await fetchNoveliaMetaForNovel(item.novelId);
      if (token !== appState.requestToken) return;

      item.titleZh = meta.zh;
      item.stats = meta.stats;
      item.metaLoaded = true;

      const matchedRow = refs.novelList.querySelector(`[data-novel-id="${item.novelId}"]`);
      if (matchedRow) updateRowWithMeta(matchedRow, item);
      debouncedRefreshStatus(refs);
    });

    if (token !== appState.requestToken) return;
    if (appState.searchQuery || appState.onlyTranslated) renderNovelList(refs);
    updateStatusSummary(refs);
  }

  async function executeRankingPipeline(refs, isForceRefresh = false) {
    // 抢占式打断在途网络请求
    if (inFlightRankingRequest && typeof inFlightRankingRequest.abort === 'function') {
      inFlightRankingRequest.abort();
    }

    const currentToken = ++appState.requestToken;
    appState.isLoading = true;
    appState.errorMessage = '';
    appState.items = [];

    setDisplayView(refs, 'loading');
    refs.novelList.textContent = '';
    updateStatusSummary(refs);

    try {
      const rawNovels = await fetchKakuyomuRanking(currentToken, isForceRefresh);
      if (currentToken !== appState.requestToken) return;

      appState.items = rawNovels.map((novel, index) => ({
        ...novel,
        rank: (appState.page - 1) * CONFIG.PAGE_SIZE + index + 1,
        titleZh: null,
        stats: null,
        metaLoaded: false,
      }));

      appState.isLoading = false;
      setDisplayView(refs, 'list');
      renderNovelList(refs);
      renderPagination(refs);
      updateStatusSummary(refs);

      await asynchronouslyEnrichMetadata(refs, currentToken);
    } catch (err) {
      if (err && err.message === 'ABORTED') return;
      if (currentToken !== appState.requestToken) return;

      appState.errorMessage = err.message || '获取排行榜失败';
      refs.errorText.textContent = `获取排行榜失败: ${appState.errorMessage}`;
      setDisplayView(refs, 'error');
    } finally {
      if (currentToken === appState.requestToken) {
        appState.isLoading = false;
        updateStatusSummary(refs);
      }
    }
  }

  /* ==========================================================================
   * 10. 用户交互与面板状态控制 (Interaction & Routing)
   * ========================================================================== */

  function handleActionTrigger(action, refs) {
    switch (action) {
      case 'close':
        hidePanel();
        break;
      case 'nav-home':
        hidePanel();
        if (location.pathname !== '/') location.href = 'https://n.novelia.cc/';
        break;
      case 'nav-out':
        hidePanel();
        break;
      case 'refresh':
      case 'retry':
        void executeRankingPipeline(refs, true);
        break;
      case 'theme':
        userPrefs.theme = userPrefs.theme === 'dark' ? 'light' : 'dark';
        persistPrefs();
        applyActiveTheme(refs);
        break;
      case 'clear-search':
        appState.searchQuery = '';
        refs.searchInput.value = '';
        refs.searchClear.classList.add('hidden');
        renderNovelList(refs);
        updateStatusSummary(refs);
        break;
      case 'prev':
        if (appState.page > 1) {
          appState.page--;
          refs.contentScroll.scrollTo({ top: 0, behavior: 'smooth' });
          renderPagination(refs);
          void executeRankingPipeline(refs);
        }
        break;
      case 'next':
        if (appState.page < CONFIG.TOTAL_PAGES) {
          appState.page++;
          refs.contentScroll.scrollTo({ top: 0, behavior: 'smooth' });
          renderPagination(refs);
          void executeRankingPipeline(refs);
        }
        break;
      default:
        break;
    }
  }

  function bindDOMEvents(refs) {
    refs.root.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act]');
      if (btn) handleActionTrigger(btn.dataset.act, refs);
    });

    refs.searchInput.addEventListener('input', debounce(() => {
      appState.searchQuery = refs.searchInput.value;
      refs.searchClear.classList.toggle('hidden', !appState.searchQuery);
      renderNovelList(refs);
      updateStatusSummary(refs);
    }, CONFIG.DEBOUNCE_SEARCH_MS));

    refs.onlyZhCheckbox.addEventListener('change', () => {
      appState.onlyTranslated = refs.onlyZhCheckbox.checked;
      userPrefs.onlyTranslated = appState.onlyTranslated;
      persistPrefs();
      renderNovelList(refs);
      updateStatusSummary(refs);
    });
  }

  function displayPanel() {
    if (!document.body) return;
    if (isPanelVisible) return;

    const refs = getOrMountApp();
    applyActiveTheme(refs);
    refs.host.style.setProperty('display', 'block', 'important');
    isPanelVisible = true;

    renderAllFilterTags(refs);
    refs.onlyZhCheckbox.checked = appState.onlyTranslated;
    refs.searchInput.value = appState.searchQuery;
    refs.searchClear.classList.toggle('hidden', !appState.searchQuery);

    if (appState.items.length === 0) {
      void executeRankingPipeline(refs);
    } else {
      setDisplayView(refs, appState.viewState);
      renderNovelList(refs);
      renderPagination(refs);
      updateStatusSummary(refs);
    }

    if (location.hash !== CONFIG.PANEL_HASH) {
      history.pushState(null, '', location.pathname + location.search + CONFIG.PANEL_HASH);
    }
  }

  function hidePanel() {
    if (!isPanelVisible || !shadowHostNode) return;
    shadowHostNode.style.setProperty('display', 'none', 'important');
    isPanelVisible = false;

    if (location.hash === CONFIG.PANEL_HASH) {
      history.replaceState(null, '', location.pathname + location.search);
    }
  }

  function isKakuyomuRankingLink(element) {
    if (!element || element === document.body || element === document.documentElement) return false;

    const anchor = element.closest('a');
    if (anchor && anchor.href) {
      const href = anchor.href;
      const isNovelPath = /\/(novel|wenku|read|chapter|favorite|history)\b/i.test(href);
      if (isNovelPath && !/rank/i.test(href)) return false;
      if (/rank.*kakuyomu/i.test(href)) return true;
    }

    const menuSelectors = [
      '.n-dropdown-option, .n-dropdown-option-body, [role="menuitem"], [role="option"]',
      '.n-menu-item, .n-menu-item-content, .n-submenu',
      '.n-popover, .n-popover__content',
    ];
    return menuSelectors.some((sel) => {
      const node = element.closest(sel);
      if (!node) return false;
      const text = (node.textContent || '').trim();
      return /kakuyomu|カクヨム/i.test(text) && /流派|排行|榜|rank/i.test(text);
    });
  }

  function setupInterceptors() {
    document.addEventListener('click', (e) => {
      if (!isKakuyomuRankingLink(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
      displayPanel();
    }, true);

    document.addEventListener('auxclick', (e) => {
      if (e.button !== 1 || !isKakuyomuRankingLink(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      displayPanel();
    }, true);

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && isPanelVisible) {
        e.preventDefault();
        e.stopPropagation();
        hidePanel();
      }
    }, true);

    window.addEventListener('hashchange', () => {
      if (location.hash === CONFIG.PANEL_HASH) displayPanel();
      else hidePanel();
    });
  }

  /* ==========================================================================
   * 11. 启动入口 (Bootstrap)
   * ========================================================================== */

  function bootstrap() {
    setupInterceptors();

    void initializeStorage().then(() => {
      appState.onlyTranslated = userPrefs.onlyTranslated;
      if (isPanelVisible && shadowRootRefs) {
        applyActiveTheme(shadowRootRefs);
        shadowRootRefs.onlyZhCheckbox.checked = appState.onlyTranslated;
      }
    });

    const onDocumentReady = () => {
      if (location.hash === CONFIG.PANEL_HASH) displayPanel();
    };

    if (document.body) onDocumentReady();
    else document.addEventListener('DOMContentLoaded', onDocumentReady, { once: true });
  }

  bootstrap();
})();
