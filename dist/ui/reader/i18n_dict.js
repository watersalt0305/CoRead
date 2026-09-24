// CoRead — EPUB / TXT / MD Reader + AI Co-Read
// Copyright (C) 2025 Mishio / 三岛尾 (watersalt0305) & Claude
// SPDX-License-Identifier: AGPL-3.0-or-later

// === CoRead 词典（格式：key: ['中文', 'English']）===

// ---------- HTML 静态文案 ----------
_i18nAdd({
  'doc.title':        ['共读 v2', 'CoRead v2'],
  'tab.shelf':        ['书架', 'Library'],
  'tab.notes':        ['批注', 'Notes'],
  'tab.prefs':        ['设置', 'Settings'],
  'notes.none':       ['还没有批注', 'NO ANNOTATIONS YET'],

  'set.fontSize':     ['排版字号', 'Font size'],
  'set.lineHeight':   ['行距', 'Line height'],
  'set.fontPref':     ['字体偏好', 'Typeface'],
  'set.palette':      ['预设配色 · Palette', 'Palette'],
  'set.accent':       ['自定义强调色', 'Custom accent'],
  'set.ornaments':    ['装饰元素 · 微调', 'Ornaments'],
  'set.frame':        ['描边 / 色块', 'Outlines / blocks'],
  'set.seal':         ['竖排朱印', 'Vertical seal'],
  'set.index':        ['幽灵编号', 'Ghost numbers'],
  'set.quote':        ['引号标签', 'Quote tags'],
  'set.drop':         ['首字下沉', 'Drop cap'],
  'set.radius':       ['圆角尺度', 'Corner radius'],
  'set.chatId':       ['关联记录', 'Linked chat'],
  'set.cardName':     ['共读搭档', 'Reading buddy'],
  'set.language':     ['语言', 'Language'],

  'theme.paper':      ['纸墨', 'Paper & Ink'],
  'theme.autumn':     ['秋日', 'Autumn'],
  'theme.peach':      ['蜜桃', 'Peach'],
  'theme.apricot':    ['杏林', 'Apricot'],
  'theme.mistBlue':   ['雾蓝', 'Mist Blue'],
  'theme.warmNight':  ['暖夜', 'Warm Night'],
  'theme.forest':     ['森野', 'Forest'],
  'theme.nightPond':  ['夜潭', 'Night Pond'],
  'theme.eink':       ['墨水屏', 'E-Ink'],
  'theme.mono':       ['素灰', 'Mono'],
  'theme.celadon':    ['青瓷', 'Celadon'],
  'theme.indigo':     ['黛蓝', 'Indigo'],
  'theme.dark':       ['深渊', 'Abyss'],

  'common.close':     ['关闭', 'Close'],
  'common.cancel':    ['取消', 'Cancel'],
  'common.delete':    ['删除', 'Delete'],

  'toc.title':        ['目录', 'Contents'],
  'search.title':     ['全文搜索', 'Search'],
  'search.ph':        ['搜索关键词...', 'Search keywords...'],
  'search.go':        ['搜索', 'Go'],
  'search.hint':      ['输入关键词搜索全书内容', 'Enter a keyword to search the whole book'],

  'rset.title':       ['阅读设置', 'Reading settings'],
  'rset.fontSize':    ['字号', 'Size'],
  'rset.lineHeight':  ['行距', 'Line height'],
  'rset.pSpace':      ['段间距', 'Paragraph gap'],
  'rset.margin':      ['页边距', 'Margins'],
  'rset.font':        ['字体', 'Font'],
  'rset.serif':       ['宋体', 'Serif'],
  'rset.sans':        ['黑体', 'Sans'],
  'rset.hl':          ['划线', 'Highlight'],
  'rset.hlBg':        ['高亮', 'Marker'],
  'rset.hlLine':      ['直线', 'Line'],
  'rset.hlWave':      ['波浪', 'Wave'],
  'rset.hlDash':      ['虚线', 'Dashed'],
  'rset.theme':       ['主题', 'Theme'],

  'bm.title':         ['划线摘录', 'Highlights'],

  'hl.copy':          ['复制', 'Copy'],
  'hl.highlight':     ['划线', 'Mark'],
  'hl.note':          ['想法', 'Note'],
  'hl.askAI':         ['问AI', 'Ask AI'],

  'aiq.ph':           ['添加你的想法或问题（可留空直接发送）…', 'Add a thought or question (optional)…'],
  'aiq.alsoHl':       ['同时划线标记', 'Also highlight it'],
  'aiq.send':         ['发送给AI', 'Send to AI'],

  'ai.panelTitle':    ['AI 共读', 'AI Co-Read'],
  'ai.empty':         ['选中文字后点击 AI 按钮开始讨论', 'Select some text and tap the AI button to start'],
  'ai.followPh':      ['继续追问…', 'Ask a follow-up…'],

  'note.ph':          ['写下这一刻的想法…', 'Write down what you\'re thinking…'],
  'note.post':        ['发表', 'Post']
});

