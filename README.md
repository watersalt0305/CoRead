# CoRead

**和 AI 一起读书的电子书阅读器**

> *"读到精彩的段落，随手圈起来和 AI 讨论；每本书都有独立的对话历史，就像为每本书配了一位专属读书伙伴。"*

CoRead 是一个专注沉浸式阅读与 AI 协作的开源电子书阅读器。支持 EPUB、TXT、Markdown 格式，提供精心调校的排版主题，并内置与 AI 的深度对话能力——选中任意段落即可发起讨论，每本书的对话独立保存，切换书籍时自动恢复上下文。

当前实现为 [Operit](https://github.com/AAswordman/Operit) 平台的 ToolPkg 插件（Android），核心阅读逻辑采用纯前端技术（HTML + CSS + JavaScript），未来计划适配独立 Web 版。

---

## 💡 为什么需要 CoRead？

**传统阅读器的痛点**：
- 看到想讨论的段落，需要切换 App、复制粘贴、再回来继续读，打断沉浸感
- 批注和讨论混在一起，找不到上次和 AI 聊了什么
- 切换书籍后，AI 不记得你们之前讨论过这本书的内容

**CoRead 的解决方案**：
- ✅ **零切换讨论**：选中段落 → 弹出菜单 → 直接与 AI 对话，全程不离开阅读界面
- ✅ **每书独立历史**：《虐杀器官》的讨论不会混进《索拉里斯星》，清晰有序
- ✅ **智能上下文恢复**：切换到新对话时，AI 会自动看到"你们之前讨论过这本书的这些内容"

---

## ✨ 核心功能

### 📖 **沉浸式阅读体验**

- **滚动 + 翻页双模式**：喜欢连续滚动？还是传统翻页？随你选
- **9 套精心调校的配色主题**：浅色 6 款（纸墨、秋日、蜜桃、杏林、雾蓝、森野）、深色 2 款（暖夜、夜潭）、墨水屏特典 1 款，每套都经过 92%+ 明度浅色底、去荧光深色的视觉优化
- **无级排版调节**：字号、行距、段间距、页边距独立控制，找到最舒适的阅读参数
- **多字体支持**：内置多种字体，支持切换

### ✍️ **划线批注系统**

- **4 种标记样式**：下划线 / 波浪线 / 直线 / 高亮块，满足不同标记习惯
- **批注与划线分离**：划线只是视觉标记，批注可以随时添加、编辑、删除
- **书签面板统一管理**：所有批注一目了然，点击即可跳转到原文位置
- **翻页模式精准定位**：即使在翻页模式下，也能准确跳转到批注所在页

### 🤖 **AI 共读（核心亮点）**

- **选中即讨论**：看到想聊的段落？选中 → 点击"发送给 AI" → 开始对话，流式回复实时显示
- **每本书独立对话历史**：《虐杀器官》讨论了 20 条，《索拉里斯星》讨论了 15 条，互不干扰，切换书籍时自动加载对应历史
- **智能上下文注入**：切换到新对话时，AI 会自动看到"之前你们讨论过这本书的内容摘要（最近 8 条）"，无需手动复述
- **本地留存**：所有讨论记录本地保存为 JSON，随时回顾

**使用场景举例**：
- 读到《虐杀器官》里"这种杀人的意念，是出于自我吗？"，选中发给 AI，讨论自由意志与暴力的关系
- 读完一章《索拉里斯星》，选中某段关于"索拉里斯海"的描述，让 AI 帮你梳理这个科幻概念
- 遇到不理解的哲学术语，选中后问 AI"这段话是什么意思？"

---

## 🎨 配色主题一览

每套主题都经过精心调校，确保长时间阅读的舒适性：

| 主题 | 类型 | 背景 | 强调色 | 墨色 | 特点 |
|------|------|------|--------|------|------|
| 纸墨 | 浅色 | `#F4F1EA` | `#C25946` | `#2C2A28` | 经典米白（默认） |
| 秋日 | 浅色 | `#F7F3ED` | `#BF6430` | `#2F403E` | 暖米 + 橙棕 |
| 蜜桃 | 浅色 | `#FFF5F1` | `#447F8F` | `#59221D` | 粉底 + 蓝绿 |
| 杏林 | 浅色 | `#FAF6EE` | `#315955` | `#012626` | 杏黄 + 深绿 |
| 雾蓝 | 浅色 | `#E9EBEB` | `#5B84AE` | `#141A2B` | 灰白 + 蓝调 |
| 森野 | 浅色 | `#F4F4F0` | `#8CC152` | `#0E2E1B` | 灰白 + 草绿 |
| 暖夜 | 深色 | `#1C1C1E` | `#F09B6E` | `#F2D9A4` | 暖橙 + 米黄墨 |
| 夜潭 | 深色 | `#0F2C30` | `#D98566` | `#E5C3B2` | 墨绿黑 + 暖橙 |
| 墨水屏 | 特典 | `#FFFFFF` | `#000000` | `#000000` | 纯黑白极简 |

**设计原则**：
- 浅色主题：底色统一保持 92%+ 明度，容器背景仅比底色深一档，保证过渡平滑
- 深色主题：去荧光，避免高饱和度大面积铺陈，降低视觉疲劳
- 框线取文字色而非强调色，保持视觉统一

---

## 🚀 快速开始

### 前置要求

- 已安装 [Operit](https://github.com/AAswordman/Operit) Android 版
- 需要下载 JSZip（EPUB 解析依赖）：
  ```bash
  curl -L -o dist/ui/reader/jszip.min.js \
    https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js
  ```

### 安装步骤

1. **克隆仓库**
   ```bash
   git clone <your-repo-url>
   cd CoRead
   ```

2. **下载依赖**
   ```bash
   curl -L -o dist/ui/reader/jszip.min.js \
     https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js
   ```

3. **调整路径**  
   编辑 `dist/ui/reader/index.ui.js`，修改顶部的 `READER_HTML_PATH` 为你的仓库绝对路径：
   ```js
   var READER_HTML_PATH = "file:///<你的仓库绝对路径>/dist/ui/reader/reader.html";
   ```

4. **安装到 Operit**  
   让 AI 执行：
   ```
   use_package operit_editor
   debug_install_toolpkg source_path="/path/to/CoRead"
   ```

5. **配置 AI 共读**  
   首次使用需绑定对话，让 AI 执行：
   ```
   set_coread_config chat_id="<你的对话ID>" card_name="<可选角色卡名>"
   ```

配置文件保存在 `/sdcard/Download/Operit/CoRead2/_coread_config.json`。

---

## 📁 项目结构

```
CoRead/
├── manifest.json                    # ToolPkg 清单（toolpkg_id = coread2）
├── dist/
│   ├── main.js                      # 注册 UiRoute + 侧边栏入口
│   ├── subpkg/
│   │   ├── coread_config.js         # AI 配置读写子包
│   │   └── coread_tools.js          # AI 批注工具子包
│   └── ui/reader/
│       ├── index.ui.js              # WebView 宿主 + JS 桥（AI 通信、文件读写）
│       ├── reader.html              # 页面结构
│       ├── reader.css               # 全部样式
│       ├── reader.js                # 全部逻辑
│       └── jszip.min.js             # EPUB 解析（需自行下载）
└── LICENSE
```

**架构亮点**：
- 阅读器核心（`reader.html` / `reader.css` / `reader.js`）完全独立，不依赖 Operit API，可在浏览器里直接运行
- 平台耦合集中在 `main.js`、`index.ui.js` 和 `subpkg/`，这也是未来适配独立 Web 版的切分线
- 数据存储：IndexedDB 库 `CoRead_V2`（书籍数据），localStorage（阅读偏好和划线，前缀 `cr_` / `cr-`）

---

## 🛠️ 开发笔记

踩过的坑，留给后来者参考：

- **WebView 缓存问题**：CSS / JS 通过 `?v=Date.now()` 绕过缓存。改了不生效就重启 Operit
- **ToolPkg screen 注册**：`screen` 函数必须从独立 `.ui.js` 文件 require 进来，不能在 `main.js` 内联定义
- **进度保存顺序**：`closeReader()` 里必须先 `saveProgress()` 再移除 `active` 类，否则 `display:none` 会把 `scrollTop` 重置为 0
- **EPUB 样式隔离**：`sanitizeEpubCss()` 给所有选择器加 `.page-text` 前缀，防止电子书自带样式泄漏污染阅读器 UI
- **内联 `</` 陷阱**：JS 若回退到内联 `<script>`，所有 `</` 需写成 `\x3C/` 避免被浏览器错误解析

---

## 🗺️ 路线图

**近期计划**：
- [ ] 批注汇总页面（数据层已就绪，只差 UI）
- [ ] 导出对话记录为 Markdown / JSON
- [ ] 批注搜索与筛选功能

**长期计划**：
- [ ] 独立 Web 版适配（去除 Operit 平台依赖）
- [ ] 漫画 / CBZ 支持
- [ ] 高亮恢复改用 TreeWalker 或 Range 序列化（替代当前的正则方案）
- [ ] PDF 支持探索

**社区期待**：
- 欢迎提交 Issue / PR
- 欢迎贡献新的配色主题
- 欢迎适配到其他 AI 平台

---

## ⚠️ 已知问题

- **高亮恢复机制**：当前使用正则替换 innerHTML 恢复高亮，如果划线文本跨越多个 HTML 标签，可能会把 `<mark>` 插进已有标签的属性里，导致标签源码直接显示为文字（计划用 TreeWalker 重构）
- **批注弹窗可见性**：部分主题下按钮可能存在对比度不足的情况（持续优化中）

遇到问题欢迎提 Issue！

---

## 📜 许可

本项目采用 [GNU Affero General Public License v3.0](LICENSE) 开源。

**这意味着**：
- ✅ 你可以自由使用、修改、分发本项目
- ✅ 你可以基于它构建商业项目
- ⚠️ 如果你修改后通过网络提供服务（如 Web 版），必须向使用者公开你的修改后源码
- ⚠️ 修改后的衍生作品也必须使用 AGPLv3 许可

选择 AGPLv3 是为了确保 CoRead 及其衍生项目始终保持开源，让更多人受益。

---

## 🙏 致谢

- **[JSZip](https://github.com/Stuk/jszip)** — EPUB 解包的核心依赖
- **[Material Symbols](https://fonts.google.com/icons)** — 图标系统
- **[Operit](https://github.com/AAswordman/Operit)** — 提供 AI 集成能力与运行平台
- **所有测试用户和贡献者** — 感谢你们的反馈和支持

---

## 💬 联系与反馈

- **Issues**：遇到 Bug 或有功能建议？[提交 Issue](你的仓库 Issues 链接)
- **讨论**：加入我们的讨论区分享阅读心得和使用技巧
- **贡献**：欢迎提交 PR！无论是修复 Bug、新增功能还是改进文档

---

<div align="center">

**用 CoRead 开启你的 AI 共读之旅 📖✨**

如果这个项目对你有帮助，欢迎 Star ⭐ 支持！

</div>
