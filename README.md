# CoRead

一个开源的 EPUB / TXT / Markdown 阅读器，带划线批注与 AI 共读能力。

当前实现形态是 [Operit](https://github.com/AAswordman/Operit) 平台的 ToolPkg 插件（Android），核心阅读逻辑是纯前端的 HTML + CSS + JavaScript，未来计划适配独立 Web 版。

> 本仓库以**参考实现**为定位公开：只包含源码，不含编译/打包产物。

## 特性

**阅读**
- EPUB 解析（JSZip + OPF spine）、TXT / Markdown 导入（按标题模式自动分章）
- 滚动阅读 + 左右区域点击翻页
- 章节目录面板
- 进度记忆，按书独立（含 `visibilitychange` 兜底保存）

**排版与主题**
- 字号 / 行距 / 段间距 / 页边距无级调节，多字体切换
- 9 套配色主题，含专为 E-ink 优化的墨水屏特典主题
- 自定义强调色、圆角、皮肤与装饰开关

**批注**
- 选中文字 → 浮动菜单 → 高亮 → 批注框
- 4 种划线样式：下划线 / 波浪线 / 直线 / 高亮块

**AI 共读**
- 选中段落直接发起与 AI 的讨论，支持流式回复
- 会话切换时自动注入上下文摘要，讨论历史本地留存

### 配色主题

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

配色设计原则：浅色主题底色统一保持 92%+ 明度；容器背景仅比底色深一档，保证过渡平滑；框线取文字色而非强调色；深色主题去荧光，避免高饱和度大面积铺陈。

## 项目结构

```
├── manifest.json                    ToolPkg 清单（toolpkg_id = coread2）
├── dist/
│   ├── main.js                      注册 UiRoute + 侧边栏入口
│   ├── subpkg/
│   │   └── coread_config.js         AI 共读配置读写子包（暴露给 AI 调用）
│   └── ui/reader/
│       ├── index.ui.js              WebView 宿主 + JS 桥（AI 通信、文件读写）
│       ├── reader.html              页面结构
│       ├── reader.css               全部样式（UI 框架 / 阅读器 / 面板 / 批注）
│       └── reader.js               全部逻辑
└── LICENSE
```

阅读器主体（`reader.html` / `reader.css` / `reader.js`）不依赖 Operit API，可独立在浏览器里跑；平台耦合集中在 `main.js`、`index.ui.js` 和 `subpkg/`，这也是后续做 Web 版的切分线。

## 运行

### 依赖

需要自备 [JSZip](https://github.com/Stuk/jszip)（EPUB 解压用，未随仓库分发）：

```bash
curl -L -o dist/ui/reader/jszip.min.js \
  https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js
```

### 在 Operit 中安装

`index.ui.js` 顶部的 `READER_HTML_PATH` 是硬编码绝对路径，克隆后需改成你自己的仓库位置：

```js
var READER_HTML_PATH = "file:///<你的仓库绝对路径>/dist/ui/reader/reader.html";
```

然后通过 Operit 的 `operit_editor:debug_install_toolpkg` 指向仓库根目录安装，入口出现在侧边栏。

### AI 共读配置

首次使用需绑定一个 Operit 对话：让 AI 调用 `set_coread_config`，传入 `chat_id`（可选 `card_name`），重新打开 CoRead 生效。配置落在 `/sdcard/Download/Operit/CoRead2/_coread_config.json`。

## 开发笔记

踩过的坑，留给后来者：

- **WebView 缓存**：CSS / JS 通过 `?v=Date.now()` 绕过。改了不生效就重启 Operit。
- **ToolPkg screen 注册**：`screen` 函数必须从独立 `.ui.js` 文件 require 进来，不能在 `main.js` 内联定义。
- **进度保存顺序**：`closeReader()` 里必须先 `saveProgress()` 再移除 `active` 类，否则 `display:none` 会把 `scrollTop` 重置为 0。
- **EPUB 样式泄漏**：`sanitizeEpubCss()` 给所有选择器加 `.page-text` 前缀，隔离电子书自带样式。
- **内联 `</` 陷阱**：JS 若回退到内联 `<script>`，所有 `</` 需写成 `\x3C/`。

数据存储：IndexedDB 库 `CoRead_V2`，store `books`，存 `fileData`(base64) / `title` / `author` / `coverData` / `__txtChapters`。阅读偏好与划线数据在 localStorage，前缀 `cr_` / `cr-`。

## 路线图

- [ ] 独立 Web 版适配
- [ ] 批注 Tab 汇总页（数据层已就绪）
- [ ] 漫画 / CBZ 支持
- [ ] 高亮恢复改用 TreeWalker 或 Range 序列化（当前正则方案在跨标签文本上会破坏 DOM）

## 已知问题

- `restoreHighlights()` 用正则替换 innerHTML 恢复高亮，划线文本跨越多个 HTML 标签时会把 `<mark>` 插进已有标签的属性里，导致标签源码直接显示为文字。
- 批注弹窗按钮在部分主题下可能存在可见性问题。

## 许可

[GNU Affero General Public License v3.0](LICENSE)

AGPLv3 意味着：你可以自由使用、修改、分发本项目；但如果你修改后通过网络提供服务，必须向使用者公开你的修改后源码。

## 致谢

- [JSZip](https://github.com/Stuk/jszip) — EPUB 解包
- [Material Symbols](https://fonts.google.com/icons) — 图标
- [Operit](https://github.com/AAswordman/Operit) — 宿主平台
