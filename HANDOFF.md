# CoRead v2 开发交接文件

## 项目概况
CoRead v2 是 Operit 平台上的 EPUB/TXT/MD 阅读器插件，ToolPkg 格式，侧边栏入口。
**GitHub**: https://github.com/watersalt0305/CoRead (AGPLv3)
**作者**: Mishio / 三岛尾 (watersalt0305) & Claude

## 工作区路径
`/data/user/0/com.ai.assistance.operit/files/workspace/ecf37c48-b3bd-40c7-8139-478135fec74d/`

## 文件结构
```
├── manifest.json          (ToolPkg manifest, toolpkg_id=coread2, v2.1.1)
├── dist/
│   ├── main.js            (registerToolPkg, 注册 UiRoute + NavigationEntry)
│   ├── subpkg/
│   │   ├── coread_config.js   (AI 共读配置读写子包)
│   │   └── coread_tools.js    (AI 划线批注工具子包 — get_highlights/add_annotation/remove_annotation)
│   └── ui/reader/
│       ├── index.ui.js    (WebView screen + JS 桥 + 资源释放 + 划线导出)
│       ├── reader.html    (主 HTML)
│       ├── reader.css     (全部样式)
│       ├── reader.js      (全部逻辑 ~2100行)
│       └── jszip.min.js   (ZIP解析库)
├── .gitignore
├── LICENSE                (AGPLv3)
├── README.md
└── HANDOFF.md             (本文件)
```

## 安装方式
```
operit_editor:debug_install_toolpkg
source_path: /data/user/0/com.ai.assistance.operit/files/workspace/ecf37c48-b3bd-40c7-8139-478135fec74d
```

## 资源加载机制（重要）
- manifest.json 的 `resources` 字段注册了 reader.html/css/js/jszip 四个文件
- `index.ui.js` 的 `boot()` 通过 `ToolPkg.readResource(key)` 获取资源路径，用 `cp` 释放到 `/sdcard/Download/Operit/CoRead2/reader/`
- WebView 初始 URL 为 `about:blank`，资源释放完成后才调用 `controller.loadUrl()` 加载 reader.html
- **注意**：ToolPkg 运行时是 QuickJS，没有 `__dirname`；也没有 `setEvaluateJavascriptResultHandler`

## 当前已完成功能
- [x] 书架（导入/删除/封面提取/网格⇄列表切换）
- [x] EPUB 解析 + 阅读（JSZip + OPF spine）
- [x] TXT/MD 导入 + 阅读（按标题模式分章）
- [x] 滚动阅读 + 点击翻页（左右区域）
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
- [x] 底栏划线摘录面板（bookmarkPanel，显示当前书所有划线+批注）
- [x] 划线卡片点击跳转（loadChapterAuto + scrollIntoView + 闪烁高亮）
- [x] 划线快捷删除（从面板直接删除，同时清理 localStorage 数据）
- [x] AI 工具子包 coread_tools（get_highlights / add_annotation / remove_annotation）
- [x] 划线数据导出到文件（Bridge __saveExport 方式，每10秒导出一次）
- [x] GitHub 开源 + AGPLv3 + README

## 待修复 Bug / 待完善

### Bug 1：restoreHighlights 破坏 HTML 结构
**现象**：恢复高亮时，`<mark class="cr-highlight hl-wave">` 标签直接显示为源码文字
**根因**：`restoreHighlights()` 用正则替换 innerHTML，跨标签时破坏 DOM
**建议**：改用 TreeWalker 遍历文本节点或 Range 序列化方案

### Bug 2：批注弹窗按钮可能被遮挡
**现象**：用户看不到保存/取消按钮
**建议**：检查各主题下 `.hl-btn` 在 `.note-popup` 内的颜色

### Bug 3：划线数据导出待验证
**现象**：coread_tools 子包的 get_highlights 能否正常读到数据
**根因**：导出机制刚从 setEvaluateJavascriptResultHandler（不存在的API）改为 Bridge 回调方式
**建议**：打开 CoRead 划几条线，等 10 秒，检查 `/sdcard/Download/Operit/CoRead2/_coread_highlights_export.json` 是否生成

### 待做：左右翻页模式
**需求**：除了当前的滚动阅读，还要支持左右翻页（分页模式）
**建议**：用 CSS columns 或 JS 计算分页，底栏加模式切换按钮

## 子包架构

### coread_config（已有）
- `get_coread_config` / `set_coread_config`
- 读写 `/sdcard/Download/Operit/CoRead2/_coread_config.json`

### coread_tools（新增）
- `get_highlights` — 读 `_coread_highlights_export.json` 获取划线+批注
- `add_annotation` — 写批注到 `_coread_notes_{bookId}.json`
- `remove_annotation` — 删除批注
- 数据流：WebView localStorage → Bridge.__saveExport → 导出文件 → 子包读取

## 数据存储一览

| 位置 | Key/文件 | 内容 |
|------|----------|------|
| IndexedDB `CoRead_V2` | store `books` | fileData(base64)/title/author/coverData/__txtChapters |
| localStorage | `cr_progress_{bookId}` | 阅读进度 |
| localStorage | `cr_hl_{bookId}_{chapterIdx}` | 当前章划线（用于恢复渲染） |
| localStorage | `cr_hl_all_{bookId}` | 全书划线汇总 |
| localStorage | `cr_notes_{bookId}` | 用户批注 |
| localStorage | `cr_last_book` | 当前书 ID |
| localStorage | `cr-theme`, `cr-reader-fs/lh/pspace/mx/font`, `cr-hl-style`, `cr-skin`, `cr-accent`, `cr-radius` | 阅读偏好 |
| 文件 | `_coread_config.json` | AI 共读配置 |
| 文件 | `_coread_highlights_export.json` | 导出的划线数据（供 AI 子包读） |
| 文件 | `_coread_notes_{bookId}.json` | AI 写入的批注 |

## 技术要点备忘
- **ToolPkg 运行时是 QuickJS**：没有 `__dirname`、没有 `setEvaluateJavascriptResultHandler`、没有 Node.js API
- **WebView 缓存**：CSS/JS 通过 `?v=Date.now()` 绕过。HTML 不缓存。
- **ToolPkg screen 注册**：必须从独立 .ui.js 文件 require 进来
- **JS `</` 陷阱**：如果 JS 回到内联 `<script>` 方式，所有 `</` 必须用 `\x3C/` 替代
- **进度保存顺序**：`closeReader()` 先 `saveProgress()` 再 `classList.remove('active')`
- **EPUB CSS 泄漏**：`sanitizeEpubCss()` 加 `.page-text` 前缀
- **资源释放靠 cp**：`ToolPkg.readResource(key)` 返回临时路径，需 cp 到固定目录

## GitHub 仓库状态
- 初始提交已推送，但本轮大量改动（资源机制、书签面板、AI工具子包等）尚未 push
- `.gitignore` 已排除 `.backup/`、`jszip.min.js`、`reader_v2.html`
- 需要 push 的改动：manifest.json、index.ui.js、reader.html、reader.js、coread_tools.js、HANDOFF.md、README.md
