# Novelia Kakuyomu Next 🚀

> **Clean-Room, Zero-Backend Tampermonkey Userscript** for browsing live Kakuyomu rankings directly within [n.novelia.cc](https://n.novelia.cc/).

---

## ✨ Highlights & Key Features

- 🟢 **Zero-Backend (Serverless)**: Runs 100% inside your browser via Tampermonkey without running any Node.js servers, Python crawlers, or local proxy services.
- ⚡ **Preemptive Request Pipeline**: Instant tab/filter switching with immediate cancellation (`AbortController` + sequential `requestToken`) of all pending network traffic to prevent race conditions and UI desync.
- 🎨 **1:1 Naive UI Desktop Layout**:
  - Fixed 50px header with integrated Novelia robot logo and seamless view toggling.
  - Dedicated 240px left sidebar with ergonomic button dimensions (`min-height: 44px`) and smooth dark/light theme switching.
  - Independent content viewport starting cleanly at `top: 50px` (no top scrollbar clipping behind the header).
- ⭐ **Rich Novel Information**:
  - Kakuyomu **★ points** display (e.g. `73,529 ★`).
  - Formatted word counts with thousand separators (e.g. `1,234,567 字`).
  - Relative update timestamps (e.g. `2 天前`, `11 年前`, `3 个月前`).
  - 4-way translation engine status (Youdao, Baidu, GPT-3.5, Claude / Novelia MT) with chapter counts and instant read links.
- 🔄 **Smart Caching & Force Refresh**:
  - 5-minute memory cache for ranking data with instantaneous navigation.
  - Dedicated **🔄 刷新** button in the filter toolbar for forced real-time updates.
  - 24-hour persistent storage cache (`GM_setValue`) for Novelia metadata.
- 🛡️ **Shadow DOM Encapsulation**: Isolated styles ensuring 0% CSS collision with Novelia host pages.

---

## 📦 Directory Structure

```text
novelia-kakuyomu-next/
├── novelia-kakuyomu.user.js  # Main standalone userscript (v3.0.0)
└── README.md                 # Project documentation & usage guide
```

---

## 🛠️ Installation & Usage

### 1. Requirements
- A modern Chromium / Firefox / Safari browser.
- [Tampermonkey](https://www.tampermonkey.net/) extension installed.

### 2. Install Script
1. Open Tampermonkey Dashboard -> **Utilities** -> **File** / **Create a new script**.
2. Copy the entire contents of [`novelia-kakuyomu.user.js`](file:///d:/Projects/crawler/novelia-kakuyomu-next/novelia-kakuyomu.user.js).
3. Paste and save (`Ctrl + S`).

### 3. Usage
1. Navigate to [https://n.novelia.cc/](https://n.novelia.cc/).
2. Click the **角川 (Kakuyomu)** entry in the top navigation or press the toggle trigger.
3. Enjoy live ranking browsing with instant genre filtering, keyword searching, and translation status tracking!
4. Press **Esc** or click the top-left logo / **🏠 首页** button to return to the Novelia home page.

---

## 📜 License
GPL-3.0 License.
