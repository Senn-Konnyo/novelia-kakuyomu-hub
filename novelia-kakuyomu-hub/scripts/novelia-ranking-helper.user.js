// ==UserScript==
// @name         Novelia Kakuyomu Ranking Auto-Launcher
// @namespace    https://n.novelia.cc/
// @version      1.4.0
// @description  Automatically launches local Kakuyomu ranking server with instant 0ms optimistic tab feedback on Novelia.cc
// @author       Konyo
// @license      GPL-3.0
// @match        *://n.novelia.cc/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
  'use strict';

  const LOCAL_RANKING_URL = 'http://localhost:3000';
  const PROTOCOL_WAKE_URL = 'novelia-rank://wake';
  const PROTOCOL_START_URL = 'novelia-rank://start';

  // Server state (cached in memory)
  let isServerRunning = false;

  async function checkServerHealth() {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 400);
      const resp = await fetch(`${LOCAL_RANKING_URL}/api/health`, {
        method: 'GET',
        mode: 'cors',
        cache: 'no-store',
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      isServerRunning = resp.ok;
    } catch {
      isServerRunning = false;
    }
  }

  // Pre-check health on load and periodically
  checkServerHealth();
  setInterval(checkServerHealth, 4000);

  let wakeIframe = null;
  function triggerWakeProtocol() {
    try {
      if (!wakeIframe) {
        wakeIframe = document.createElement('iframe');
        wakeIframe.style.display = 'none';
        document.body.appendChild(wakeIframe);
      }
      wakeIframe.src = PROTOCOL_WAKE_URL;
    } catch {
      window.location.href = PROTOCOL_WAKE_URL;
    }
  }

  // Optimistic Instant Tab Creation (0ms UI feedback)
  function openInstantLauncherTab() {
    const newTab = window.open('about:blank', '_blank');
    if (!newTab) {
      // Fallback if popup blocked
      window.location.href = PROTOCOL_START_URL;
      return;
    }

    // 1. Silently wake the backend server in background
    triggerWakeProtocol();

    // 2. Inject Naive UI styled loading skeleton into the newly opened tab
    const loadingHtml = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Kakuyomu：流派 - 正在启动...</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      background-color: #101014;
      color: rgba(255, 255, 255, 0.82);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      text-align: center;
      padding: 24px;
    }
    .spin {
      width: 42px;
      height: 42px;
      border: 3px solid rgba(99, 226, 183, 0.15);
      border-top-color: #63e2b7;
      border-radius: 50%;
      animation: spin 0.7s linear infinite;
      margin-bottom: 24px;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    h2 {
      font-size: 18px;
      font-weight: 500;
      margin-bottom: 8px;
      color: rgba(255, 255, 255, 0.9);
      letter-spacing: -0.2px;
    }
    p {
      font-size: 13px;
      color: rgba(255, 255, 255, 0.45);
      line-height: 1.6;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      margin-top: 20px;
      padding: 4px 14px;
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 3px;
      font-size: 12px;
      color: #63e2b7;
    }
    .retry-btn {
      margin-top: 18px;
      padding: 8px 20px;
      background: #63e2b7;
      color: #000;
      border: none;
      border-radius: 3px;
      cursor: pointer;
      font-size: 13px;
      font-weight: 500;
    }
    .retry-btn:hover { background: #7fe7c4; }
  </style>
</head>
<body>
  <div class="spin"></div>
  <h2>正在启动本地 Kakuyomu 排行榜服务...</h2>
  <p>正在拉起后台爬虫与缓存引擎，即将呈现实时排行</p>
  <div class="badge">🔥 Novelia Kakuyomu Hub</div>

  <script>
    const TARGET = '${LOCAL_RANKING_URL}';
    let count = 0;
    const maxCount = 40; // up to 8s

    async function poll() {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 350);
        const res = await fetch(TARGET + '/api/health', { signal: ctrl.signal, cache: 'no-store' });
        clearTimeout(t);
        if (res.ok) {
          window.location.replace(TARGET);
          return;
        }
      } catch (e) {}

      count++;
      if (count < maxCount) {
        setTimeout(poll, 200);
      } else {
        document.body.innerHTML = \`
          <h2 style="color:#ff6b6b;margin-bottom:8px;">启动超时</h2>
          <p style="margin-bottom:16px;">未能连接到本地服务，请确认 Node.js 环境已安装</p>
          <button class="retry-btn" onclick="window.location.reload()">重新连接</button>
        \`;
      }
    }

    setTimeout(poll, 100);
  <\/script>
</body>
</html>`;

    try {
      newTab.document.open();
      newTab.document.write(loadingHtml);
      newTab.document.close();
    } catch {
      newTab.location.href = LOCAL_RANKING_URL;
    }
  }

  // Check if an element or any of its ancestors represents Kakuyomu ranking
  function isKakuyomuRankingElement(target) {
    if (!target || target === document.body || target === document.documentElement) {
      return false;
    }

    // 0. Exclude novel detail / read / chapter / wenku links explicitly
    const anchor = target.closest('a');
    if (anchor && anchor.href) {
      if (/\/(novel|wenku|read|chapter|favorite|history)\b/i.test(anchor.href) && !/rank/i.test(anchor.href)) {
        return false;
      }
      // 1. Direct anchor href match (e.g. <a href="/rank/web/kakuyomu"> or /rank/...kakuyomu)
      if (/rank.*kakuyomu/i.test(anchor.href)) {
        return true;
      }
    }

    // 2. Naive UI Dropdown Option (when sidebar is folded and mouse hovers flame icon)
    const dropdownOption = target.closest(
      '.n-dropdown-option, .n-dropdown-option-body, [role="menuitem"], [role="option"]'
    );
    if (dropdownOption) {
      const text = (dropdownOption.textContent || '').trim();
      if (/kakuyomu|カクヨム/i.test(text) && /流派|排行|榜|rank/i.test(text)) {
        return true;
      }
    }

    // 3. Naive UI Sidebar Menu Item (when sidebar is expanded)
    const menuItem = target.closest('.n-menu-item, .n-menu-item-content, .n-submenu');
    if (menuItem) {
      const text = (menuItem.textContent || '').trim();
      if (/kakuyomu|カクヨム/i.test(text) && /流派|排行|榜|rank/i.test(text)) {
        return true;
      }
    }

    // 4. Popover / floating tooltip container match
    const popoverItem = target.closest('.n-popover, .n-popover__content');
    if (popoverItem) {
      const text = (popoverItem.textContent || '').trim();
      if (/kakuyomu|カクヨム/i.test(text) && /流派|排行|榜|rank/i.test(text)) {
        return true;
      }
    }

    return false;
  }

  // Handle click synchronously to guarantee zero-lag and prevent popup blocker
  function handleKakuyomuClick(e) {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
      if (typeof e.stopImmediatePropagation === 'function') {
        e.stopImmediatePropagation();
      }
    }

    if (isServerRunning) {
      // Warm start: open immediately
      window.open(LOCAL_RANKING_URL, '_blank');
    } else {
      // Cold start: 0ms Instant Tab Creation with optimistic loading skeleton
      openInstantLauncherTab();
    }
  }

  // Global Capturing Event Listener
  document.addEventListener(
    'click',
    (e) => {
      if (isKakuyomuRankingElement(e.target)) {
        handleKakuyomuClick(e);
      }
    },
    true // Capture phase!
  );

  // Also intercept auxclick (middle click / wheel click)
  document.addEventListener(
    'auxclick',
    (e) => {
      if (e.button === 1 && isKakuyomuRankingElement(e.target)) {
        handleKakuyomuClick(e);
      }
    },
    true
  );

  console.log('[Novelia Kakuyomu Hub] Userscript v1.4.0 active (Optimistic Instant Tab Mode).');
})();
