# CoRead v2 开发交接文件

## 项目概况
CoRead v2 是 Operit 平台上的 EPUB/TXT/MD 阅读器插件，ToolPkg 格式，侧边栏入口。
**GitHub**: https://github.com/watersalt0305/CoRead (AGPLv3)
**作者**: Mishio / 三岛尾 (watersalt0305) & Claude

## 工作区路径
`/data/user/0/com.ai.assistance.operit/files/workspace/ecf37c48-b3bd-40c7-8139-478135fec74d/`

## 文件结构
```
│   ├── manifest.json          (ToolPkg manifest, toolpkg_id=coread2, v2.5.1)
├── dist/
│   ├── main.js            (registerToolPkg, 注册 UiRoute + NavigationEntry)
│   ├── subpkg/
│   │   ├── coread2_config.js  (AI 共读配置读写子包)
│   │   └── coread2_tools.js   (AI 划线批注工具子包 — get_highlights/add_annotation/remove_annotation)
│   └── ui/reader/
│       ├── index.ui.js    (WebView screen + JS 桥 + 资源释放 + 划线导出)
│       ├── reader.html    (主 HTML)
│       ├── reader.css     (全部样式)
│       ├── reader.js      (全部逻辑 ~5000行)
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

### 已完成（v2.5.0/v2.5.1，2026-09-02）——Markdown 渲染器重写

- 块级 Markdown 解析器（表格/围栏代码块/Obsidian callout/wikilink/嵌入/任务列表/==高亮==/删除线/脚注），入口 `renderMarkdown()` → `inlineMarkdown()`，安全策略不变：先整体转义再解析
- `lastUsedChatId` 持久化补完：`loadConfig()` 恢复，`boot()` 不再无条件覆盖


### 已修复（v2.4.2，2026-08-28）——上下文恢复链路

- ~~restoreHighlights 破坏 HTML~~：已改用 TreeWalker + Range 方案（正则方案早已废弃）
- **换对话后恢复摘要永远不触发**：标志位在历史加载完成前被消费。修复：只有真正注入才消费标志（`maybeBuildRestorePrefix`）
- **重开 CoRead 抹平"换过对话"事实**：boot 里无条件同步 `__lastUsedChatId`。修复：`lastUsedChatId` 持久化到 `_coread_config.json`，注入后落盘
- **恢复摘要回灌新记录**：修复：`__chatSwitchAt` 时间戳截断
- **历史竞态**：新增 `__historyLoaded` 区分"未加载完"与"加载完但为空"
- **追问通道不注入恢复**：`sendFollowUp` 已接入统一恢复入口
- **AI 批注缓存 key 不一致**：`preloadAINotes` 推送改用 sanitize 后的 `safe` 做 key
- **导出书名为空**：`exportHighlightsToFile` 现从 `window.currentBookTitle` 带出当前书书名
- 全部实测通过（注入一次 / 不重复 / 重启不复发）

### 待做：左右翻页模式
**需求**：除了当前的滚动阅读，还要支持左右翻页（分页模式）
**建议**：用 CSS columns 或 JS 计算分页，底栏加模式切换按钮
**注**：翻页模式（__pageMode === 'page' + buildPages）在 reader.js 已有实现并在恢复进度时使用，待确认是否已完整

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
| 文件 | `_coread_config.json` | AI 共读配置（chatId / cardName / aiDotColor / **lastUsedChatId**——上下文恢复标志的持久化，见 v2.4.2） |
| 文件 | `_coread_history_{bookId}.json` | 每本书独立的 AI 共读讨论历史（上限 100 条） |
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
- **上下文恢复三件套**（v2.4.2）：`__lastUsedChatId`（持久化在 config）/ `__historyLoaded`（历史竞态）/ `__chatSwitchAt`（cutoff 防回灌）。改动恢复逻辑前先理解这三者的交互，见 `maybeBuildRestorePrefix()`
- **set_coread_config 是读-改-写**：不要改成整文件覆盖，否则会冲掉 `lastUsedChatId` 导致恢复检测失效
- **bookId 是 IndexedDB 自增数字**：历史/批注文件名里的 4/10/12 等是书架导入序号，不是章节号

## GitHub 仓库状态（2026-09-02）
- main 分支已与 v2.5.1 同步，release 附带 `coread2-v2.5.1.toolpkg` 及 SHA256
- `.gitignore` 已排除 `.backup/`、`jszip.min.js`、`reader_v2.html`；jszip 需自行下载放到 `dist/ui/reader/`

## ⚠️ 打包注意事项（血泪，必读）

**永远不要直接对工作区目录打包。** 工作区绑定对话后会生成隐藏目录 `.backup/`（含 `chats/` 聊天记录与 `objects/` 快照），前端文件树不显示它，但官方 `debug_toolpkg.py` 与内置打包工具**不排除它、也不读 `.gitignore`**，会把它整个打进 toolpkg。

v2.3.0～v2.4.3 及市场上的 v2.4.2 就是这样翻车的：`.backup/_tmp_pkg_check2/` 里残留了一份旧 manifest，市场提交时的 `ToolPkgArtifactMinifier` 用 `readToolPkgManifestPreview()`（按 zip 顺序取**第一个** manifest，`.backup/` 字典序在前）选中了它，再以它为根做依赖剪枝，把真正的 `manifest.json` 和 `dist/` 全部删掉——产出只剩幽灵目录的空壳。运行时的 `findManifestEntry()` 是根目录优先、找不到才回退嵌套，所以空壳"能用"，实际跑的是 v2.3.1 代码。**不勾混淆也会选错 manifest**（只是不剪枝），唯一可靠的办法是包内只能有一个 manifest。已向 Operit 上游反馈。

**正确流程：**
1. 在干净目录里只放 `manifest.json` + `dist/` + 文档（README/LICENSE/CHANGELOG/MARKET_INTRO），**不要**放 HANDOFF.md、`.gitignore`、任何 `.` 开头目录
2. `zip -X -D -r coread2-vX.Y.Z.toolpkg manifest.json dist README.md LICENSE CHANGELOG.md MARKET_INTRO.md`
3. 提交前**必须** `unzip -l` 检查：第一个条目是 `manifest.json`、`grep -c manifest` 结果为 1、没有任何 `.backup/`
4. 确认 `dist/main.js` 末尾**没有** `ToolPkg._m([...],90);`——这是市场发布时注入的出身标记，只能由市场盖一次；重打包时若发现已有，必须删掉，否则会盖两层且版本号不一致
5. 版本号必须递增，市场拒绝重复版本号
6. 不要在工作区里做临时解包校验（`_tmp_pkg_check*` 之类），要做就在 `/tmp` 下并确保删掉；rewind 会把删过的文件还原回来