// ---------- 书架 / 导入 / 阅读器 ----------
_i18nAdd({
  'common.unknown':   ['未知', 'Unknown'],
  'common.deleted':   ['已删除', 'Deleted'],
  'shelf.reading':    ['阅读中', 'Reading'],
  'shelf.confirmDel': ['删除《{title}》？', 'Delete "{title}"?'],
  'imp.loading':      ['导入中...', 'Importing...'],
  'imp.dbNotReady':   ['数据库未就绪', 'Database not ready'],
  'imp.ok':           ['导入成功', 'Imported'],
  'imp.storeFail':    ['存储失败: ', 'Save failed: '],
  'imp.parseFail':    ['解析失败: ', 'Parse failed: '],
  'imp.badEncoding':  ['编码无法识别', 'Unrecognized text encoding'],
  'imp.readFail':     ['读取文件失败', 'Failed to read file'],
  'imp.unsupported':  ['不支持的格式: .', 'Unsupported format: .'],
  'txt.opening':      ['开头', 'Opening'],
  'txt.fullText':     ['全文', 'Full text'],
  'book.dataLost':    ['书籍数据丢失', 'Book data missing'],
  'book.openFail':    ['打开失败: ', 'Failed to open: '],
  'book.chMissing':   ['章节文件缺失: ', 'Chapter file missing: '],
  'fn.notFound':      ['未找到注释内容', 'Footnote not found'],
  'fn.noAnchor':      ['未找到锚点 #', 'Anchor not found #'],
  'fn.loadFail':      ['加载失败：', 'Failed to load:'],
  'fn.error':         ['出错：', 'Error:'],
  'fn.title':         ['注释', 'Note'],
  'mode.page':        ['翻页模式', 'Page mode'],
  'mode.scroll':      ['滚动模式', 'Scroll mode'],
  'search.needKw':    ['请输入关键词', 'Please enter a keyword'],
  'search.noBook':    ['书籍未加载', 'Book not loaded'],
  'search.searching': ['搜索中...', 'Searching...'],
  'search.none':      ['未找到「{kw}」', 'No results for "{kw}"'],
  'search.count':     ['共 {n} 处匹配', '{n} matches'],
  'search.truncated': ['（已截断）', ' (truncated)']
});

// ---------- 划线 / 批注 / 书签 / AI 面板 ----------
_i18nAdd({
  'hl.aiMarked':      ['AI 已划线', 'Highlighted by AI'],
  'hl.marked':        ['已划线', 'Highlighted'],
  'hl.copied':        ['已复制', 'Copied'],
  'hl.deleted':       ['已删除划线', 'Highlight removed'],
  'note.aiHeader':    ['AI 批注', 'AI note'],
  'note.whoHeader':   ['{who} 批注', 'Note from {who}'],
  'note.saved':       ['批注已保存', 'Note saved'],
  'note.cleared':     ['批注已清除', 'Note cleared'],
  'notes.unknownBook':['未知书籍', 'Untitled book'],
  'notes.empty':      ['还没有划线批注', 'No highlights yet'],
  'notes.emptySub':   ['在阅读时选中文字并划线即可添加', 'Select text while reading and tap Mark to add one'],
  'notes.all':        ['全部', 'All'],
  'notes.badge':      ['批注数', 'Notes'],
  'notes.confirmDel': ['删除这条划线及其批注？', 'Delete this highlight and its notes?'],
  'nd.mine':          ['我的批注', 'My note'],
  'nd.empty':         ['这条划线还没有批注', 'No notes on this highlight yet'],
  'nd.emptySub':      ['在阅读页点这条划线可以添加', 'Tap the highlight in the reader to add one'],
  'nd.title':         ['批注详情', 'Note details'],
  'nd.share':         ['生成分享卡片', 'Create share card'],
  'nd.jump':          ['跳转到原文', 'Go to passage'],
  'nd.loadTimeout':   ['书籍加载超时', 'Book took too long to load'],
  'bm.delFail':       ['删除失败: ', 'Delete failed: '],
  'bm.openFirst':     ['请先打开一本书', 'Open a book first'],
  'bm.empty':         ['本书还没有划线', 'No highlights in this book yet'],
  'bm.emptySub':      ['阅读时选中文字并划线即可添加', 'Select text while reading and tap Mark to add one'],
  'bm.count':         ['共 {n} 条划线', '{n} highlights'],
  'ai.connecting':    ['正在连接 AI ···', 'Connecting to AI ···'],
  'ai.receiving':     ['正在接收回复 ···', 'Receiving reply ···'],
  'ai.bridgeFail':    ['桥接调用失败: ', 'Bridge call failed: '],
  'ai.bridgeErr':     ['桥接调用异常: ', 'Bridge error: '],
  'ai.bridgeNotReady':['桥接未就绪，请确认插件已正确安装。', 'Bridge not ready. Please check that the plugin is installed correctly.'],
  'ai.bridgeReopen':  ['桥接未就绪，请重新打开 CoRead。', 'Bridge not ready. Please reopen CoRead.'],
  'ai.sendFail':      ['发送失败: ', 'Send failed: '],
  'ai.thinking':      ['💭 思考中...', '💭 Thinking...'],
  'ai.usingTool':     ['🔧 调用工具...', '🔧 Using tools...'],
  'cfg.bad':          ['配置有误', 'Config issue'],
  'cfg.none':         ['未配置', 'Not set'],
  'cfg.hintBase':     ['chat_id 格式可能不正确', 'The chat_id may be malformed'],
  'cfg.hintShort':    ['（当前长度 {n}，请确认是否复制完整）', ' (length {n}: it may be incomplete)'],
  'cfg.hintLong':     ['（当前长度 {n}，过长，请检查是否多复制了内容）', ' (length {n}: too long, it may include extra text)'],
  'cfg.hintTail':     ['。若共读功能可正常使用可忽略此提醒。', '. If co-reading works fine, you can ignore this.'],
  'cfg.notSetTitle':  ['AI 共读尚未配置', 'AI Co-Read is not set up'],
  'cfg.notSetDesc':   ['请在 Operit 对话中告诉 AI「帮我配置 CoRead」或使用工具 {code} 设置 chat_id。', 'In an Operit chat, ask the AI to "set up CoRead for me", or use the {code} tool to set chat_id.'],
  'cfg.gotIt':        ['我知道了', 'Got it']
});

