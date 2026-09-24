# CoRead v2 开发交接文件

## 项目概况
CoRead v2 是 Operit 平台上的 EPUB/TXT/MD 阅读器插件，ToolPkg 格式，侧边栏入口。
**GitHub**: https://github.com/watersalt0305/CoRead (AGPLv3)
**作者**: Mishio / 三岛尾 (watersalt0305) & Claude

## 工作区路径
- 旧工作区（≤v2.5.x）：`/data/user/0/com.ai.assistance.operit/files/workspace/ecf37c48-b3bd-40c7-8139-478135fec74d/`
- **v2.6.0 开发目录**：`/sdcard/Download/coread_en/src/`（源码）→ 打包为 `/sdcard/Download/coread_en/coread2-v2.6.0.toolpkg`；同目录 `coread2-v2.5.2.zip` 为对照原包
- **git 仓库**：Linux 终端 `~/CoRead`（clone 自 GitHub，从 src 覆盖后提交；token 只在 Operit 环境变量里，终端读不到，push 由作者手动执行）

## 文件结构
```
├── manifest.json          (ToolPkg manifest, toolpkg_id=coread2, v2.6.0)
├── dist/
│   ├── main.js            (registerToolPkg, 注册 UiRoute + NavigationEntry)
│   ├── subpkg/
│   │   ├── coread2_config.js  (AI 共读配置读写子包)
│   │   └── coread2_tools.js   (AI 划线批注工具子包 — get_highlights/add_annotation/remove_annotation)
│   └── ui/reader/
│       ├── index.ui.js    (WebView screen + JS 桥 + 资源释放 + 划线导出)
│       ├── reader.html    (主 HTML)
│       ├── reader.css     (全部样式)
│       ├── reader.js      (全部逻辑 ~5100行)
│       ├── i18n.js        (v2.6.0 多语言框架：_t / setLang / data-i18n 扫描)
│       ├── i18n_dict.js   (v2.6.0 词典：key: ['中文', 'English'])
│       └── jszip.min.js   (ZIP解析库，不入 git，见 .gitignore)
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
- manifest.json 的 `resources` 字段注册了 reader.html/css/js/jszip + i18n_js/i18n_dict_js 共六个文件。**新增前端文件必须同时加进 `resources` 和 `boot()` 的 keys/names 列表**，否则不会被释放
- `index.ui.js` 的 `boot()` 通过 `ToolPkg.readResource(key)` 获取临时路径，再用 `Tools.Files.read` + `Tools.Files.write` 释放到 `/sdcard/Download/Operit/CoRead2/reader/`（早期用 `terminal.hiddenExec('cp')`，未配置 Proot 终端的环境会失败，已弃用，**不要改回 cp**）
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
- [x] 中英双语界面 + 提示词随语言切换（v2.6.0）
- [x] 书架编辑模式删除书籍 + 自绘确认弹窗 + 数据清理（v2.6.0）
- [x] 共读称呼（v2.6.0）

## 待修复 Bug / 待完善

### 待做（v2.7 候选）
- **自定义提示词模板**：接口已就绪，所有模板经 `resolvePrompt()` 统一分发。建议只开放"附加要求"类字段，不开放 `header/selection/restore` 这类拼接零件（改坏了 AI 会收不到原文）。作者明确**不要预设模板**（"我会自己问"）
- **导入本地字体**
- **删书时清理 AI 批注文件** `_coread_notes_{bookId}.json` / `_coread_history_{bookId}.json`：需要在 Bridge 新增文件删除方法，注意审核
- **批注页删除单条划线**仍在用原生 `confirm()`：待真机确认 Operit WebView 是否弹得出；若弹不出，复用 `confirmDelete` 的自绘弹窗

### 已完成（v2.6.0，2026-09-24）
- **i18n**：`i18n.js` 提供 `_t(key, params)`、`setLang()`、`getLang()`；HTML 用 `data-i18n` / `data-i18n-ph` / `data-i18n-title` 标记，切换时派发 `cr-lang-change` 事件，动态渲染的部分监听它重绘。首次打开按系统语言检测，存 `cr-lang`。词典格式 `'key': ['中文', 'English']`，用 `_i18nAdd({...})` 追加
- **提示词随语言**：payload 带 `lang`，`index.ui.js` 里 `PROMPT_TEMPLATES.zh/en`，`normLang()` 兜底为 zh。中文模板与旧版逐字一致
- **删除书籍**：书架顶栏编辑按钮 → `toggleShelfEdit()`，封面浮红 × + 晃动动画；`confirmDelete()` 自绘弹窗（不用原生 confirm）；`purgeBookStorage(bookId)` 清理 `cr_progress_{id}` / `cr_hl_{id}_*` / `cr_hl_all_{id}` / `cr_notes_{id}`，若是当前书再清 `cr_last_book`。前缀匹配已处理 id=1 与 id=12 不互相误伤。长按 0.8s 删除保留为快捷方式
- **共读称呼**：设置页单输入框，存 `cr-persona-name`。`getPersona()` 解析：空 = `user` 模式（"用户"/"the user"）；`我/i/me/myself` = `me` 模式（第一人称，走独立 `PROMPT_ME`，因为英文 "I's" 不通）；其他 = `name` 模式。模板占位符 `{user}` / `{User}`（英文句首大写）。Bridge 端 `sanitizePersonaName()` 去换行/花括号、限 24 字，防模板注入。三处接入：sendToAI、sendFollowUp、buildContextSummary
- **设置页**：删掉原来写死的"排版字号/行距/字体偏好"三行假数据（真正的调节在阅读器内面板）；顺序改为 **Language → AI Co-Read（关联记录/共读搭档/共读称呼）→ Theme → Ornaments**，Language 置顶是为了外语用户一进来就能找到。称呼输入框复用 `.value` 样式 + 小铅笔图标，**不要加虚线下划线**（与行分隔线冲突，作者觉得违和）

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
| localStorage | `cr-lang` | 界面语言 zh / en（v2.6.0） |
| localStorage | `cr-persona-name` | 共读称呼，空 = 用户（v2.6.0） |
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
- **资源释放用 Tools.Files**：`ToolPkg.readResource(key)` 返回临时路径，用 `Tools.Files.read/write` 复制到固定目录（不依赖终端）
- **Bridge 暴露方法只有 6 个**：`onBookOpened` / `sendToAI` / `sendFollowUp` / `loadHistory` / `getAINotes` / `saveShareCard`。新功能尽量加可选字段（如 v2.6.0 的 `lang` / `persona`），不新增方法，市场审核会看这里
- **`<input type=file accept="*/*">` 是故意的**：很多 Android 系统不认识 `.md` 的 MIME 类型，写 `.epub,.txt,.md` 会导致 md 文件在选择器里灰掉点不了。**不要"修"回去**
- **原生 `confirm()` / `alert()` 在 Operit WebView 里可能弹不出来**（宿主没实现回调时 confirm 直接返回 false）。新弹窗一律自绘，参考 `confirmDelete()` / `showConfigAlert()`
- **innerHTML 拼接必须经 `escHtml()`**：书名、用户输入、称呼等都算不可信内容
- **上下文恢复三件套**（v2.4.2）：`__lastUsedChatId`（持久化在 config）/ `__historyLoaded`（历史竞态）/ `__chatSwitchAt`（cutoff 防回灌）。改动恢复逻辑前先理解这三者的交互，见 `maybeBuildRestorePrefix()`
- **set_coread_config 是读-改-写**：不要改成整文件覆盖，否则会冲掉 `lastUsedChatId` 导致恢复检测失效
- **bookId 是 IndexedDB 自增数字**：历史/批注文件名里的 4/10/12 等是书架导入序号，不是章节号

## GitHub 仓库状态（2026-09-24）
- main 分支已与 **v2.6.0** 同步（commit `8a4e7d7`，tag `v2.6.0`）；v2.5.1 的 release 附带 toolpkg 及 SHA256，v2.6.0 的 release 待作者在网页上建
- 推送方式：终端 `~/CoRead` 提交后，作者手动 `git push https://<token>@github.com/watersalt0305/CoRead.git main --tags`（token 不要发到聊天里）。github 工具包的 API 逐文件上传不适合 reader.js（~200KB，参数会丢）
- `.gitignore` 已排除 `.backup/`、`jszip.min.js`、`reader_v2.html`；jszip 需自行下载放到 `dist/ui/reader/`

