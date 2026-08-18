# CoRead v2 开发交接文件

## 项目概况
CoRead v2 是 Operit 平台上的 EPUB/TXT/MD 阅读器插件，ToolPkg 格式，侧边栏入口。

## 工作区路径
`/data/user/0/com.ai.assistance.operit/files/workspace/ecf37c48-b3bd-40c7-8139-478135fec74d/`

## 文件结构
```
├── manifest.json          (ToolPkg manifest, toolpkg_id=coread2)
├── dist/
│   ├── main.js            (registerToolPkg, 注册 UiRoute + NavigationEntry)
│   └── ui/reader/
│       ├── index.ui.js    (WebView screen 函数，URL指向工作区 reader.html)
│       ├── reader.html    (主 HTML，带防缓存时间戳加载)
│       ├── reader.css     (全部样式：UI框架+阅读器+设置面板+目录+批注)
│       ├── reader.js      (全部逻辑：~1300行)
│       └── jszip.min.js   (ZIP解析库)
└── reader_v2.html         (v11原型参考，可删)
```

## 安装方式
```
operit_editor:debug_install_toolpkg
source_path: /data/user/0/com.ai.assistance.operit/files/workspace/ecf37c48-b3bd-40c7-8139-478135fec74d
```

## 当前已完成功能
- [x] 书架（导入/删除/封面提取/网格⇄列表切换）
- [x] EPUB 解析 + 阅读（JSZip + OPF spine）
- [x] TXT/MD 导入 + 阅读（按标题模式分章）
- [x] 滚动阅读 + 点击左右区域翻页
- [x] 章节目录面板（底部弹出，动画）
- [x] 阅读设置面板（字号/行距/段间距/页边距滑杆 + 字体 + 主题 + 划线样式）
- [x] 进度记忆（bookId做key，多书独立，visibilitychange兜底）
- [x] 主题系统（9个主题+自定义强调色+软糖皮肤+装饰开关）
- [x] 划线批注（选中→浮动菜单→高亮→弹批注框→保存/删除）
- [x] 4种划线样式（下划/波浪/直线/高亮，设置面板切换）
- [x] 系统菜单屏蔽（contextmenu preventDefault）
- [x] ToolPkg 打包 + 侧边栏注册
- [x] 防缓存机制（CSS/JS 动态时间戳）
- [x] 系统返回键退出阅读器（history.pushState + popstate）
- [x] 工具栏左右滑唤醒（document capture touchend）
- [x] 主题配色优化（2026-08-08）：
  - 深色主题划线背景色移除（改用下划线样式）
  - 浅色主题底色统一提亮至 92%+ 明度
  - Banner/顶栏背景调浅，与底色过渡更柔和
  - 框线颜色改用文字色（`--border` 改为 `--ink`）
  - 划线文字颜色强制继承父元素（`color: inherit !important`）
  - 新增墨水屏特典主题（纯黑白极简）

## 主题配色方案（9个）
| 主题名 | 类型 | 背景 | 强调色 | 墨色 | 特点 |
|--------|------|------|--------|------|------|
| 纸墨 | 浅色 | `#F4F1EA` | `#C25946` | `#2C2A28` | 经典米白（默认） |
| 秋日 | 浅色 | `#F7F3ED` | `#BF6430` | `#2F403E` | 暖米+橙棕 |
| 蜜桃 | 浅色 | `#FFF5F1` | `#447F8F` | `#59221D` | 粉底+蓝绿 |
| 杏林 | 浅色 | `#FAF6EE` | `#315955` | `#012626` | 杏黄+深绿 |
| 雾蓝 | 浅色 | `#E9EBEB` | `#5B84AE` | `#141A2B` | 灰白+蓝调 |
| 暖夜 | 深色 | `#1C1C1E` | `#F09B6E` | `#F2D9A4` | 暖橙+米黄墨 |
| 森野 | 浅色 | `#F4F4F0` | `#8CC152` | `#0E2E1B` | 灰白+草绿 |
| 夜潭 | 深色 | `#0F2C30` | `#D98566` | `#E5C3B2` | 墨绿黑+暖橙 |
| 墨水屏 | 特典 | `#FFFFFF` | `#000000` | `#000000` | 纯黑白极简（E-ink优化） |