// ---------- 分享卡片 ----------
_i18nAdd({
  'card.qOpen':       ['《', '\u201C'],
  'card.qClose':      ['》', '\u201D'],
  'card.me':          ['我', 'Me'],
  'card.genFail':     ['生成失败: ', 'Failed to create card: '],
  'card.pickStyle':   ['EXPORT STYLE · 选择样式', 'EXPORT STYLE'],
  'card.receipt':     ['小票风', 'Receipt'],
  'card.card':        ['卡片风', 'Postcard'],
  'card.stampFace':   ['1分|2分|5分|8分|1角|2角|5角|8角|1元|2元', '1\u00A2|2\u00A2|5\u00A2|8\u00A2|10\u00A2|20\u00A2|50\u00A2|80\u00A2|$1|$2'],
  'card.stampMark':   ['COREAD邮政', 'COREAD POST'],
  'rc.shop':          ['CoRead 共读书店', 'CoRead Bookshop'],
  'rc.sub':           ['· 人 机 共 读 凭 证 ·', '· HUMAN + AI READING RECEIPT ·'],
  'rc.cashier':       ['收银员', 'Cashier'],
  'rc.time':          ['时间', 'Time'],
  'rc.item':          ['品名', 'Item'],
  'rc.author':        ['著者', 'By'],
  'rc.chapter':       ['章节', 'Ch.'],
  'rc.excerpt':       ['▸ 摘录', '▸ EXCERPT'],
  'rc.notes':         ['▸ 批注', '▸ NOTES'],
  'rc.total':         ['本单共读', 'TOTAL READERS'],
  'rc.people':        ['{n} 人', '{n}'],
  'rc.thanks':        ['谢谢惠读 · 欢迎下次光临', 'THANK YOU · PLEASE READ AGAIN'],
  'pc.footer':        ['由 CoRead 人机共读生成', 'Made with CoRead \u00B7 read by human \u00D7 AI'],
  'sp.hint':          ['长按图片可直接分享到其他应用', 'Long-press the image to share it'],
  'sp.export':        ['导出保存', 'Save'],
  'sp.savedTo':       ['✓ 已保存：', '✓ Saved: '],
  'sp.savedBtn':      ['已保存 ✓', 'Saved ✓'],
  'sp.savedToast':    ['卡片已保存 ✓', 'Card saved ✓'],
  'sp.unavailable':   ['保存不可用，可长按图片保存', 'Saving unavailable. Long-press the image instead.'],
  'sp.failed':        ['保存失败，可长按图片保存', 'Save failed. Long-press the image instead.']
});

// ---------- 删除书籍 ----------
_i18nAdd({
  'shelf.edit':       ['编辑', 'Edit'],
  'shelf.done':       ['完成', 'Done'],
  'shelf.delTitle':   ['删除这本书？', 'Delete this book?'],
  'shelf.delDesc':    ['「{title}」及其阅读进度、划线和笔记将被一并删除，无法恢复。', '“{title}” and its reading progress, highlights and notes will be removed. This cannot be undone.'],
  'shelf.delFail':    ['删除失败', 'Delete failed']
});

// ---------- 共读称呼 ----------
_i18nAdd({
  'set.persona':      ['共读称呼', 'Refer to me as'],
  'set.personaPrev':  ['AI 将收到：', 'The AI will see: '],
  'persona.defUser':  ['用户', 'User'],
  'persona.prevSel':  ['「{user}选中了这段文字」', '“{User} selected this passage”'],
  'persona.prevDef':  ['「用户选中了这段文字」', '“The user selected this passage”'],
  'persona.prevMe':   ['「我选中了这段文字」', '“I selected this passage”']
});