## ⚠️ 打包注意事项（血泪，必读）

**永远不要直接对工作区目录打包。** 工作区绑定对话后会生成隐藏目录 `.backup/`（含 `chats/` 聊天记录与 `objects/` 快照），前端文件树不显示它，但官方 `debug_toolpkg.py` 与内置打包工具**不排除它、也不读 `.gitignore`**，会把它整个打进 toolpkg。

v2.3.0～v2.4.3 及市场上的 v2.4.2 就是这样翻车的：`.backup/_tmp_pkg_check2/` 里残留了一份旧 manifest，市场提交时的 `ToolPkgArtifactMinifier` 用 `readToolPkgManifestPreview()`（按 zip 顺序取**第一个** manifest，`.backup/` 字典序在前）选中了它，再以它为根做依赖剪枝，把真正的 `manifest.json` 和 `dist/` 全部删掉——产出只剩幽灵目录的空壳。运行时的 `findManifestEntry()` 是根目录优先、找不到才回退嵌套，所以空壳"能用"，实际跑的是 v2.3.1 代码。**不勾混淆也会选错 manifest**（只是不剪枝），唯一可靠的办法是包内只能有一个 manifest。已向 Operit 上游反馈。

**正确流程：**
1. 在干净目录里只放 `manifest.json` + `dist/` + 文档（README/LICENSE/CHANGELOG），**不要**放 HANDOFF.md、`.gitignore`、任何 `.` 开头目录
2. `zip -X -D -r coread2-vX.Y.Z.toolpkg manifest.json dist README.md LICENSE CHANGELOG.md`
3. 提交前**必须** `unzip -l` 检查：第一个条目是 `manifest.json`、`grep -c manifest` 结果为 1、没有任何 `.backup/`
4. 确认 `dist/main.js` 末尾**没有** `ToolPkg._m([...],90);`——这是市场发布时注入的出身标记，只能由市场盖一次；重打包时若发现已有，必须删掉，否则会盖两层且版本号不一致
5. 版本号必须递增，市场拒绝重复版本号
6. 不要在工作区里做临时解包校验（`_tmp_pkg_check*` 之类），要做就在 `/tmp` 下并确保删掉；rewind 会把删过的文件还原回来
7. **（v2.6.0 做法）打包后逐个读回包内文件，与源文件做哈希比对**，确认零差异再发。这是防 v2.4.2 "包里其实是旧代码" 的最后一道保险。v2.6.0 用 Python `zipfile` 打包，照原包补了目录条目（`dist/`、`dist/ui/`、`dist/ui/reader/`、`dist/subpkg/`），manifest 放第一个
8. 改完 JS 先 `node --check` 过一遍语法；改 HTML 结构后数一下 `<div` / `</div>` 是否配平（整文件应相等）
