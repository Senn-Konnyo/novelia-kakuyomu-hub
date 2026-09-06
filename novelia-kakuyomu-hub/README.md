Novelia Kakuyomu Ranking Hub

暂代替[机翻站](https://n.novelia.cc) 提供完整的 Kakuyomu 排名页。完全由Gemini 3.7 Flash构建，笔者几乎不会写代码，别说全栈开发了。爬虫功能全部在本地进行，点击条目跳转至本站或机翻站。只确凿支持Windows端Chrome浏览器，没有在Edge上进行测试。

---

1. 上手
- 1.1 环境/前置
   - [Node.js](https://nodejs.org/) (v18 or higher recommended).
   - [Tampermonkey](https://www.tampermonkey.net/) (Google Chrome extension).

2. 安装
- 2.1 安装本地服务
   - 双击`install.bat`
- 2.2安装脚本
   - 2.2.1 手动安装
      - 点击扩展程序（拼图图标）
      - 弹出菜单选择“Tampermonkey”图标
      - 点击“管理面板”
      - 点击新建脚本（加号图标）
      - 将`scripts/novelia-ranking-helper.user.js`的内容复制到文本编辑器中
      - 将内容粘贴到Tampermonkey编辑器中
      - 保存
   - 2.2.2 Greasy Fork 安装（没测试过）
      - 访问[Greasy Fork](https://greasyfork.org/zh-CN)
      - 搜索`Novelia Kakuyomu Ranking Helper`
      - 点击安装

3. 使用
   - 访问[n.novelia.cc](https://n.novelia.cc)并点击左侧菜单的“kakuyomu：流派”
   - 本地服务会自动启动并打开排名页面

4. 卸载
   - 双击`uninstall.bat`

---

归属与许可

上游项目: 基于[auto-novel](https://github.com/auto-novel/auto-novel) (Commit `d44b8a5fe7fa`) 派生。这不是一个novelia.cc开发者提供的项目。

许可: [GNU General Public License v3.0 (GPL-3.0)](LICENSE)。

免责声明:本项目仅用于个人学习和非商业社区用途。所有排名内容和知识产权归其各自的原始平台（Kakuyomu / Syosetu）所有。