**配色设计原则**：
- 浅色主题底色（`--bg-0`）全部 92%+ 明度，和纸墨米白站同一档
- Banner/选中 Tab 背景（`--bg-1`）仅比底色深一档，过渡平滑
- 框线（`--border`）使用文字色（`--ink`），不使用强调色
- 深色主题去荧光，避免高饱和度色彩铺满

## 已修复 Bug
### ✅ Bug 1：深色主题划线背景色突兀
**修复内容**：删除深色主题 `<mark>` 的背景高亮覆盖，统一使用下划线样式
**修复时间**：2026-08-08

### ✅ Bug 2：划线后文字变黑
**根因**：`<mark>` 标签浏览器默认 `color: black`
**修复内容**：为 `.cr-highlight` 添加 `color: inherit !important`，强制继承父元素文字色
**修复时间**：2026-08-08

## 待修复 Bug（下次优先）
### Bug 1：restoreHighlights 破坏 HTML 结构
**现象**：恢复高亮时，`<mark class="cr-highlight hl-wave">` 标签直接显示为源码文字
**根因**：`restoreHighlights()` 用正则 `html.replace(re, '<mark>$1</mark>')` 替换 innerHTML，当划线文本跨多个 HTML 标签时，正则会把 `<mark>` 插到已有标签的属性里，破坏 DOM
**建议修复方向**：
- 方案A：改用 TreeWalker 遍历文本节点，只在纯文本节点内做高亮标记
- 方案B：参考旧版 CoRead 的 Range 序列化方案（serializeRange/deserializeRange），用 DOM path + offset 精确定位
- 方案C：简单 fallback——如果正则替换后产生了裸 `<mark` 文字，就跳过该条恢复

### Bug 2：批注弹窗按钮可能被遮挡
**现象**：用户看不到保存/取消按钮
**可能原因**：弹窗 CSS 的 z-index(9500) 可能被其他面板盖住，或者按钮文字在深色主题下不可见
**建议**：检查各主题下 `.hl-btn` 在 `.note-popup` 内的颜色，确保按钮可见

## 技术要点备忘
- **WebView 缓存**：CSS/JS 通过 `?v=Date.now()` 绕过。HTML 本身不缓存（插件每次打开重读）。如遇改了不生效，重启 Operit。
- **ToolPkg screen 注册**：必须从独立 .ui.js 文件 require 进来，不能在 main.js 内联定义
- **JS `</` 陷阱**：如果 JS 回到内联 `<script>` 方式，所有 `</` 必须用 `\x3C/` 替代
- **进度保存顺序**：`closeReader()` 里必须先 `saveProgress()` 再 `classList.remove('active')`，否则 scrollTop 会被 display:none 重置为 0
- **EPUB CSS 泄漏**：`sanitizeEpubCss()` 把所有选择器加 `.page-text` 前缀，防止 EPUB 样式影响主 UI
- **IndexedDB**：库名 `CoRead_V2`，store `books`，存 fileData(base64)/title/author/coverData/__txtChapters
- **localStorage keys**：`cr_progress_{bookId}`, `cr_hl_{bookId}_{chapterIdx}`, `cr_hl_all_{bookId}`, `cr_notes_{bookId}`, `cr-theme`, `cr-reader-fs/lh/pspace/mx/font`, `cr-hl-style`, `cr-skin`, `cr-accent`, `cr-radius`, `cr-view-bookGrid/noteWrap`, `cr_last_book`

## 未来方向
- AI 讨论（JS桥接 registerMessageProcessingPlugin）
- 批注 Tab 页渲染（数据已存好）
- 漫画/CBZ 支持（JSZip已有，按图片顺序展示）
- 划线删除确认交互优化
- 批注 Tab 显示所有划线+笔记汇总
