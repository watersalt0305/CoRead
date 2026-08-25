// CoRead — EPUB / TXT / MD Reader + AI Co-Read
// Copyright (C) 2025 Mishio / 三岛尾 (watersalt0305) & Claude
// SPDX-License-Identifier: AGPL-3.0-or-later

// === CoRead v2 · Full Reader Engine ===
// 注意：本文件通过 <script src="reader.js"> 加载，不存在 </script> 截断问题

(function() {
'use strict';

// ============ 常量 & 状态 ============
var DB_NAME = 'CoRead_V2';
var STORE_BOOKS = 'books';
var db = null;
var epubZip = null;
var chapters = [];
var currentIdx = 0;
var currentBookId = null;
var currentBookTitle = '';
var autoHideTimer = null;

// CoRead 配置
var coreadConfig = {
  cardName: '',
  aiDotColor: '#D97757'
};

// DOM 引用（延迟获取）
var els = {};

// ============ 工具函数 ============
function $(id) { return document.getElementById(id); }

function resolvePath(base, rel) {
  var s = base.split('/').filter(function(x) { return x; });
  var p = rel.split('/');
  for (var i = 0; i < p.length; i++) {
    if (p[i] === '..') s.pop();
    else if (p[i] !== '.' && p[i] !== '') s.push(p[i]);
  }
  return s.join('/');
}

function sanitizeEpubCss(css) {
  if (!css) return '';
  css = css.replace(/@page[^{]*\{[^}]*\}/gi, '');
  css = css.replace(/@import[^;]*;/gi, '');
  css = css.replace(/@media[^{]*\{[\s\S]*?\}\s*\}/gi, '');
  var out = '';
  var re = /([^{}]+)\{([^}]*)\}/g;
  var m;
  while ((m = re.exec(css)) !== null) {
    var sels = m[1].trim();
    var body = m[2];
    if (!sels || !body) continue;
    // 过滤危险属性
    var safeBody = body.split(';').map(function(decl) {
      decl = decl.trim();
      if (!decl) return '';
      var ci = decl.indexOf(':');
      if (ci < 0) return '';
      var prop = decl.substring(0, ci).trim().toLowerCase();
      if (/^(height|min-height|max-height|width|min-width|position|overflow|overflow-x|overflow-y|float|clear|z-index|top|left|right|bottom|page-break-[a-z-]*|break-[a-z-]*|column-[a-z-]*|columns)$/.test(prop)) return '';
      return decl;
    }).filter(Boolean).join('; ');
    if (!safeBody) continue;
    // 限定作用域到 .page-text 内部
    var scopedSels = sels.split(',').map(function(sel) {
      sel = sel.trim();
      sel = sel.replace(/^(html|body)\b/i, '.page-text');
      sel = sel.replace(/\b(html|body)\b/gi, '.page-text');
      if (sel.indexOf('.page-text') === 0) return sel;
      return '.page-text ' + sel;
    }).join(', ');
    out += scopedSels + '{' + safeBody + '}\n';
  }
  return out;
}

// 安全整改：HTML 转义工具函数，防止用户/EPUB 元数据注入 DOM
function escHtml(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'"').replace(/'/g,'&#39;');
}

function waitImages(container) {
  var imgs = container.querySelectorAll('img');
  var ps = [];
  for (var i = 0; i < imgs.length; i++) {
    var im = imgs[i];
    if (im.complete && im.naturalWidth > 0) continue;
    ps.push(new Promise(function(res) {
      var done = false;
      var fin = function() { if (done) return; done = true; res(); };
      im.addEventListener('load', fin);
      im.addEventListener('error', fin);
      setTimeout(fin, 3000);
    }));
  }
  return Promise.all(ps);
}

function showToast(msg) {
  var t = document.createElement('div');
  t.textContent = msg;
  t.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:var(--ink);color:var(--bg-0);padding:10px 20px;font-size:12px;font-family:var(--font-mono);z-index:9999;opacity:0;transition:opacity 0.3s;';
  document.body.appendChild(t);
  requestAnimationFrame(function() { t.style.opacity = '1'; });
  setTimeout(function() { t.style.opacity = '0'; setTimeout(function() { t.remove(); }, 300); }, 2000);
}

// ============ IndexedDB ============
function initDB() {
  return new Promise(function(resolve) {
    var req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = function(e) {
      var d = e.target.result;
      if (!d.objectStoreNames.contains(STORE_BOOKS)) {
        d.createObjectStore(STORE_BOOKS, { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = function(e) { db = e.target.result; resolve(); };
    req.onerror = function() { resolve(); };
  });
}

// ============ 书架 ============
function refreshLibrary() {
  var grid = $('bookGrid');
  grid.innerHTML = '';
  var addCard = document.createElement('label');
  addCard.className = 'book-card book-card--add';
  addCard.id = 'cardAdd';
  addCard.setAttribute('for', 'fileInput');
  addCard.style.cursor = 'pointer';
  addCard.innerHTML = '<div class="book-cover"><div class="placeholder"><span class="mi">add</span>IMPORT</div></div>';
  grid.appendChild(addCard);

  if (!db) return;
  var tx = db.transaction(STORE_BOOKS, 'readonly');
  var store = tx.objectStore(STORE_BOOKS);
  var req = store.openCursor();
  req.onsuccess = function(e) {
    var cursor = e.target.result;
    if (!cursor) return;
    var book = cursor.value;
    var card = document.createElement('div');
    card.className = 'book-card';

    var coverStyle = '';
    var coverInner = '';
    if (book.coverData) {
      coverStyle = 'background-image:url(' + book.coverData + ');background-size:cover;background-position:center;';
    } else {
      // 生成随机暖色背景
      var hue = (book.id * 67) % 360;
      coverStyle = 'background:hsl(' + hue + ',25%,40%)';
      coverInner = '<div class="cover-spine">' + escHtml((book.title || '').substring(0, 6)) + '</div>';
    }

    var isReading = localStorage.getItem('cr_last_book') === String(book.id);
    card.innerHTML = (isReading ? '<div class="badge-reading">READING</div>' : '') +
      '<div class="book-cover" style="' + coverStyle + '">' + coverInner + '</div>' +
      '<div class="book-title">' + escHtml(book.title || '未知') + '</div>' +
      '<div class="book-author">' + escHtml(book.author || '') + '</div>';

    // 点击打开
    card.onclick = function() { openBook(book.id); };
    // 长按删除
    var longTimer = null;
    card.addEventListener('touchstart', function() {
      longTimer = setTimeout(function() { confirmDelete(book.id, book.title); }, 600);
    });
    card.addEventListener('touchend', function() { clearTimeout(longTimer); });
    card.addEventListener('touchmove', function() { clearTimeout(longTimer); });

    grid.appendChild(card);
    cursor.continue();
  };
}

function confirmDelete(bookId, title) {
  if (confirm('删除《' + title + '》？')) {
    var tx = db.transaction(STORE_BOOKS, 'readwrite');
    tx.objectStore(STORE_BOOKS).delete(bookId);
    tx.oncomplete = function() { refreshLibrary(); showToast('已删除'); };
  }
}

// ============ 导入 EPUB ============
function importEpub(file) {
  if (!file) return;
  showToast('导入中...');

  // 同时读取 base64（存储用）和 ArrayBuffer（解析用）
  var b64Result = null;

  var readerB64 = new FileReader();
  readerB64.onload = function(ev) {
    b64Result = ev.target.result;
    // 再读 ArrayBuffer
    var readerAB = new FileReader();
    readerAB.onload = function(ev2) {
      var ab = ev2.target.result;
      JSZip.loadAsync(ab).then(function(zip) {
        return parseMetadata(zip).then(function(meta) {
          var record = {
            title: meta.title || file.name.replace(/\.epub$/i, ''),
            author: meta.author || '',
            coverData: meta.coverData || null,
            fileData: b64Result,
            addedAt: Date.now()
          };
          if (!db) { showToast('数据库未就绪'); return; }
          var tx = db.transaction(STORE_BOOKS, 'readwrite');
          var addReq = tx.objectStore(STORE_BOOKS).add(record);
          addReq.onsuccess = function() {
            showToast('导入成功');
            refreshLibrary();
          };
          addReq.onerror = function(e) {
            showToast('存储失败: ' + e.target.error);
          };
        });
      }).catch(function(err) {
        showToast('解析失败: ' + err.message);
      });
    };
    readerAB.readAsArrayBuffer(file);
  };
  readerB64.readAsDataURL(file);
}

// ============ 导入 TXT/MD ============
function importText(file, isMd) {
  showToast('导入中...');
  var reader = new FileReader();
  reader.onload = function(ev) {
    var ab = ev.target.result;
    var text = decodeTextBuffer(ab);
    if (!text) { showToast('编码无法识别'); return; }
    var title = file.name.replace(/\.(txt|md)$/i, '');
    // 按标题模式分章（## 或 第X章/第X节 或连续空行分段）
    var txtChapters = splitTextChapters(text, isMd);
    var record = {
      title: title,
      author: '',
      coverData: null,
      fileData: null, // TXT不存base64，直接存章节
      __txtChapters: txtChapters,
      __isMd: isMd,
      addedAt: Date.now()
    };
    if (!db) { showToast('数据库未就绪'); return; }
    var tx = db.transaction(STORE_BOOKS, 'readwrite');
    var addReq = tx.objectStore(STORE_BOOKS).add(record);
    addReq.onsuccess = function() {
      showToast('导入成功');
      refreshLibrary();
    };
  };
  reader.onerror = function() { showToast('读取文件失败'); };
  reader.readAsArrayBuffer(file);
}

// 文本编码检测与解码：BOM 检测 → UTF-8/GBK 双解码评分择优
function decodeTextBuffer(ab) {
  try {
    var bytes = new Uint8Array(ab);

    // 1. BOM 检测
    if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
      return new TextDecoder('utf-8').decode(ab);
    }
    if (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE) {
      return new TextDecoder('utf-16le').decode(ab);
    }
    if (bytes.length >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF) {
      return new TextDecoder('utf-16be').decode(ab);
    }

    // 无 BOM：分别用 UTF-8 和 GBK 解码，按乱码字符比例评分
    var utf8Text = null, gbkText = null;
    try {
      utf8Text = new TextDecoder('utf-8', { fatal: false }).decode(ab);
    } catch(e) {}
    try {
      gbkText = new TextDecoder('gbk', { fatal: false }).decode(ab);
    } catch(e) {}

    // UTF-8 解码无替换符 → 大概率就是 UTF-8
    if (utf8Text && utf8Text.indexOf('\uFFFD') === -1) return utf8Text;

    // 双方都有替换符（或 GBK 干净）→ 比较评分
    var utf8Score = utf8Text ? scoreDecodedText(utf8Text) : -1;
    var gbkScore = gbkText ? scoreDecodedText(gbkText) : -1;
    if (gbkScore > utf8Score) return gbkText;
    return utf8Text || gbkText;
  } catch(e) {
    return null;
  }
}

// 评估解码质量：替换符/控制字符扣分，常见中文标点和汉字加分
function scoreDecodedText(text) {
  var len = text.length;
  if (!len) return -1;
  var sample = text.substring(0, Math.min(len, 5000));
  var score = 100;

  var badChars = (sample.match(/[\uFFFD\u0000-\u0008\u000E-\u001F]/g) || []).length;
  score -= badChars * 10;

  var goodChars = (sample.match(/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/g) || []).length;
  score += Math.min(goodChars / sample.length * 50, 50);

  return score;
}

function splitTextChapters(text, isMd) {
  var lines = text.split(/\r?\n/);
  var chapters = [];
  var currentTitle = '开头';
  var currentLines = [];
  // 标题匹配模式
  var headingRe = isMd
    ? /^#{1,3}\s+(.+)/                              // MD: # ## ###
    : /^(第[一二三四五六七八九十百千\d]+[章节卷篇部回]|Chapter\s+\d+)/i;  // TXT: 第X章

  for (var i = 0; i < lines.length; i++) {
    var match = lines[i].match(headingRe);
    if (match && currentLines.length > 0) {
      chapters.push({ title: currentTitle, lines: currentLines });
      currentTitle = match[1] || match[0] || lines[i].trim();
      currentLines = [];
    } else if (match && currentLines.length === 0) {
      currentTitle = match[1] || match[0] || lines[i].trim();
    } else {
      currentLines.push(lines[i]);
    }
  }
  if (currentLines.length > 0) {
    chapters.push({ title: currentTitle, lines: currentLines });
  }
  // 如果没分出章节，整本当一章
  if (chapters.length === 0) {
    chapters.push({ title: '全文', lines: lines });
  }
  return chapters;
}

function parseMetadata(zip) {
  return getOpfPath(zip).then(function(opfPath) {
    return zip.file(opfPath).async('text').then(function(opf) {
      var title = (opf.match(/<dc:title[^>]*>([^<]+)/i) || [])[1] || '';
      var author = (opf.match(/<dc:creator[^>]*>([^<]+)/i) || [])[1] || '';

      // 尝试提取封面
      var coverPromise = Promise.resolve(null);
      var coverMeta = opf.match(/<meta[^>]*name=["']cover["'][^>]*content=["']([^"']+)["']/i);
      if (coverMeta) {
        var coverId = coverMeta[1];
        var itemRe = /<item\b[^>]*>/gi;
        var m;
        var coverHref = null;
        var base = opfPath.indexOf('/') >= 0 ? opfPath.substring(0, opfPath.lastIndexOf('/') + 1) : '';
        while ((m = itemRe.exec(opf))) {
          var tag = m[0];
          var idM = tag.match(/\bid\s*=\s*["']([^"']+)["']/i);
          var hrM = tag.match(/\bhref\s*=\s*["']([^"']+)["']/i);
          if (idM && hrM && idM[1] === coverId) { coverHref = hrM[1]; break; }
        }
        if (coverHref) {
          var coverPath = resolvePath(base, coverHref);
          var coverFile = zip.file(coverPath);
          if (coverFile) {
            coverPromise = coverFile.async('base64').then(function(b64) {
              var ext = coverHref.split('.').pop().toLowerCase();
              var mime = ext === 'png' ? 'image/png' : 'image/jpeg';
              return 'data:' + mime + ';base64,' + b64;
            }).catch(function() { return null; });
          }
        }
      }

      return coverPromise.then(function(coverData) {
        return { title: title, author: author, coverData: coverData };
      });
    });
  });
}

// ============ 打开书籍 ============
function openBook(bookId) {
  if (!db) return;
  var tx = db.transaction(STORE_BOOKS, 'readonly');
  tx.objectStore(STORE_BOOKS).get(bookId).onsuccess = function(e) {
    var book = e.target.result;
    // 类型兼容：字符串 ID 查不到时尝试数字键（书架存的是数字 id）
    if (!book && typeof bookId === 'string' && /^\d+$/.test(bookId)) {
      return openBook(Number(bookId));
    }
    if (!book) { showToast('书籍数据丢失'); return; }
    currentBookId = bookId;
    currentBookTitle = book.title;
    localStorage.setItem('cr_last_book', String(bookId));

    // 通知 Bridge 书籍已打开（用于自动创建/切换对话）
    try {
      if (window.CoreadBridge && window.CoreadBridge.onBookOpened) {
        window.CoreadBridge.onBookOpened(JSON.stringify({
          bookId: currentBookId,
          bookTitle: currentBookTitle
        }));
      }
    } catch(e) {}

    // TXT/MD 类型
    if (book.__txtChapters) {
      openTextBook(book);
      return;
    }

    // EPUB 类型
    if (!book.fileData) { showToast('书籍数据丢失'); return; }
    var b64 = book.fileData;
    var comma = b64.indexOf(',');
    var raw = comma >= 0 ? b64.substring(comma + 1) : b64;
    var binary = atob(raw);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

    JSZip.loadAsync(bytes.buffer).then(function(zip) {
      epubZip = zip;
      return loadEpub();
    }).catch(function(err) {
      showToast('打开失败: ' + err.message);
    });
  };
}

// ============ 打开 TXT/MD 书 ============
function openTextBook(book) {
  chapters = book.__txtChapters.map(function(c, i) {
    return { title: c.title, __lines: c.lines, __isMd: book.__isMd };
  });

  $('readerOverlay').classList.add('active');
  $('readerTitle').textContent = currentBookTitle;
  history.pushState({ reader: true }, '');

  var prog = loadProgress();
  var startIdx = 0, startScroll = 0;
  if (prog && prog.chapterIdx >= 0 && prog.chapterIdx < chapters.length) {
    startIdx = prog.chapterIdx;
    startScroll = prog.scrollTop || 0;
    // 恢复翻页模式
    if (prog.pageMode) { __pageMode = prog.pageMode; localStorage.setItem('cr-page-mode', __pageMode); }
  }
  loadTextChapter(startIdx, startScroll);
}

function loadTextChapter(idx, restoreScroll) {
  if (idx < 0 || idx >= chapters.length) return;
  currentIdx = idx;
  var ch = chapters[idx];
  var pageText = $('pageText');

  // 清除 EPUB 动态 CSS
  var dynamicCss = $('dynamicCss');
  if (dynamicCss) dynamicCss.textContent = '';

  // 渲染内容
  var html = '';
  if (ch.__isMd) {
    // 简单 MD 渲染
    html = simpleMarkdown(ch.__lines.join('\n'));
  } else {
    ch.__lines.forEach(function(line) {
      line = line.trim();
      if (!line) { html += '<br>'; return; }
      html += '<p>' + line.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</p>';
    });
  }
  pageText.innerHTML = html;
  $('readerTitle').textContent = currentBookTitle + ' \u00B7 ' + (ch.title || '');

  var content = $('readerContent');
  if (restoreScroll && restoreScroll > 0) {
    setTimeout(function() { content.scrollTop = restoreScroll; }, 100);
  } else {
    content.scrollTop = 0;
  }
  updateProgress();
  setTimeout(saveProgress, 300);
    restoreHighlights();
    // page 模式恢复
    if (__pageMode === 'page') {
      var prog2 = loadProgress();
      buildPages();
      if (prog2 && prog2.pageIndex >= 0) { currentPage = Math.min(prog2.pageIndex, totalPages - 1); }
      __showCurrentPage();
    }
}

// 通用章节加载（自动判断 EPUB/TXT）
function loadChapterAuto(idx, scroll) {
  if (chapters[idx] && chapters[idx].__lines) {
    loadTextChapter(idx, scroll);
  } else {
    loadChapter(idx, scroll);
  }
}
function simpleMarkdown(text) {
  // 安全整改：先整体转义 HTML，杜绝书籍内容中的标签被当作 DOM 注入（XSS）
  var html = String(text)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '"').replace(/'/g, '&#39;')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br>');
  return '<p>' + html + '</p>';
}

function getOpfPath(zip) {
  var z = zip || epubZip;
  return z.file('META-INF/container.xml').async('text').then(function(c) {
    return c.match(/full-path\s*=\s*["']([^"']+)["']/i)[1];
  });
}

function loadEpub() {
  // 显示阅读器
  $('readerOverlay').classList.add('active');
  $('readerTitle').textContent = currentBookTitle;
  $('pageText').innerHTML = '<div style="text-align:center;padding:40px;color:var(--ink-3);font-family:var(--font-mono);">LOADING...</div>';

  return getOpfPath().then(function(opfPath) {
    return epubZip.file(opfPath).async('text').then(function(opf) {
      return parseChapters(opf, opfPath);
    });
  }).then(function(chs) {
    chapters = chs;
    // 预解析所有章节标题（异步，不阻塞首次加载）
    preloadTitles();
    // 恢复进度
    var prog = loadProgress();
    var startIdx = 0;
    var startScroll = 0;
    if (prog && prog.chapterIdx >= 0 && prog.chapterIdx < chapters.length) {
      startIdx = prog.chapterIdx;
      startScroll = prog.scrollTop || 0;
      // 恢复翻页模式
      if (prog.pageMode) { __pageMode = prog.pageMode; localStorage.setItem('cr-page-mode', __pageMode); }
    }
    return loadChapter(startIdx, startScroll);
  });
}

// 预解析所有章节的真实标题（从 HTML 的 <title> 或 <h1> 提取）
function preloadTitles() {
  chapters.forEach(function(ch, i) {
    var f = epubZip.file(ch.fullPath);
    if (!f) return;
    f.async('text').then(function(html) {
      var titleMatch = html.match(/<title[^>]*>([^<]+)/i);
      var h1Match = html.match(/<h1[^>]*>([^<]+)/i);
      var realTitle = ((titleMatch ? titleMatch[1] : '') || (h1Match ? h1Match[1] : '') || '').trim();
      var junkTitles = ['', '未知', 'unknown', 'untitled', 'cover', 'null'];
      if (realTitle && junkTitles.indexOf(realTitle.toLowerCase()) === -1) {
        chapters[i].title = realTitle;
      }
    });
  });
}

function parseChapters(opf, opfPath) {
  var idToHref = {};
  var itemRe = /<item\b[^>]*>/gi;
  var m;
  while ((m = itemRe.exec(opf))) {
    var tag = m[0];
    var idM = tag.match(/\bid\s*=\s*["']([^"']+)["']/i);
    var hrM = tag.match(/\bhref\s*=\s*["']([^"']+)["']/i);
    if (idM && hrM) idToHref[idM[1]] = hrM[1];
  }
  var base = opfPath.indexOf('/') >= 0 ? opfPath.substring(0, opfPath.lastIndexOf('/') + 1) : '';
  var res = [];
  var refRe = /<itemref\b[^>]*idref\s*=\s*["']([^"']+)["'][^>]*>/gi;
  while ((m = refRe.exec(opf))) {
    var href = idToHref[m[1]];
    if (href) {
      res.push({
        fullPath: (base + href).replace(/\/+/g, '/'),
        title: decodeURIComponent(href.split('/').pop().replace(/\.\w+$/, ''))
      });
    }
  }
  return res;
}

// ============ EPUB 注释/脚注系统 ============
// 跨章注释内容缓存：key = "zip路径#id"，value = HTML 字符串
var __noteCache = {};

// 判断链接是否是"引用标记"（脚注/尾注/注释引用）
// 规则：内部链接（含#），且显示文字很短（数字、符号或少量字符）
function isNoteRef(a) {
  var href = a.getAttribute('href') || '';
  if (href.indexOf('#') < 0) return false;
  if (/^(https?:|mailto:|tel:)/i.test(href)) return false;
  var txt = (a.textContent || '').trim();
  if (!txt || txt.length > 8) return false;
  // 常见标记形态：纯数字、带括号/方括号数字、星号剑号等符号
  if (/^[\d\s]+$/.test(txt)) return true;
  if (/^[\[\(（【]?\d+[\]\)）】]?$/.test(txt)) return true;
  if (/^[*†‡§¶※◎○●☆★①②③④⑤⑥⑦⑧⑨⑩]+$/.test(txt)) return true;
  // epub:type 标准标注（优先级最高，直接命中）
  var et = a.getAttribute('epub:type') || a.getAttributeNS('http://www.idpf.org/2007/ops', 'type') || '';
  if (et && /noteref/i.test(et)) return true;
  return false;
}

// 从目标元素提取干净的注释 HTML
function extractNoteHtml(target) {
  var clone = target.cloneNode(true);
  // 去掉回跳链接和脚本
  var junk = clone.querySelectorAll('a[href^="#"], script, style');
  for (var i = 0; i < junk.length; i++) {
    if (junk[i].tagName === 'A') {
      // 回跳链接：保留文字（通常是 ← 或 编号），去掉链接行为
      var span = document.createElement('span');
      span.className = 'fn-backref';
      span.textContent = junk[i].textContent;
      junk[i].replaceWith(span);
    } else {
      junk[i].remove();
    }
  }
  return clone.innerHTML.trim();
}

// 解析 href → { file: zip内路径|null, id: 锚点id }；file 为 null 表示同章
function parseNoteHref(href, base, currentFullPath) {
  var hashIdx = href.indexOf('#');
  var filePart = hashIdx === 0 ? '' : href.substring(0, hashIdx);
  var id = href.substring(hashIdx + 1);
  if (!filePart) return { file: null, id: id };
  var decoded = decodeURIComponent(filePart);
  var resolved = resolvePath(base, decoded);

  // 同章自引用（resolved 与当前章 fullPath 尾部一致，或 zip 中该路径就是当前章文件）
  var curTail = currentFullPath ? currentFullPath.split('/').pop() : '';
  if (curTail && resolved.split('/').pop() === curTail) return { file: null, id: id };

  if (!epubZip.file(resolved)) {
    // 兜底：按文件名模糊匹配
    var fileName = decoded.split('/').pop();
    var found = null;
    epubZip.forEach(function(path) {
      if (!found && path.indexOf(fileName) >= 0) found = path;
    });
    resolved = found;
    // 模糊匹配后再次确认是否为当前章
    if (resolved === currentFullPath || (curTail && resolved && resolved.split('/').pop() === curTail)) {
      return { file: null, id: id };
    }
  }
  return { file: resolved, id: id };
}

// 处理章节 DOM 中的所有注释引用
function processEpubNotes(d, base) {
  try {
    var links = d.querySelectorAll('a[href*="#"]');
    var count = 0;
    for (var i = 0; i < links.length; i++) {
      var a = links[i];
      if (!isNoteRef(a)) continue;
      var parsed = parseNoteHref(a.getAttribute('href'), base, chapters[currentIdx] ? chapters[currentIdx].fullPath : '');
      if (!parsed.id) continue;

      var noteHtml = null;
      // 同章：直接查
      if (!parsed.file) {
        var target = d.querySelector('[id="' + parsed.id.replace(/"/g, '\\"') + '"]') ||
                     d.querySelector('#' + CSS.escape(parsed.id)) ||
                     d.querySelector('[name="' + parsed.id.replace(/"/g, '\\"') + '"]');
        if (target) noteHtml = extractNoteHtml(target);
      }

      if (noteHtml) {
        // 同章且拿到内容：转浮层
        convertToNoteRef(a, noteHtml, parsed);
        count++;
      } else if (parsed.file && epubZip.file(parsed.file)) {
        // 跨章且文件确实存在：异步拉取
        convertToNoteRef(a, null, parsed);
        count++;
      }
      // 其余情况：不转换，保持原生 <a> 跳转行为
    }
    if (count > 0) injectNotePopupCss();
  } catch(e) {}
}

// 把 <a> 引用改造成可点击的注释标记
function convertToNoteRef(a, noteHtml, parsed) {
  a.classList.add('cr-noteref');
  a.removeAttribute('href'); // 阻止默认跳转
  a.setAttribute('role', 'button');

  a.addEventListener('click', function(ev) {
    ev.preventDefault();
    ev.stopPropagation();
    try {
      if (noteHtml !== null) {
        showNotePopup(noteHtml);
      } else {
        // 异步加载跨章注释（带缓存）
        var cacheKey = parsed.file + '#' + parsed.id;
        showNotePopup('<div style="text-align:center;color:var(--ink-3);padding:20px;">LOADING…</div>');
        if (__noteCache[cacheKey]) {
          setTimeout(function() { showNotePopup(__noteCache[cacheKey]); }, 120);
          return;
        }
        var f = parsed.file ? epubZip.file(parsed.file) : null;
        if (!f || f.dir) { showNotePopup('<p style="color:var(--ink-3);">未找到注释内容<br><small>' + escHtml(String(parsed.file)) + '</small></p>'); return; }
        f.async('text').then(function(raw) {
          var dd = document.createElement('div');
          dd.innerHTML = raw;
          var dangerous2 = dd.querySelectorAll('script, iframe, object, embed, form');
          for (var x = 0; x < dangerous2.length; x++) dangerous2[x].remove();
          var target2 = dd.querySelector('[id="' + parsed.id.replace(/"/g, '\\"') + '"]') || dd.querySelector('#' + CSS.escape(parsed.id)) || dd.querySelector('[name="' + parsed.id.replace(/"/g, '\\"') + '"]');
          var html = target2 ? extractNoteHtml(target2) : '<p style="color:var(--ink-3);">未找到锚点 #' + escHtml(parsed.id) + '</p>';
          __noteCache[cacheKey] = html;
          showNotePopup(html);
        }).catch(function(err) {
          showNotePopup('<p style="color:var(--danger,#c25946);">加载失败：<br><small>' + escHtml(String(err && err.message || err)) + '</small></p>');
        });
      }
    } catch(err) {
      showNotePopup('<p style="color:var(--danger,#c25946);">出错：<br><small>' + escHtml(String(err && err.message || err)) + '</small></p>');
    }
  });
}

// 底部浮层（风格对齐批注详情页 .nd-sheet）
function showNotePopup(html) {
  var old = document.getElementById('fnPopupOverlay');
  if (old) old.remove();

  var ov = document.createElement('div');
  ov.id = 'fnPopupOverlay';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:10001;display:flex;align-items:flex-end;justify-content:center;opacity:0;transition:opacity 0.22s;';
  ov.innerHTML =
    '<div class="fn-sheet">' +
      '<div class="fn-header">' +
        '<span class="mi" style="font-size:16px;color:var(--accent)">menu_book</span>' +
        '<span class="fn-title">注释</span>' +
        '<button class="fn-close"><span class="mi">close</span></button>' +
      '</div>' +
      '<div class="fn-body">' + html + '</div>' +
    '</div>';

  document.body.appendChild(ov);
  requestAnimationFrame(function() {
    ov.style.opacity = '1';
    var sheet = ov.querySelector('.fn-sheet');
    if (sheet) sheet.style.transform = 'translateY(0)';
  });

  function close() {
    ov.style.opacity = '0';
    setTimeout(function() { ov.remove(); }, 220);
  }
  ov.querySelector('.fn-close').onclick = close;
  ov.addEventListener('click', function(e) { if (e.target === ov) close(); });

  var body = ov.querySelector('.fn-body');
  // 注释里的图片也走 blob 加载
  var fnImgs = body.querySelectorAll('img[src]');
  for (var i = 0; i < fnImgs.length; i++) {
    (function(im) {
      var src = im.getAttribute('src') || '';
      if (!src || src.indexOf('data:') === 0) return;
      var f = epubZip.file(decodeURIComponent(src)) ;
      if (!f) {
        var fileName = src.split('/').pop();
        epubZip.forEach(function(path, file) {
          if (!f && path.indexOf(fileName) >= 0) f = file;
        });
      }
      if (f) f.async('blob').then(function(b) { im.src = URL.createObjectURL(b); });
    })(fnImgs[i]);
  }
}

// 浮层样式（一次性注入）
function injectNotePopupCss() {
  if (document.getElementById('fnPopupCss')) return;
  var st = document.createElement('style');
  st.id = 'fnPopupCss';
  st.textContent =
    '.cr-noteref{cursor:pointer;color:var(--accent);font-weight:600;vertical-align:super;font-size:0.75em;padding:0 1px;border-bottom:none;text-decoration:none;-webkit-tap-highlight-color:transparent;}' +
    '.cr-noteref:active{opacity:0.6;}' +
    '.fn-sheet{width:100%;max-width:560px;max-height:60vh;background:var(--bg-1);border:1px solid var(--border);border-bottom:none;border-radius:var(--radius) var(--radius) 0 0;display:flex;flex-direction:column;transform:translateY(100%);transition:transform 0.26s cubic-bezier(0.32,0.72,0.35,1);box-shadow:var(--shadow-sheet);}' +
    '.fn-header{display:flex;align-items:center;gap:7px;padding:12px 14px;border-bottom:1px dashed var(--border);flex-shrink:0;}' +
    '.fn-title{flex:1;font-size:13px;font-weight:600;color:var(--ink-2);letter-spacing:0.12em;font-family:var(--font-mono);}' +
    '.fn-close{width:32px;height:32px;border:none;background:transparent;color:var(--ink-3);border-radius:var(--radius);display:flex;align-items:center;justify-content:center;cursor:pointer;}' +
    '.fn-body{padding:16px;overflow-y:auto;-webkit-overflow-scrolling:touch;font-size:calc(var(--fs,18px) - 2px);line-height:var(--lh,2);color:var(--ink);}' +
    '.fn-body p{margin:0 0 0.6em;}' +
    '.fn-body p:last-child{margin-bottom:0;}' +
    '.fn-body img{max-width:100%;height:auto;border-radius:4px;margin:8px 0;}' +
    '.fn-backref{color:var(--ink-3);}';
  document.head.appendChild(st);
}

// ============ 加载章节 ============
function loadChapter(idx, restoreScroll) {
  if (idx < 0 || idx >= chapters.length) return Promise.resolve();
  currentIdx = idx;
  var ch = chapters[idx];
  var pageText = $('pageText');
  pageText.innerHTML = '';

  var chFile = epubZip.file(ch.fullPath);
  if (!chFile) {
    // 兜底：按文件名模糊匹配 zip 内真实路径
    var want = decodeURIComponent(ch.fullPath.split('/').pop() || '');
    var found2 = null;
    epubZip.forEach(function(path, file) {
      if (!found2 && !file.dir && path.indexOf(want) >= 0 && /\.x?html?$/i.test(path)) found2 = path;
    });
    if (found2) { ch.fullPath = found2; chFile = epubZip.file(found2); }
  }
  if (!chFile) {
    showToast('章节文件缺失: ' + ch.fullPath);
    return Promise.resolve();
  }

  return chFile.async('text').then(function(raw) {
    var d = document.createElement('div');
    d.innerHTML = raw;
    // 安全整改：清除 EPUB 内容中的脚本标签，防止 XSS
    var dangerous = d.querySelectorAll('script, iframe, object, embed, form, meta[http-equiv]');
    for (var di = 0; di < dangerous.length; di++) dangerous[di].remove();
    // 清除事件处理属性
    var allEls = d.querySelectorAll('*');
    for (var ai = 0; ai < allEls.length; ai++) {
      var attrs = allEls[ai].attributes;
      for (var ati = attrs.length - 1; ati >= 0; ati--) {
        var aname = attrs[ati].name.toLowerCase();
        if (aname.indexOf('on') === 0 || (aname === 'href' && String(attrs[ati].value).trim().toLowerCase().indexOf('javascript:') === 0)) {
          allEls[ai].removeAttribute(attrs[ati].name);
        }
      }
    }
    var base = ch.fullPath.indexOf('/') >= 0 ? ch.fullPath.substring(0, ch.fullPath.lastIndexOf('/') + 1) : '';

    // ============ EPUB 注释/脚注处理（点击引用弹出浮层） ============
    // 【已停用】部分设备 WebView 不支持 CSS.escape / replaceWith 等新 API，导致报错。
    // 代码保留在 processEpubNotes 及相关函数中，待做 API 兼容检测后可恢复：
    // if (window.CSS && CSS.escape && Element.prototype.replaceWith) processEpubNotes(d, base);

    // 处理图片（img + image[xlink:href] + svg image）
    var imgPromises = [];
    var imgs = d.querySelectorAll('img, image');
    for (var i = 0; i < imgs.length; i++) {
      (function(img) {
        // 脚注/尾注链接内的小图标直接隐藏
        var parentLink = img.closest ? img.closest('a[href*="#"]') : null;
        if (parentLink) { img.style.display = 'none'; return; }
        var src = img.getAttribute('src') || img.getAttribute('xlink:href') || img.getAttributeNS('http://www.w3.org/1999/xlink', 'href') || '';
        if (!src || src.indexOf('data:') === 0) return;
        var resolved = resolvePath(base, decodeURIComponent(src));
        var f = epubZip.file(resolved);
        if (!f) {
          // 尝试不带路径直接匹配文件名
          var fileName = src.split('/').pop();
          epubZip.forEach(function(path, file) {
            if (!f && path.indexOf(fileName) >= 0) f = file;
          });
        }
        if (f) {
          imgPromises.push(f.async('blob').then(function(blob) {
            if (blob.size < 600) { img.style.display = 'none'; return; }
            img.src = URL.createObjectURL(blob);
            if (img.tagName === 'image') {
              img.setAttributeNS('http://www.w3.org/1999/xlink', 'href', URL.createObjectURL(blob));
            }
          }));
        }
      })(imgs[i]);
    }

    // 收集 EPUB CSS
    var cssText = '';
    var styleEls = d.querySelectorAll("link[rel='stylesheet'], style");
    var cssPromises = [];
    for (var j = 0; j < styleEls.length; j++) {
      var el = styleEls[j];
      if (el.tagName === 'STYLE') {
        cssText += el.innerHTML + '\n';
      } else {
        var href = el.getAttribute('href');
        if (href) {
          var cssFile = epubZip.file(resolvePath(base, href));
          if (cssFile) {
            cssPromises.push(cssFile.async('text'));
          }
        }
      }
      el.remove();
    }

    return Promise.all(cssPromises).then(function(cssArr) {
      cssText += cssArr.join('\n');
      cssText = sanitizeEpubCss(cssText);

      // 注入动态 CSS
      var styleTag = $('dynamicCss') || document.createElement('style');
      styleTag.id = 'dynamicCss';
      styleTag.textContent = cssText;
      document.head.appendChild(styleTag);

      // 清理 inline style 的危险属性
      var styled = d.querySelectorAll('[style]');
      for (var k = 0; k < styled.length; k++) {
        var s = styled[k].getAttribute('style') || '';
        s = s.replace(/(?:^|;)\s*(height|min-height|max-height|width|min-width|max-width|position|overflow|float)\s*:[^;]*;?/gi, '');
        if (s.trim()) styled[k].setAttribute('style', s);
        else styled[k].removeAttribute('style');
      }

      // 提取真实章节标题（过滤垃圾标题，避免覆盖成"未知"）
      var titleEl = d.querySelector('title');
      var h1El = d.querySelector('h1');
      var realTitle = ((titleEl ? titleEl.textContent : '') || (h1El ? h1El.textContent : '') || '').trim();
      var junkTitles = ['', '未知', 'unknown', 'untitled', 'cover', 'null'];
      var isJunk = junkTitles.indexOf(realTitle.toLowerCase()) !== -1;
      if (realTitle && !isJunk && chapters[idx]) {
        chapters[idx].title = realTitle;
      }

      // 等图片全部替换完毕后再注入 DOM
      return Promise.all(imgPromises).then(function() {
        pageText.innerHTML = d.innerHTML;
        $('readerTitle').textContent = currentBookTitle + ' \u00B7 ' + (chapters[idx].title || '');
      });
    });
  }).then(function() {
    return waitImages($('pageText'));
  }).then(function() {
    // 等一帧让布局稳定
    return new Promise(function(r) { requestAnimationFrame(function() { requestAnimationFrame(r); }); });
  }).then(function() {
    // 恢复滚动位置（多次重试确保内容渲染完毕）
    var content = $('readerContent');
    if (restoreScroll && restoreScroll > 0) {
      var attempts = 0;
      var tryRestore = function() {
        content.scrollTop = restoreScroll;
        attempts++;
        // 如果没滚到位且还有重试机会，继续等
        if (Math.abs(content.scrollTop - restoreScroll) > 10 && attempts < 8) {
          setTimeout(tryRestore, 100);
        }
      };
      setTimeout(tryRestore, 100);
    } else {
      content.scrollTop = 0;
    }
    updateProgress();
    // 延迟保存进度
    setTimeout(saveProgress, 500);
    restoreHighlights();
    // page 模式恢复
    if (__pageMode === 'page') {
      var prog2 = loadProgress();
      buildPages();
      if (prog2 && prog2.pageIndex >= 0) { currentPage = Math.min(prog2.pageIndex, totalPages - 1); }
      __showCurrentPage();
    }
  });
}

// ============ 进度 ============
function saveProgress() {
  if (!currentBookId || !chapters.length) return;
  var content = $('readerContent');
  var key = 'cr_progress_' + currentBookId;
  localStorage.setItem(key, JSON.stringify({
    chapterIdx: currentIdx,
    scrollTop: content ? content.scrollTop : 0,
    pageIndex: currentPage,
    pageMode: __pageMode,
    updatedAt: Date.now()
  }));
}

function loadProgress() {
  if (!currentBookId) return null;
  var key = 'cr_progress_' + currentBookId;
  var raw = localStorage.getItem(key);
  if (!raw) {
    // 兼容旧版：尝试用书名 key 读取
    var oldKey = 'cr_progress_' + currentBookTitle;
    raw = localStorage.getItem(oldKey);
  }
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

function updateProgress() {
  var content = $('readerContent');
  if (!content) return;
  var scrollH = content.scrollHeight - content.clientHeight;
  var pct = scrollH > 0 ? (content.scrollTop / scrollH) : 0;
  // 全书进度：当前章进度 + 已读章节
  var chapterPct = chapters.length > 0 ? (currentIdx + pct) / chapters.length : 0;
  var fill = $('progressFill');
  if (fill) fill.style.width = Math.round(chapterPct * 100) + '%';
  var pageNum = $('pageNum');
  if (pageNum) pageNum.textContent = (currentIdx + 1) + ' / ' + chapters.length;
}

// ============ 翻页 + 手势 ============
var __pageMode = localStorage.getItem('cr-page-mode') || 'scroll';
var __pageBreaks = [];
var __pageModeInited = false;
var __pagesReady = false;
var currentPage = 0;
var totalPages = 1;
var __turning = false;

function buildPages() {
  __pagesReady = false;
  var content = $('readerContent');
  var pageText = $('pageText');
  if (!content || !pageText) return;

  if (__pageMode === 'page') {
    content.classList.add('cr-page-mode-wrap');
    pageText.classList.add('cr-page-mode');

    // 展平单层包裹元素
    for (var attempt = 0; attempt < 3; attempt++) {
      var ch = pageText.children;
      if (ch.length >= 1 && ch.length <= 3) {
        var bigChild = null;
        for (var bc = 0; bc < ch.length; bc++) {
          if (ch[bc].children && ch[bc].children.length > 2 && ch[bc].offsetHeight > 0) { bigChild = ch[bc]; break; }
        }
        if (bigChild) {
          var frag = document.createDocumentFragment();
          while (bigChild.firstChild) frag.appendChild(bigChild.firstChild);
          bigChild.parentNode.replaceChild(frag, bigChild);
        } else break;
      } else break;
    }

    // 重置所有子元素
    var allCh = Array.from(pageText.children);
    for (var i = 0; i < allCh.length; i++) {
      allCh[i].classList.remove('cr-page-hidden');
      allCh[i].style.maxHeight = '';
      allCh[i].style.marginTop = '';
      allCh[i].style.overflow = '';
    }

    var pageH = content.clientHeight;
    if (pageH <= 0) { setTimeout(buildPages, 100); return; }
    var mx = parseInt(getComputedStyle(pageText).paddingLeft) || 24;
    var usable = pageH - mx * 2;
    var lh = parseFloat(getComputedStyle(pageText).lineHeight) || 28;
    __pageBreaks = [];
    var curPage = [];
    var accum = 0;

    for (var i = 0; i < allCh.length; i++) {
      var el = allCh[i];
      var elH = el.offsetHeight;
      var mb = parseInt(getComputedStyle(el).marginBottom) || 0;
      var totalH = elH + mb;

      if (accum + totalH <= usable) {
        curPage.push({ idx: i });
        accum += totalH;
      } else if (accum === 0) {
        var fitLines = Math.floor(usable / lh);
        var clipH = fitLines * lh;
        curPage.push({ idx: i, clipH: clipH });
        __pageBreaks.push(curPage);
        var remaining = elH - clipH;
        curPage = [];
        while (remaining > usable) {
          curPage.push({ idx: i, offsetH: elH - remaining, clipH: usable });
          __pageBreaks.push(curPage);
          remaining -= usable;
          curPage = [];
        }
        curPage.push({ idx: i, offsetH: elH - remaining });
        accum = remaining + mb;
      } else {
        var remainSpace = usable - accum;
        var fitLines2 = Math.floor(remainSpace / lh);
        if (fitLines2 >= 1) {
          var clipH2 = fitLines2 * lh;
          curPage.push({ idx: i, clipH: clipH2 });
          __pageBreaks.push(curPage);
          curPage = [{ idx: i, offsetH: clipH2 }];
          accum = elH - clipH2 + mb;
        } else {
          __pageBreaks.push(curPage);
          curPage = [{ idx: i }];
          accum = totalH;
        }
      }
    }
    if (curPage.length > 0) __pageBreaks.push(curPage);
    totalPages = __pageBreaks.length;
    if (currentPage >= totalPages) currentPage = totalPages - 1;
    if (currentPage < 0) currentPage = 0;
    __showCurrentPage();
    updateProgress();
    __pagesReady = true;
  } else {
    pageText.classList.remove('cr-page-mode');
    content.classList.remove('cr-page-mode-wrap');
    var allCh2 = Array.from(pageText.children);
    for (var i = 0; i < allCh2.length; i++) {
      allCh2[i].classList.remove('cr-page-hidden');
      allCh2[i].style.maxHeight = '';
      allCh2[i].style.marginTop = '';
      allCh2[i].style.overflow = '';
    }
    var ph = content.clientHeight;
    if (ph <= 0) return;
    totalPages = Math.max(1, Math.ceil(content.scrollHeight / ph));
    currentPage = Math.round(content.scrollTop / ph);
    if (currentPage >= totalPages) currentPage = totalPages - 1;
    updateProgress();
  }
}

function __showCurrentPage() {
  var allCh = Array.from($('pageText').children);
  var pageItems = __pageBreaks[currentPage] || [];
  var visibleIdxs = {};
  for (var p = 0; p < pageItems.length; p++) visibleIdxs[pageItems[p].idx] = pageItems[p];

  for (var i = 0; i < allCh.length; i++) {
    var el = allCh[i];
    var item = visibleIdxs[i];
    if (item) {
      el.classList.remove('cr-page-hidden');
      if (item.clipH !== undefined && !item.offsetH) {
        el.style.maxHeight = item.clipH + 'px';
        el.style.overflow = 'hidden';
        el.style.marginTop = '';
      } else if (item.offsetH !== undefined) {
        el.style.marginTop = '-' + item.offsetH + 'px';
        el.style.overflow = 'hidden';
        el.style.maxHeight = item.clipH !== undefined ? item.clipH + 'px' : '';
      } else {
        el.style.maxHeight = '';
        el.style.marginTop = '';
        el.style.overflow = '';
      }
    } else {
      el.classList.add('cr-page-hidden');
      el.style.maxHeight = '';
      el.style.marginTop = '';
      el.style.overflow = '';
    }
  }
  $('readerContent').scrollTop = 0;
}

function showPage(n) {
  if (n < 0 || n >= totalPages) return;
  currentPage = n;
  if (__pageMode === 'page') {
    __showCurrentPage();
    updateProgress();
    saveProgress();
  } else {
    var content = $('readerContent');
    var ph = content.clientHeight;
    var lh = parseFloat(getComputedStyle($('pageText')).lineHeight) || 28;
    var overlap = (n > 0) ? lh : 0;
    content.scrollTo({ top: n * ph - overlap, behavior: 'smooth' });
    updateProgress();
    setTimeout(saveProgress, 300);
  }
}

function setPageMode(mode) {
  __pageMode = mode;
  localStorage.setItem('cr-page-mode', mode);
  if (mode === 'page') {
    var content = $('readerContent');
    var scrollRatio = content.scrollTop / Math.max(1, content.scrollHeight - content.clientHeight);
    buildPages();
    currentPage = Math.min(totalPages - 1, Math.max(0, Math.round(scrollRatio * (totalPages - 1))));
    __showCurrentPage();
  } else {
    // page → scroll：用页码比例估算 scrollTop
    var content = $('readerContent');
    var scrollRatio = totalPages > 1 ? currentPage / (totalPages - 1) : 0;
    buildPages();
    var maxScroll = content.scrollHeight - content.clientHeight;
    content.scrollTop = Math.round(scrollRatio * maxScroll);
  }
  saveProgress();
  var btnS = $('btnPageModeScroll');
  var btnP = $('btnPageModePage');
  if (btnS) { btnS.style.background = mode === 'scroll' ? 'var(--accent)' : ''; btnS.style.color = mode === 'scroll' ? '#fff' : ''; }
  if (btnP) { btnP.style.background = mode === 'page' ? 'var(--accent)' : ''; btnP.style.color = mode === 'page' ? '#fff' : ''; }
}
window.setPageMode = setPageMode;

function togglePageMode() {
  var newMode = __pageMode === 'page' ? 'scroll' : 'page';
  setPageMode(newMode);
  showToast(newMode === 'page' ? '翻页模式' : '滚动模式');
}
window.togglePageMode = togglePageMode;

function initPageTap() {
  var content = $('readerContent');
  if (!content) return;

  // --- 点击翻页 ---
  content.addEventListener('click', function(e) {
    // 如果点击的是工具栏内的按钮，不处理
    if (e.target.closest('.reader-topbar') || e.target.closest('.reader-bottombar') || e.target.closest('.toc-panel')) return;

    // 如果批注弹窗/划线菜单/设置面板正在显示，点击外部时关闭它们，不翻页
    if ($('notePopup').classList.contains('active')) {
      closeNote();
      return;
    }
    if ($('hlMenu').classList.contains('active')) {
      $('hlMenu').classList.remove('active');
      window.getSelection().removeAllRanges();
      return;
    }
    if ($('settingsPanel').classList.contains('active')) {
      closeSettings();
      return;
    }
    if ($('tocPanel').classList.contains('active')) {
      closeToc();
      return;
    }

    // 如果有文字选中（用户正在选择），不触发翻页
    var sel = window.getSelection();
    if (sel && !sel.isCollapsed && sel.toString().trim()) return;

    // 如果工具栏正在显示，点任意位置关闭
    if (readerUIVisible) {
      toggleReaderUI();
      return;
    }

    var rect = content.getBoundingClientRect();
    var x = e.clientX - rect.left;
    var w = rect.width;

    // 左侧 30%：上一页
    if (x <= w * 0.3) {
      if (__pageMode === 'page') {
        if (!__pagesReady) return; // 分页尚未就绪，忽略点击
        if (currentPage > 0) { showPage(currentPage - 1); }
        else if (currentIdx > 0) { loadChapterAuto(currentIdx - 1, 999999); }
      } else {
        var target = content.scrollTop - content.clientHeight * 0.9;
        if (target < 0 && currentIdx > 0) { loadChapterAuto(currentIdx - 1, 999999); }
        else { content.scrollTo({ top: Math.max(0, target), behavior: 'smooth' }); }
      }
    }
    // 右侧 70%：下一页
    else {
      if (__pageMode === 'page') {
        if (!__pagesReady) return; // 分页尚未就绪，忽略点击
        if (currentPage < totalPages - 1) { showPage(currentPage + 1); }
        else if (currentIdx < chapters.length - 1) { loadChapterAuto(currentIdx + 1, 0); }
      } else {
        var maxScroll = content.scrollHeight - content.clientHeight;
        var target2 = content.scrollTop + content.clientHeight * 0.9;
        if (target2 >= maxScroll && currentIdx < chapters.length - 1) { loadChapterAuto(currentIdx + 1, 0); }
        else { content.scrollTo({ top: target2, behavior: 'smooth' }); }
      }
    }
  });

  // --- 滑动手势：page模式左右翻页+上下唤醒工具栏，scroll模式左右唤醒工具栏 ---
  function startAutoHide() {
    clearTimeout(autoHideTimer);
    autoHideTimer = setTimeout(function() {
      if (readerUIVisible) toggleReaderUI();
    }, 6000);
  }

  var _swX = 0, _swY = 0, _swTime = 0;

  document.addEventListener('touchstart', function(e) {
    _swX = e.touches[0].clientX;
    _swY = e.touches[0].clientY;
    _swTime = Date.now();
  }, { capture: true, passive: true });

  // page 模式下阻止默认滚动
  content.addEventListener('touchmove', function(e) {
    if (__pageMode === 'page') e.preventDefault();
  }, { passive: false });

  document.addEventListener('touchend', function(e) {
    // 只在阅读器打开时生效
    if (!$('readerOverlay').classList.contains('active')) return;
    // 不拦截工具栏/面板内的触摸
    var t = e.target;
    if (t.closest && (t.closest('.reader-topbar') || t.closest('.reader-bottombar') || t.closest('.toc-panel') || t.closest('.hl-menu') || t.closest('.note-popup'))) return;
    var dt = Date.now() - _swTime;
    if (dt > 600) return;
    var touch = e.changedTouches[0];
    var dx = touch.clientX - _swX;
    var dy = touch.clientY - _swY;
    var absDx = Math.abs(dx);
    var absDy = Math.abs(dy);

    if (__pageMode === 'page') {
      // page 模式：左右滑翻页，上下滑唤醒工具栏
      if (absDx > 50 && absDx > absDy) {
        // 横向滑动 → 翻页（带淡入淡出动画）
        if (__turning || !__pagesReady) return;
        __turning = true;
        setTimeout(function() { __turning = false; }, 400);
        var pageText = $('pageText');
        pageText.style.transition = 'opacity 0.15s';
        pageText.style.opacity = '0';
        setTimeout(function() {
          if (dx < 0) {
            // 左滑 → 下一页
            if (currentPage < totalPages - 1) showPage(currentPage + 1);
            else if (currentIdx < chapters.length - 1) { currentPage = 0; loadChapterAuto(currentIdx + 1, 0); }
          } else {
            // 右滑 → 上一页
            if (currentPage > 0) showPage(currentPage - 1);
            else if (currentIdx > 0) { loadChapterAuto(currentIdx - 1, 999999); }
          }
          pageText.style.opacity = '1';
          setTimeout(function() { pageText.style.transition = ''; }, 180);
        }, 150);
      } else if (absDy > 50 && absDy > absDx) {
        // 纵向滑动 → 唤醒/关闭工具栏
        toggleReaderUI();
        if (readerUIVisible) startAutoHide();
      }
    } else {
      // scroll 模式：左右滑动唤醒工具栏（保持原有行为）
      if (absDx > 60 && absDx > absDy * 2) {
        toggleReaderUI();
        if (readerUIVisible) startAutoHide();
      }
    }
  }, { capture: true, passive: true });

  // --- 滚动时更新进度 ---
  var scrollTimer = null;
  content.addEventListener('scroll', function() {
    updateProgress();
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(saveProgress, 300);
  });
}

// ============ UI 交互 ============
function switchTab(pageId, el) {
  document.querySelectorAll('.tab-page').forEach(function(p) { p.classList.remove('active'); });
  document.querySelectorAll('.tab-item').forEach(function(t) { t.classList.remove('active'); });
  $(pageId).classList.add('active');
  el.classList.add('active');
  // 切到批注页时渲染
  if (pageId === 'pageNotes') renderNotesTab();
}

function setFrame(on) {
  if (on) { delete document.documentElement.dataset.skin; }
  else { document.documentElement.dataset.skin = 'soft'; }
  localStorage.setItem('cr-skin', on ? 'hard' : 'soft');
}

function setAccent(c) {
  document.documentElement.style.setProperty('--accent', c);
  localStorage.setItem('cr-accent', c);
}

function setRadius(v) {
  document.documentElement.style.setProperty('--radius', v + 'px');
  $('radiusNum').textContent = v + 'px';
  localStorage.setItem('cr-radius', v);
}

function toggleView(id, cls, btn, iconOff, iconOn) {
  var el = $(id);
  el.classList.toggle(cls);
  var on = el.classList.contains(cls);
  btn.querySelector('.mi').textContent = on ? iconOn : iconOff;
  localStorage.setItem('cr-view-' + id, on ? cls : '');
}

function setTheme(el, name) {
  if (name) { document.documentElement.dataset.theme = name; }
  else { delete document.documentElement.dataset.theme; }
  el.parentNode.querySelectorAll('.palette-row').forEach(function(p) { p.classList.remove('active'); });
  el.classList.add('active');
  localStorage.setItem('cr-theme', name);
}

function openReader() {
  $('readerOverlay').classList.add('active');
  // 压入历史记录，让系统返回键能关闭阅读器
  history.pushState({ reader: true }, '');
}
function closeReader() {
  // 若当前是"批注跳转"的临时浏览，先还原原进度再保存
  if (__tempJump && __preJumpProgress) {
    try { localStorage.setItem('cr_progress_' + currentBookId, JSON.stringify(__preJumpProgress)); } catch(e) {}
    __tempJump = false; __preJumpProgress = null;
    $('readerOverlay').classList.remove('active');
    refreshLibrary();
    return;
  }
  saveProgress(); // 必须在隐藏 overlay 之前保存，否则 scrollTop 会被重置为 0
  $('readerOverlay').classList.remove('active');
  refreshLibrary();
}

// 批注跳转的进度保护
var __tempJump = false;
var __preJumpProgress = null;
document.addEventListener('visibilitychange', function() {
  if (document.hidden && __tempJump && __preJumpProgress && currentBookId) {
    try { localStorage.setItem('cr_progress_' + currentBookId, JSON.stringify(__preJumpProgress)); } catch(e) {}
  }
});

// 系统返回键监听
window.addEventListener('popstate', function(e) {
  if ($('readerOverlay').classList.contains('active')) {
    closeReader();
  }
});

var readerUIVisible = false;
function toggleReaderUI() {
  readerUIVisible = !readerUIVisible;
  $('readerTopbar').classList.toggle('visible', readerUIVisible);
  $('readerBottombar').classList.toggle('visible', readerUIVisible);
}

// ============ 章节目录面板 ============
function openToc() {
  var panel = $('tocPanel');
  if (!panel) return;
  var list = $('tocList');
  list.innerHTML = '';
  for (var i = 0; i < chapters.length; i++) {
    var item = document.createElement('div');
    item.className = 'toc-item' + (i === currentIdx ? ' active' : '');
    item.innerHTML = '<span class="ch-name">' + escHtml(chapters[i].title || 'Chapter ' + (i + 1)) + '</span><span class="ch-idx">' + (i + 1) + '</span>';
    item.setAttribute('data-idx', i);
    item.onclick = function() {
      var idx = parseInt(this.getAttribute('data-idx'));
      closeToc();
      loadChapterAuto(idx, 0);
    };
    list.appendChild(item);
  }
  panel.classList.add('active');
  // 目录出现时保持顶栏+底栏可见，取消自动隐藏
  clearTimeout(autoHideTimer);
  readerUIVisible = true;
  $('readerTopbar').classList.add('visible');
  $('readerBottombar').classList.add('visible');
  setTimeout(function() {
    var activeItem = list.querySelector('.toc-item.active');
    if (activeItem) activeItem.scrollIntoView({ block: 'center' });
  }, 300);
}

function closeToc() {
  $('tocPanel').classList.remove('active');
}

// 切换目录开关（底栏图标用）
function toggleToc() {
  var panel = $('tocPanel');
  if (panel.classList.contains('active')) {
    closeToc();
  } else {
    openToc();
  }
}

// ============ 全文搜索 ============
window.toggleSearch = function() {
  var panel = $('searchPanel');
  if (!panel) return;
  if (panel.classList.contains('active')) { closeSearch(); return; }
  closeToc(); closeSettings(); closeBookmarks();
  panel.classList.add('active');
  // 打开搜索时保持顶栏+底栏可见，取消自动隐藏
  clearTimeout(autoHideTimer);
  readerUIVisible = true;
  $('readerTopbar').classList.add('visible');
  $('readerBottombar').classList.add('visible');
  setTimeout(function() { var inp = $('searchInput'); if (inp) inp.focus(); }, 250);
};

window.closeSearch = function() {
  $('searchPanel').classList.remove('active');
};

// 执行搜索：遍历全书章节，收集命中位置与上下文（EPUB 异步读 zip，带缓存）
window.__chapterTextCache = {}; // bookId -> [章节纯文本]

function getChapterTexts(done) {
  var cacheKey = String(currentBookId);
  var cached = window.__chapterTextCache[cacheKey];
  if (cached && cached.length === chapters.length) { done(cached); return; }

  // TXT/MD：同步拼行即可
  var isTxt = chapters.length > 0 && chapters[0].__lines;
  if (isTxt) {
    var texts = chapters.map(function(c) { return (c.__lines || []).join('\n'); });
    window.__chapterTextCache[cacheKey] = texts;
    done(texts);
    return;
  }

  // EPUB：逐章从 zip 读 HTML 提取纯文本
  var texts = new Array(chapters.length).fill('');
  var pending = chapters.length;
  if (pending === 0) { done([]); return; }
  chapters.forEach(function(ch, i) {
    epubZip.file(ch.fullPath).async('text').then(function(raw) {
      var d = document.createElement('div');
      d.innerHTML = raw;
      // 去掉 script/style 再取纯文本
      var junk = d.querySelectorAll('script,style');
      for (var j = 0; j < junk.length; j++) junk[j].remove();
      texts[i] = (d.textContent || '').replace(/\s+/g, ' ');
    }).catch(function() {}).then(function() {
      pending--;
      if (pending === 0) {
        window.__chapterTextCache[cacheKey] = texts;
        done(texts);
      }
    });
  });
}

// 执行搜索：遍历全书章节文本，收集命中位置与上下文
window.doSearch = function() {
  var kw = ($('searchInput').value || '').trim();
  var wrap = $('searchResults');
  if (!kw) { wrap.innerHTML = '<div style="text-align:center;color:var(--ink-3);font-size:12px;padding:30px 20px;">请输入关键词</div>'; return; }
  if (!chapters || !chapters.length) { wrap.innerHTML = '<div style="text-align:center;color:var(--ink-3);font-size:12px;padding:30px;">书籍未加载</div>'; return; }

  wrap.innerHTML = '<div style="text-align:center;color:var(--ink-3);font-size:12px;padding:30px;">搜索中...</div>';

  getChapterTexts(function(textArr) {
    var results = [];
    var kwLower = kw.toLowerCase();
    for (var i = 0; i < textArr.length && results.length < 100; i++) {
      var chText = textArr[i];
      if (!chText) continue;

      var lower = chText.toLowerCase();
      var pos = -1;
      while ((pos = lower.indexOf(kwLower, pos + 1)) !== -1) {
        if (results.length >= 100) break;
        var start = Math.max(0, pos - 25);
        var end = Math.min(chText.length, pos + kw.length + 35);
        var ctx = (start > 0 ? '…' : '') + chText.substring(start, end) + (end < chText.length ? '…' : '');
        var esc = function(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); };
        // 高亮命中词
        var idx = ctx.toLowerCase().indexOf(kwLower);
        if (idx >= 0) {
          ctx = esc(ctx.substring(0, idx)) + '<b style="color:var(--accent)">' + esc(ctx.substring(idx, idx + kw.length)) + '</b>' + esc(ctx.substring(idx + kw.length));
        } else ctx = esc(ctx);
        results.push({ chIdx: i, title: chapters[i].title || ('Ch.' + (i + 1)), ctx: ctx });
      }
    }

    if (results.length === 0) {
      wrap.innerHTML = '<div style="text-align:center;color:var(--ink-3);font-size:13px;padding:30px;">未找到「' + kw.replace(/</g,'&lt;') + '」</div>';
      return;
    }
    wrap.innerHTML = '<div style="padding:8px 14px;font-size:11px;color:var(--ink-3);">共 ' + results.length + ' 处匹配' + (results.length >= 100 ? '（已截断）' : '') + '</div>';
    results.forEach(function(r) {
      var item = document.createElement('div');
      item.style.cssText = 'padding:10px 14px;border-bottom:1px solid var(--rule,rgba(0,0,0,0.06));cursor:pointer;font-family:var(--reader-font, var(--font-read));';
      item.innerHTML = '<div style="font-size:11px;color:var(--ink-3);margin-bottom:3px;">' + r.title.replace(/</g,'&lt;') + '</div>' +
        '<div style="font-size:13px;line-height:1.5;color:var(--ink-2);">' + r.ctx + '</div>';
      item.onclick = function() {
        closeSearch();
        loadChapterAuto(r.chIdx, 0);
        // 延迟定位到具体命中位置（在渲染后的正文里搜索关键词）
        setTimeout(function() { locateSearchHit(kw); }, 600);
      };
      wrap.appendChild(item);
    });
  });
};

// 回车触发搜索
document.addEventListener('keydown', function(e) {
  if (e.key === 'Enter' && document.activeElement === $('searchInput')) doSearch();
});

// ============ 阅读设置面板 ============
function openSettings() {
  closeToc();
  var panel = $('settingsPanel');
  panel.classList.add('active');
  clearTimeout(autoHideTimer);
  readerUIVisible = true;
  $('readerTopbar').classList.add('visible');
  $('readerBottombar').classList.add('visible');
  syncSettingsUI();
}

function closeSettings() {
  $('settingsPanel').classList.remove('active');
}

function toggleSettings() {
  var panel = $('settingsPanel');
  if (panel.classList.contains('active')) closeSettings();
  else openSettings();
}

// 同步面板 UI 到当前设置
function syncSettingsUI() {
  var fs = localStorage.getItem('cr-reader-fs') || '18';
  $('sliderFs').value = fs;
  $('rsetFontSize').textContent = fs + 'px';

  var lh = localStorage.getItem('cr-reader-lh') || '2.0';
  $('sliderLh').value = lh;
  $('rsetLineHeight').textContent = lh;

  var ps = localStorage.getItem('cr-reader-pspace') || '1.5';
  $('sliderPSpace').value = ps;
  $('rsetPSpace').textContent = ps + 'em';

  var mx = localStorage.getItem('cr-reader-mx') || '24';
  $('sliderMx').value = mx;
  $('rsetMargin').textContent = mx + 'px';

  var font = localStorage.getItem('cr-reader-font') || 'serif';
  var fontBtns = document.querySelectorAll('#rsetFont .rset-pill');
  fontBtns.forEach(function(b) {
    b.classList.toggle('active', b.getAttribute('data-font') === font);
  });

  var theme = localStorage.getItem('cr-theme') || '';
  var themeBtns = document.querySelectorAll('#rsetThemes .rset-theme');
  themeBtns.forEach(function(b) {
    b.classList.toggle('active', b.getAttribute('data-theme') === theme);
  });

  var hlStyle = localStorage.getItem('cr-hl-style') || '';
  var hlBtns = document.querySelectorAll('#rsetHlStyle .rset-pill');
  hlBtns.forEach(function(b) {
    b.classList.toggle('active', b.getAttribute('data-hl') === hlStyle);
  });
}

function setFontSize(fs) {
  document.documentElement.style.setProperty('--reader-fs', fs + 'px');
  localStorage.setItem('cr-reader-fs', String(fs));
  $('rsetFontSize').textContent = fs + 'px';
}

function setLineHeight(lh) {
  document.documentElement.style.setProperty('--reader-lh', lh);
  localStorage.setItem('cr-reader-lh', lh);
  $('rsetLineHeight').textContent = lh;
}

function setPSpace(ps) {
  document.documentElement.style.setProperty('--reader-pspace', ps + 'em');
  localStorage.setItem('cr-reader-pspace', ps);
  $('rsetPSpace').textContent = ps + 'em';
}

function setMargin(mx) {
  document.documentElement.style.setProperty('--reader-mx', mx + 'px');
  localStorage.setItem('cr-reader-mx', mx);
  $('rsetMargin').textContent = mx + 'px';
}

function setFont(font, btn) {
  var fontFamily = font === 'sans'
    ? "system-ui, -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif"
    : "'Noto Serif SC', 'Source Han Serif CN', Georgia, serif";
  document.documentElement.style.setProperty('--reader-font', fontFamily);
  localStorage.setItem('cr-reader-font', font);
  var btns = btn.parentNode.querySelectorAll('.rset-pill');
  btns.forEach(function(b) { b.classList.remove('active'); });
  btn.classList.add('active');
}

function setReaderTheme(theme, btn) {
  if (theme) { document.documentElement.dataset.theme = theme; }
  else { delete document.documentElement.dataset.theme; }
  localStorage.setItem('cr-theme', theme);
  var btns = btn.parentNode.querySelectorAll('.rset-theme');
  btns.forEach(function(b) { b.classList.remove('active'); });
  btn.classList.add('active');
}

// 划线样式设置
function setHlStyle(style, btn) {
  localStorage.setItem('cr-hl-style', style);
  var btns = btn.parentNode.querySelectorAll('.rset-pill');
  btns.forEach(function(b) { b.classList.remove('active'); });
  btn.classList.add('active');
  // 更新当前章已有划线的样式
  var marks = document.querySelectorAll('.cr-highlight');
  marks.forEach(function(m) {
    m.className = 'cr-highlight' + (style ? ' ' + style : '');
  });
  saveHighlights();
}

function getHlStyle() {
  return localStorage.getItem('cr-hl-style') || '';
}

// ============ 设置持久化恢复 ============
function restoreSettings() {
  var theme = localStorage.getItem('cr-theme');
  if (theme) { document.documentElement.dataset.theme = theme; }

  var skin = localStorage.getItem('cr-skin');
  if (skin === 'soft') {
    document.documentElement.dataset.skin = 'soft';
    var swFrame = $('swFrame');
    if (swFrame) swFrame.checked = false;
  }

  var accent = localStorage.getItem('cr-accent');
  if (accent) {
    document.documentElement.style.setProperty('--accent', accent);
    var picker = document.querySelector('.colorpick');
    if (picker) picker.value = accent;
  }

  var radius = localStorage.getItem('cr-radius');
  if (radius) {
    document.documentElement.style.setProperty('--radius', radius + 'px');
    var slider = $('swRadius');
    if (slider) slider.value = radius;
    var num = $('radiusNum');
    if (num) num.textContent = radius + 'px';
  }

  // 恢复书架/批注的视图切换状态
  restoreView('bookGrid', 'list', 'view_list', 'grid_view');
  restoreView('noteWrap', 'grid', 'grid_view', 'view_agenda');

  // 恢复阅读排版设置
  var rfs = localStorage.getItem('cr-reader-fs');
  if (rfs) document.documentElement.style.setProperty('--reader-fs', rfs + 'px');
  var rlh = localStorage.getItem('cr-reader-lh');
  if (rlh) document.documentElement.style.setProperty('--reader-lh', rlh);
  var rps = localStorage.getItem('cr-reader-pspace');
  if (rps) document.documentElement.style.setProperty('--reader-pspace', rps + 'em');
  var rmx = localStorage.getItem('cr-reader-mx');
  if (rmx) document.documentElement.style.setProperty('--reader-mx', rmx + 'px');
  var rfont = localStorage.getItem('cr-reader-font');
  if (rfont === 'sans') {
    document.documentElement.style.setProperty('--reader-font', "system-ui, -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif");
  }
}

function restoreView(id, cls, iconOff, iconOn) {
  var saved = localStorage.getItem('cr-view-' + id);
  var el = $(id);
  if (!el) return;
  // 找到对应的切换按钮（通过 onclick 里的 id 匹配）
  var btns = document.querySelectorAll('.shelf-actions .icon-btn');
  var btn = null;
  for (var i = 0; i < btns.length; i++) {
    var oc = btns[i].getAttribute('onclick') || '';
    if (oc.indexOf("'" + id + "'") !== -1) { btn = btns[i]; break; }
  }
  if (saved === cls) {
    el.classList.add(cls);
    if (btn) btn.querySelector('.mi').textContent = iconOn;
  } else {
    el.classList.remove(cls);
    if (btn) btn.querySelector('.mi').textContent = iconOff;
  }
}

// ============ 初始化 ============
function init() {
  // 读取 CoRead 配置文件
  try {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', 'file:///sdcard/Download/Operit/CoRead2/_coread_config.json', false);
    xhr.send();
    if (xhr.status === 200) {
      var cfg = JSON.parse(xhr.responseText);
      coreadConfig.cardName = cfg.cardName || '';
      coreadConfig.aiDotColor = cfg.aiDotColor || '#D97757';
      // 设置 CSS 变量，让圆点颜色可自定义
      document.documentElement.style.setProperty('--ai-dot', coreadConfig.aiDotColor);
    }
  } catch(e) {}

  restoreSettings();

  // 文件选择器 onchange（导入按钮通过 label[for] 原生触发）
  $('fileInput').onchange = function(e) {
    if (e.target.files && e.target.files[0]) {
      var file = e.target.files[0];
      var ext = (file.name.split('.').pop() || '').toLowerCase();
      if (ext === 'epub') importEpub(file);
      else if (ext === 'txt' || ext === 'md') importText(file, ext === 'md');
      else showToast('不支持的格式: .' + ext);
      e.target.value = '';
    }
  };

  // 初始化点击翻页
  initPageTap();

  // 初始化 DB 并刷新书架
  initDB().then(function() {
    refreshLibrary();
  });
}

// 暴露全局函数（HTML onclick 需要）
window.switchTab = switchTab;
window.setFrame = setFrame;
window.setAccent = setAccent;
window.setRadius = setRadius;
window.toggleView = toggleView;
window.setTheme = setTheme;
window.openReader = openReader;
window.closeReader = closeReader;
window.toggleReaderUI = toggleReaderUI;
window.importText = importText;
window.openToc = openToc;
window.closeToc = closeToc;
window.toggleToc = toggleToc;
window.openSettings = openSettings;
window.closeSettings = closeSettings;
window.toggleSettings = toggleSettings;
window.setFontSize = setFontSize;
window.setLineHeight = setLineHeight;
window.setPSpace = setPSpace;
window.setMargin = setMargin;
window.setFont = setFont;
window.setHlStyle = setHlStyle;
window.setReaderTheme = setReaderTheme;

// DOM Ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

// 兜底进度保存：页面隐藏/关闭/切换时自动存
document.addEventListener('visibilitychange', function() {
  if (document.hidden) saveProgress();
});
window.addEventListener('pagehide', function() { saveProgress(); });
window.addEventListener('beforeunload', function() { saveProgress(); });

// 禁用系统长按菜单（复制/分享/全选/搜索）——但放行分享卡片预览图，让用户能长按保存
document.addEventListener('contextmenu', function(e) {
  if (e.target && e.target.tagName === 'IMG' && e.target.closest && e.target.closest('#sharePreviewOverlay')) return true;
  e.preventDefault();
  return false;
});
// 禁止系统选择动作栏
document.addEventListener('selectionchange', function() {
  // 已在上面的 selectionchange 里处理了
});

// ============ 划线批注系统 ============
var hlMenu = $('hlMenu');
var pendingRange = null;

// 检测选中文字 → 弹出浮动菜单
document.addEventListener('selectionchange', function() {
  var sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.toString().trim()) {
    // 如果样式行正在显示（划线后选样式阶段），不关闭菜单
    if (lastHighlightMark && !$('hlStyleRow').classList.contains('hidden')) return;
    hlMenu.classList.remove('active');
    pendingRange = null;
    return;
  }
  // 只在阅读器内生效
  var pageText = $('pageText');
  if (!pageText || !pageText.contains(sel.anchorNode)) return;

  pendingRange = sel.getRangeAt(0).cloneRange();
  // 重置菜单回操作行状态
  $('hlActionsRow').style.display = '';
  $('hlStyleRow').classList.add('hidden');
  lastHighlightMark = null;

  var rect = pendingRange.getBoundingClientRect();
  var menuW = 200; // 预估菜单宽度
  var leftPos = Math.max(8, Math.min(rect.left + rect.width / 2 - menuW / 2, window.innerWidth - menuW - 8));
  // 默认出现在选区下方
  var topPos = rect.bottom + 8;
  // 如果下方空间不够（距底部 < 120px），则放到上方
  if (topPos + 60 > window.innerHeight) {
    topPos = rect.top - 60;
  }
  hlMenu.style.left = leftPos + 'px';
  hlMenu.style.top = topPos + 'px';
  hlMenu.classList.add('active');
});

// 划线（纯划线，然后显示样式快选行）
var lastHighlightMark = null; // 记住最后划线的 mark，方便即时改样式

function doHighlight(isAI) {
  if (!pendingRange) return;
  var text = pendingRange.toString().trim();
  if (!text) return;

  var style = getHlStyle();
  var color = localStorage.getItem('cr-hl-color') || '';
  var mark = document.createElement('mark');
  mark.className = 'cr-highlight' + (style ? ' ' + style : '');
  if (color && color !== 'var(--accent)') {
    mark.setAttribute('data-color', color);
    applyColorToMark(mark, style);
  }
  
  // AI 划线标记
  if (isAI) {
    mark.setAttribute('data-source', 'ai');
    mark.classList.add('cr-ai-highlight');
  }
  
  try {
    pendingRange.surroundContents(mark);
  } catch (e) {
    var frag = pendingRange.extractContents();
    mark.appendChild(frag);
    pendingRange.insertNode(mark);
  }

  window.getSelection().removeAllRanges();
  saveHighlights();
  showToast(isAI ? 'AI 已划线' : '已划线');

  // 切换菜单：隐藏操作行，显示样式行
  lastHighlightMark = mark;
  $('hlActionsRow').style.display = 'none';
  $('hlStyleRow').classList.remove('hidden');
  // 同步样式行的 active 状态
  syncStyleRow();
}

// 复制
function doCopy() {
  if (!pendingRange) return;
  var text = pendingRange.toString().trim();
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text);
  } else {
    // fallback
    var ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  window.getSelection().removeAllRanges();
  hlMenu.classList.remove('active');
  showToast('已复制');
}

// 保存所有高亮（合并相邻同样式 mark，存文本 + 样式 + 颜色 + 章节索引 + 来源）
function saveHighlights() {
  if (!currentBookId) return;
  var marks = $('pageText').querySelectorAll('.cr-highlight');
  var items = [];
  
  for (var i = 0; i < marks.length; i++) {
    var cls = marks[i].className.replace('cr-highlight', '').replace('cr-ai-highlight', '').trim();
    var color = marks[i].getAttribute('data-color') || '';
    var source = marks[i].getAttribute('data-source') || 'user';
    var text = marks[i].textContent;
    
    // 合并相邻且样式+颜色+来源相同的 mark（处理跨标签划线被拆分的情况）
    var prev = items.length > 0 ? items[items.length - 1] : null;
    if (prev && prev.style === cls && prev.color === color && prev.source === source) {
      // 检查 DOM 中是否相邻（前一个 mark 的下一个兄弟是当前 mark，或者中间只有空白文本节点）
      var prevMark = marks[i - 1];
      var isAdjacent = false;
      if (prevMark) {
        var node = prevMark.nextSibling;
        while (node && node !== marks[i]) {
          if (node.nodeType === 3 && node.textContent.trim() === '') {
            node = node.nextSibling;
            continue;
          }
          break;
        }
        isAdjacent = (node === marks[i]);
      }
      if (isAdjacent) {
        prev.text += text;
        continue;
      }
    }
    
    items.push({ text: text, style: cls, color: color, source: source });
  }
  
  var key = 'cr_hl_' + currentBookId + '_' + currentIdx;
  localStorage.setItem(key, JSON.stringify(items));

  // 全书批注汇总
  var allKey = 'cr_hl_all_' + currentBookId;
  var all = JSON.parse(localStorage.getItem(allKey) || '{}');
  all[currentIdx] = items.map(function(item) {
    return { text: item.text, style: item.style, color: item.color, source: item.source, chapter: currentIdx, chapterTitle: chapters[currentIdx] ? chapters[currentIdx].title : '', time: Date.now() };
  });
  localStorage.setItem(allKey, JSON.stringify(all));
}

// 恢复当前章节的高亮（TreeWalker + Range 方案，避免正则破坏 DOM）
function restoreHighlights() {
  if (!currentBookId) return;
  var key = 'cr_hl_' + currentBookId + '_' + currentIdx;
  var raw = localStorage.getItem(key);
  if (!raw) return;
  var items = JSON.parse(raw);
  if (!items || !items.length) return;

  // 读取 AI 批注（从文件系统）
  var aiNotes = {};
  try {
    var annotFile = '/sdcard/Download/Operit/CoRead2/_coread_notes_' + currentBookId + '.json';
    var xhr = new XMLHttpRequest();
    xhr.open('GET', 'file://' + annotFile, false); // 同步请求
    xhr.send();
    if (xhr.status === 200 || xhr.status === 0) {
      var allNotes = JSON.parse(xhr.responseText || '{}');
      // allNotes 的格式可能是：
      // 1. 旧格式：{ "chapterIdx:textPrefix": "annotation", ... }
      // 2. 新格式：{ "chapterIdx:textPrefix": { text: "annotation", color: "#xxx" }, ... }
      for (var key in allNotes) {
        var noteData = allNotes[key];
        if (typeof noteData === 'string') {
          // 兼容旧格式
          aiNotes[key] = { text: noteData, color: null };
        } else if (noteData && typeof noteData === 'object') {
          // 新格式
          aiNotes[key] = { text: noteData.text || '', color: noteData.color || null };
        }
      }
    }
  } catch(e) {
    console.log('读取 AI 批注失败:', e);
  }

  // 缓存到全局供批注弹窗和书签面板使用
  window.__currentAINotes = aiNotes;

  var pageText = $('pageText');

  items.forEach(function(item) {
    var text = typeof item === 'string' ? item : item.text;
    var style = typeof item === 'string' ? '' : (item.style || '');
    var source = typeof item === 'object' ? (item.source || 'user') : 'user';
    if (!text) return;

    // 用 TreeWalker 收集所有文本节点
    var walker = document.createTreeWalker(pageText, NodeFilter.SHOW_TEXT, null, false);
    var textNodes = [];
    var node;
    while ((node = walker.nextNode())) {
      // 跳过已经在 mark 内部的文本节点（避免重复高亮）
      if (node.parentNode && node.parentNode.classList && node.parentNode.classList.contains('cr-highlight')) continue;
      textNodes.push(node);
    }

    // 拼接全文本，找到目标子串的位置
    var fullText = '';
    var nodeMap = []; // { node, startOffset (in fullText), length }
    for (var i = 0; i < textNodes.length; i++) {
      var content = textNodes[i].nodeValue;
      nodeMap.push({ node: textNodes[i], start: fullText.length, length: content.length });
      fullText += content;
    }

    var matchIdx = fullText.indexOf(text);
    if (matchIdx === -1) return; // 找不到就跳过这条

    var matchEnd = matchIdx + text.length;

    // 定位起始节点和偏移
    var startNode = null, startOffset = 0;
    var endNode = null, endOffset = 0;
    for (var j = 0; j < nodeMap.length; j++) {
      var nm = nodeMap[j];
      if (!startNode && nm.start + nm.length > matchIdx) {
        startNode = nm.node;
        startOffset = matchIdx - nm.start;
      }
      if (nm.start + nm.length >= matchEnd) {
        endNode = nm.node;
        endOffset = matchEnd - nm.start;
        break;
      }
    }

    if (!startNode || !endNode) return;

    // 创建 Range
    var range = document.createRange();
    try {
      range.setStart(startNode, startOffset);
      range.setEnd(endNode, endOffset);
    } catch (e) {
      return; // 偏移越界则跳过
    }

    // 用 mark 包裹
    var cls = 'cr-highlight' + (style ? ' ' + style : '');
    var itemColor = (typeof item === 'object') ? (item.color || '') : '';
    var mark = document.createElement('mark');
    mark.className = cls;
    if (itemColor) {
      mark.setAttribute('data-color', itemColor);
      applyColorToMark(mark, style);
    }
    
    // 标记来源（AI 或用户）- 不再添加特殊样式，只用圆点区分
    // if (source === 'ai') {
    //   mark.setAttribute('data-source', 'ai');
    //   mark.classList.add('cr-ai-highlight');
    // }

    // 检查是否有 AI 批注 → 加 has-ai-note 类
    var aiKey = currentIdx + ':' + text.substring(0, 50);
    if (aiNotes[aiKey]) {
      mark.classList.add('has-ai-note');
      // 兼容旧格式：对象 {text, color} 和新格式：字符串
      var aiNoteText = (typeof aiNotes[aiKey] === 'object' && aiNotes[aiKey].text) 
        ? aiNotes[aiKey].text 
        : aiNotes[aiKey];
      mark.setAttribute('data-ai-note', aiNoteText);
    }

    // 检查是否有用户批注 → 加 has-note 类
    var notes = JSON.parse(localStorage.getItem('cr_notes_' + currentBookId) || '{}');
    var noteKey = currentIdx + ':' + text.substring(0, 50);
    if (notes[noteKey]) {
      mark.classList.add('has-note');
    }

    try {
      range.surroundContents(mark);
    } catch (e) {
      // 跨标签时 surroundContents 会抛错，用 extractContents 兜底
      try {
        var frag = range.extractContents();
        mark.appendChild(frag);
        range.insertNode(mark);
      } catch (e2) {
        // 实在不行就放弃这条高亮
        return;
      }
    }
  });
}

// 显示 AI 批注弹窗
function showAIAnnotationPopup(text, annotation) {
  var popup = $('notePopup');
  if (!popup) return;
  $('notePopupQuote').textContent = text;
  var input = $('notePopupInput');
  // 读取用户批注
  var notes = JSON.parse(localStorage.getItem('cr_notes_' + currentBookId) || '{}');
  var noteKey = currentIdx + ':' + text.substring(0, 50);
  input.value = notes[noteKey] || '';
  // 显示 AI 批注区域
  var aiArea = $('aiAnnotationArea');
  if (!aiArea) {
    // 动态创建 AI 批注显示区域
    aiArea = document.createElement('div');
    aiArea.id = 'aiAnnotationArea';
    aiArea.className = 'ai-annotation-area';
    input.parentNode.insertBefore(aiArea, input);
  }
  aiArea.innerHTML = '<div class="ai-annotation-header"><span class="mi" style="font-size:14px;vertical-align:middle">smart_toy</span> AI 批注</div>' +
    '<div class="ai-annotation-content">' + annotation.replace(/</g, '&lt;').replace(/\n/g, '<br>') + '</div>';
  aiArea.style.display = 'block';
  popup.classList.add('active');
}

// 划线并直接打开批注（"写想法"按钮）
function doHighlightAndNote() {
  if (!pendingRange) return;
  var text = pendingRange.toString().trim();
  if (!text) return;

  // 先执行划线
  doHighlight();

  // 再弹出批注面板
  activeNoteText = text;
  $('notePopupQuote').textContent = text;
  $('notePopupInput').value = '';
  $('notePopup').classList.add('active');
  // 自动聚焦输入框
  setTimeout(function() { $('notePopupInput').focus(); }, 300);
}

// 快捷选择划线样式（即时更新最后一条划线）
function pickHlStyle(style, btn) {
  localStorage.setItem('cr-hl-style', style);
  var row = $('hlStyleRow');
  row.querySelectorAll('.hl-style-btn').forEach(function(b) { b.classList.remove('active'); });
  btn.classList.add('active');
  // 即时更新最后划的线
  if (lastHighlightMark) {
    lastHighlightMark.className = 'cr-highlight' + (style ? ' ' + style : '');
    applyColorToMark(lastHighlightMark, style);
    saveHighlights();
  }
}

// 快捷选择划线颜色（即时更新）
function pickHlColor(color, btn) {
  localStorage.setItem('cr-hl-color', color);
  var row = $('hlStyleRow');
  row.querySelectorAll('.hl-color-dot').forEach(function(b) { b.classList.remove('active'); });
  btn.classList.add('active');
  // 即时更新
  if (lastHighlightMark) {
    if (color && color !== 'var(--accent)') {
      lastHighlightMark.setAttribute('data-color', color);
    } else {
      lastHighlightMark.removeAttribute('data-color');
    }
    applyColorToMark(lastHighlightMark, getHlStyle());
    saveHighlights();
  }
}

// 给 mark 应用颜色（优先从 data-color 读取，否则从 localStorage）
function applyColorToMark(mark, style) {
  var color = mark.getAttribute('data-color') || localStorage.getItem('cr-hl-color') || '';
  // 先清除所有 inline style
  mark.style.textDecorationColor = '';
  mark.style.background = '';
  if (color && color !== 'var(--accent)') {
    // 对线型样式设置线颜色
    if (style === 'hl-line' || style === 'hl-wave' || style === 'hl-dash') {
      mark.style.textDecorationColor = color;
    }
    // 对默认样式（纯背景）和 hl-bg 设置背景色
    if (!style || style === '' || style === 'hl-bg') {
      mark.style.background = hexToRgba(color, 0.25);
    }
  }
}

// hex 转 rgba
function hexToRgba(hex, alpha) {
  hex = hex.replace('#', '');
  if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
  var r = parseInt(hex.substring(0,2), 16);
  var g = parseInt(hex.substring(2,4), 16);
  var b = parseInt(hex.substring(4,6), 16);
  return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
}

// 同步样式行的 active 状态到当前设置
function syncStyleRow() {
  var style = getHlStyle();
  var color = localStorage.getItem('cr-hl-color') || 'var(--accent)';
  $('hlStyleRow').querySelectorAll('.hl-style-btn').forEach(function(b) {
    b.classList.toggle('active', b.getAttribute('data-hl') === style);
  });
  $('hlStyleRow').querySelectorAll('.hl-color-dot').forEach(function(b) {
    b.classList.toggle('active', b.getAttribute('data-color') === color);
  });
}

window.doHighlight = doHighlight;
window.doCopy = doCopy;
window.doHighlightAndNote = doHighlightAndNote;
window.pickHlStyle = pickHlStyle;
window.pickHlColor = pickHlColor;

// ============ 批注弹窗 ============
var activeNoteText = '';

// 点击已有高亮 → 弹出批注框（在 pageText 上捕获，阻止冒泡到翻页逻辑）
$('pageText').addEventListener('click', function(e) {
  var mark = e.target.closest('.cr-highlight');
  if (!mark) return;
  e.stopPropagation(); // 阻止冒泡到 readerContent 的翻页 click
  if (!$('readerOverlay').classList.contains('active')) return;
  activeNoteText = mark.textContent;
  $('notePopupQuote').textContent = activeNoteText;
  // 读取已有批注
  var notes = JSON.parse(localStorage.getItem('cr_notes_' + currentBookId) || '{}');
  var noteKey = currentIdx + ':' + activeNoteText.substring(0, 50);
  $('notePopupInput').value = notes[noteKey] || '';

  // 显示 AI 批注（如果有）
  var aiArea = $('aiAnnotationArea');
  var aiNote = mark.getAttribute('data-ai-note') || '';
  if (!aiNote && window.__currentAINotes) {
    aiNote = window.__currentAINotes[noteKey] || '';
  }
  if (aiNote) {
    if (!aiArea) {
      aiArea = document.createElement('div');
      aiArea.id = 'aiAnnotationArea';
      aiArea.className = 'ai-annotation-area';
      $('notePopupInput').parentNode.insertBefore(aiArea, $('notePopupInput'));
    }
    var aiTitle = coreadConfig.cardName || 'AI';
    aiArea.innerHTML = '<div class="ai-annotation-header"><span class="mi" style="font-size:14px;vertical-align:middle">smart_toy</span> ' + aiTitle + ' 批注</div>' +
      '<div class="ai-annotation-content">' + aiNote.replace(/</g, '&lt;').replace(/\n/g, '<br>') + '</div>';
    aiArea.style.display = 'block';
  } else if (aiArea) {
    aiArea.style.display = 'none';
  }

  $('notePopup').classList.add('active');
});

function saveNote() {
  var noteText = $('notePopupInput').value.trim();
  var notes = JSON.parse(localStorage.getItem('cr_notes_' + currentBookId) || '{}');
  var noteKey = currentIdx + ':' + activeNoteText.substring(0, 50);
  if (noteText) {
    notes[noteKey] = noteText;
  } else {
    delete notes[noteKey];
  }
  localStorage.setItem('cr_notes_' + currentBookId, JSON.stringify(notes));
  
  // 更新划线的 has-note 类
  var marks = $('pageText').querySelectorAll('.cr-highlight');
  for (var i = 0; i < marks.length; i++) {
    if (marks[i].textContent === activeNoteText) {
      if (noteText) {
        marks[i].classList.add('has-note');
      } else {
        marks[i].classList.remove('has-note');
      }
      break;
    }
  }
  
  $('notePopup').classList.remove('active');
  showToast(noteText ? '批注已保存' : '批注已清除');
}

function closeNote() {
  $('notePopup').classList.remove('active');
  // 隐藏 AI 批注区域
  var aiArea = $('aiAnnotationArea');
  if (aiArea) aiArea.style.display = 'none';
}

function deleteHighlightNote() {
  // 删除高亮 + 批注
  var marks = $('pageText').querySelectorAll('.cr-highlight');
  marks.forEach(function(m) {
    if (m.textContent === activeNoteText) {
      var parent = m.parentNode;
      while (m.firstChild) parent.insertBefore(m.firstChild, m);
      parent.removeChild(m);
    }
  });
  // 删除批注
  var notes = JSON.parse(localStorage.getItem('cr_notes_' + currentBookId) || '{}');
  var noteKey = currentIdx + ':' + activeNoteText.substring(0, 50);
  delete notes[noteKey];
  localStorage.setItem('cr_notes_' + currentBookId, JSON.stringify(notes));
  saveHighlights();
  $('notePopup').classList.remove('active');
  showToast('已删除划线');
}

window.saveNote = saveNote;
window.closeNote = closeNote;
window.deleteHighlightNote = deleteHighlightNote;

// ============ 批注 Tab 页渲染 ============
function renderNotesTab() {
  var wrap = $('noteWrap');
  if (!wrap) return;
  wrap.innerHTML = '';

  // 从 IndexedDB 获取书名映射
  var bookNames = {};
  if (db) {
    var tx = db.transaction(STORE_BOOKS, 'readonly');
    var store = tx.objectStore(STORE_BOOKS);
    var req = store.openCursor();
    req.onsuccess = function(e) {
      var cursor = e.target.result;
      if (cursor) {
        bookNames[String(cursor.value.id)] = cursor.value.title || '未知';
        cursor.continue();
      } else {
        // 所有书名读完，开始渲染
        doRenderNotes(wrap, bookNames);
      }
    };
    req.onerror = function() { doRenderNotes(wrap, bookNames); };
  } else {
    doRenderNotes(wrap, bookNames);
  }
}

function doRenderNotes(wrap, bookNames) {
  // 遍历所有书的高亮数据
  var allBooks = [];
  for (var i = 0; i < localStorage.length; i++) {
    var key = localStorage.key(i);
    if (key && key.indexOf('cr_hl_all_') === 0) {
      var bookId = key.replace('cr_hl_all_', '');
      var data = JSON.parse(localStorage.getItem(key) || '{}');
      allBooks.push({ bookId: bookId, data: data, title: bookNames[bookId] || '未知书籍' });
    }
  }

  if (allBooks.length === 0) {
    wrap.innerHTML = '<div class="notes-empty"><span class="mi">edit_note</span><p>还没有划线批注</p><p class="sub">在阅读时选中文字并划线即可添加</p></div>';
    return;
  }

  // 按书名筛选器
  if (allBooks.length > 1) {
    var filterDiv = document.createElement('div');
    filterDiv.className = 'notes-filter';
    filterDiv.innerHTML = '<button class="notes-filter-btn active" data-book="all">全部</button>';
    allBooks.forEach(function(book) {
      filterDiv.innerHTML += '<button class="notes-filter-btn" data-book="' + escHtml(book.bookId) + '">' + escHtml((book.title || '').substring(0, 8)) + '</button>';
    });
    wrap.appendChild(filterDiv);
    // 筛选点击
    filterDiv.addEventListener('click', function(e) {
      var btn = e.target.closest('.notes-filter-btn');
      if (!btn) return;
      filterDiv.querySelectorAll('.notes-filter-btn').forEach(function(b) { b.classList.remove('active'); });
      btn.classList.add('active');
      var filter = btn.getAttribute('data-book');
      wrap.querySelectorAll('.note-card').forEach(function(card) {
        if (filter === 'all') card.style.display = '';
        else card.style.display = card.getAttribute('data-book') === filter ? '' : 'none';
      });
    });
  }

  // 收集所有高亮+批注，按时间倒序
  var allItems = [];
  allBooks.forEach(function(book) {
    var notes = JSON.parse(localStorage.getItem('cr_notes_' + book.bookId) || '{}');
    var aiNotes = getAINotesForBook(book.bookId);
    Object.keys(book.data).forEach(function(chIdx) {
      var items = book.data[chIdx];
      if (!Array.isArray(items)) return;
      items.forEach(function(item) {
        var noteKey = chIdx + ':' + (item.text || '').substring(0, 50);
        var aiNote = aiNotes[noteKey];
        var aiText = aiNote ? (typeof aiNote === 'object' ? aiNote.text : aiNote) : '';
        allItems.push({
          text: item.text || '',
          style: item.style || '',
          color: item.color || '',
          chapter: item.chapterTitle || 'Ch.' + (parseInt(chIdx) + 1),
          note: notes[noteKey] || '',
          aiNote: aiText || '',
          time: item.time || 0,
          bookId: book.bookId,
          bookTitle: book.title,
          chIdx: parseInt(chIdx)
        });
      });
    });
  });

  allItems.sort(function(a, b) { return b.time - a.time; });

  if (allItems.length === 0) {
    wrap.innerHTML += '<div class="notes-empty"><span class="mi">edit_note</span><p>还没有划线批注</p><p class="sub">在阅读时选中文字并划线即可添加</p></div>';
    return;
  }

  allItems.forEach(function(item) {
    var card = document.createElement('div');
    card.className = 'note-card';
    card.setAttribute('data-book', item.bookId);
    card.setAttribute('data-idx', allItems.indexOf(item));

    var colorStyle = item.color ? ' style="border-left-color:' + item.color + '"' : '';

    var timeStr = '';
    if (item.time) {
      var d = new Date(item.time);
      timeStr = (d.getMonth() + 1) + '/' + d.getDate() + ' ' + d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0');
    }

    // 批注数量角标：用户批注 + AI 批注
    var badgeCount = (item.note ? 1 : 0) + (item.aiNote ? 1 : 0);
    var badgeHtml = badgeCount > 0
      ? '<span class="note-card-badge" title="批注数"><span class="mi" style="font-size:12px">chat_bubble</span>' + badgeCount + '</span>'
      : '';

    // 删除按钮（长按卡片触发确认）
    var delBtnHtml = '<button class="note-card-del" data-notekey="' +
      item.chIdx + ':' + (item.text || '').substring(0, 50).replace(/"/g, '"') +
      '" data-bookid="' + item.bookId + '" title="删除"><span class="mi">delete_outline</span></button>';

    // 外层精简：只显示原文引用 + 元信息，不直接展示批注内容
    card.innerHTML =
      '<div class="note-card-quote' + (item.style ? ' ' + item.style : '') + '"' + colorStyle + '>' + item.text.replace(/</g, '&lt;') + '</div>' +
      delBtnHtml +
      '<div class="note-card-meta"><span>' + item.chapter + '</span><span class="note-card-book">' + item.bookTitle + '</span><span>' + timeStr + '</span></div>' +
      badgeHtml;

    // 点击卡片 → 打开详情页（删除按钮除外）
    card.addEventListener('click', function(ev) {
      if (ev.target.closest('.note-card-del')) return;
      openNoteDetail(item);
    });

    // 点击删除按钮：删除该划线（含其批注），只移除该卡片，保持滚动位置
    var delBtn = card.querySelector('.note-card-del');
    if (delBtn) {
      delBtn.addEventListener('click', function(ev) {
        ev.stopPropagation();
        var noteKey = this.getAttribute('data-notekey');
        var bookId = this.getAttribute('data-bookid');
        if (!confirm('删除这条划线及其批注？')) return;
        var self = this;
        if (deleteNoteFromOverview(noteKey, bookId)) {
          // 删除成功：淡出移除当前卡片，不整页刷新
          var c = self.closest('.note-card');
          if (c) {
            c.style.transition = 'opacity 0.25s, transform 0.25s';
            c.style.opacity = '0';
            c.style.transform = 'translateX(20px)';
            setTimeout(function() { c.remove(); }, 250);
          }
          showToast('已删除');
          // 同步更新筛选标签（该书可能已无划线）
          updateNotesFilter(bookId);
        }
      });
    }

    wrap.appendChild(card);
  });
}

// 获取指定书的 AI 批注（当前书用缓存，其他书同步读文件）
function getAINotesForBook(bookId) {
  try {
    if (String(bookId) === String(currentBookId) && window.__currentAINotes && Object.keys(window.__currentAINotes).length > 0) {
      return window.__currentAINotes;
    }
    var annotFile = '/sdcard/Download/Operit/CoRead2/_coread_notes_' + bookId + '.json';
    var xhr = new XMLHttpRequest();
    xhr.open('GET', 'file://' + annotFile, false);
    xhr.send();
    if (xhr.status === 200) {
      var raw = JSON.parse(xhr.responseText);
      var normalized = {};
      for (var k in raw) {
        var v = raw[k];
        if (typeof v === 'string') normalized[k] = { text: v, color: null };
        else if (v && typeof v === 'object') normalized[k] = { text: v.text || '', color: v.color || null };
      }
      return normalized;
    }
  } catch(e) {}
  return {};
}

// ============ 批注详情页（方案A：点击卡片进入） ============
var __detailItem = null; // 当前详情页对应的条目

function openNoteDetail(item) {
  __detailItem = item;
  var overlay = $('noteDetailOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'noteDetailOverlay';
    overlay.className = 'note-detail-overlay';
    document.body.appendChild(overlay);
  }

  var aiTitle = coreadConfig.cardName || 'AI';
  var aiDotStyle = coreadConfig.aiDotColor ? 'background:' + coreadConfig.aiDotColor : '';

  var userNoteHtml = item.note
    ? '<div class="nd-section"><div class="nd-label"><span class="mi" style="font-size:14px">person</span> 我的批注</div><div class="nd-note nd-user-note">' + item.note.replace(/</g, '&lt;').replace(/\n/g, '<br>') + '</div></div>'
    : '';
  var aiNoteHtml = item.aiNote
    ? '<div class="nd-section"><div class="nd-label"><span class="ai-dot" style="' + aiDotStyle + '"></span> ' + aiTitle + ' 批注</div><div class="nd-note nd-ai-note">' + item.aiNote.replace(/</g, '&lt;').replace(/\n/g, '<br>') + '</div></div>'
    : '';
  var emptyHintHtml = (!item.note && !item.aiNote)
    ? '<div class="nd-empty">这条划线还没有批注<br><span class="sub">在阅读页点这条划线可以添加</span></div>'
    : '';

  overlay.innerHTML =
    '<div class="nd-sheet">' +
      '<div class="nd-header">' +
        '<button class="nd-back" id="ndBackBtn"><span class="mi">arrow_back</span></button>' +
        '<div class="nd-header-title">批注详情</div>' +
        '<button class="nd-share" id="ndShareBtn" title="生成分享卡片"><span class="mi">ios_share</span></button>' +
        '<button class="nd-jump" id="ndJumpBtn" title="跳转到原文"><span class="mi">menu_book</span></button>' +
      '</div>' +
      '<div class="nd-body">' +
        '<div class="nd-quote' + (item.style ? ' ' + item.style : '') + '"' + (item.color ? ' style="border-left-color:' + item.color + '"' : '') + '>' + item.text.replace(/</g, '&lt;') + '</div>' +
        '<div class="nd-meta"><span>' + item.bookTitle + '</span><span>·</span><span>' + item.chapter + '</span></div>' +
        userNoteHtml +
        aiNoteHtml +
        emptyHintHtml +
      '</div>' +
    '</div>';

  // 显示动画
  requestAnimationFrame(function() { overlay.classList.add('active'); });

  // 返回按钮
  $('ndBackBtn').addEventListener('click', closeNoteDetail);
  // 点遮罩关闭
  overlay.addEventListener('click', function(e) { if (e.target === overlay) closeNoteDetail(); });

  // 分享卡片
  var shareBtn = $('ndShareBtn');
  if (shareBtn) {
    shareBtn.addEventListener('click', function() {
      generateShareCard(item, shareBtn);
    });
  }

  // 跳转原文：关详情页 → 关总览 → 打开书并跳章节
  $('ndJumpBtn').addEventListener('click', function() {
    closeNoteDetail();
    jumpToHighlight(item);
  });
}

function closeNoteDetail() {
  var overlay = $('noteDetailOverlay');
  if (!overlay) return;
  overlay.classList.remove('active');
  setTimeout(function() { if (overlay.parentNode) overlay.remove(); }, 250);
}

// ============ 批注分享卡片（Canvas 绘制 → PNG → Bridge 保存） ============

// ---- 共用文本工具 ----
// 剥离 markdown 记号（**粗体** *斜体* `代码`）
function stripShareMd(text) {
  return String(text || '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1');
}

// 中文逐字换行 + 段落（\n）支持 + 避头尾
// 返回行数组，'' 空串为段落间隔标记
var SHARE_NO_START = '，。、；：？！）」』】》〉…"\'·,.;:?!)%~—';
var SHARE_NO_END = '（「『【《〈"\'';
function wrapShareText(ctx2, text, maxWidth) {
  var out = [];
  var paras = String(text || '').split(/\n+/);
  for (var p = 0; p < paras.length; p++) {
    var para = paras[p].replace(/\s+$/, '');
    if (!para.trim()) continue;
    if (out.length) out.push('');            // 段落间隔标记
    var line = '';
    for (var i = 0; i < para.length; i++) {
      var ch = para[i];
      var test = line + ch;
      if (ctx2.measureText(test).width > maxWidth && line) {
        if (SHARE_NO_START.indexOf(ch) >= 0) {
          out.push(test);                     // 禁头标点：挤进上一行再断
          line = '';
        } else if (SHARE_NO_END.indexOf(line[line.length - 1]) >= 0) {
          out.push(line.slice(0, -1));        // 禁尾标点：带到下一行
          line = line[line.length - 1] + ch;
        } else {
          out.push(line);
          line = ch;
        }
      } else line = test;
    }
    if (line) out.push(line);
  }
  return out;
}

// 行数组总高度（lh 行高 / gap 段落间隔高）
function shareLinesH(lines, lh, gap) {
  var h = 0;
  for (var i = 0; i < lines.length; i++) h += (lines[i] === '' ? gap : lh);
  return h;
}

// 逐行绘制，返回结束后的 y
function drawShareLines(c, lines, x, y, lh, gap) {
  for (var i = 0; i < lines.length; i++) {
    if (lines[i] === '') { y += gap; continue; }
    c.fillText(lines[i], x, y);
    y += lh;
  }
  return y;
}

// 读取当前主题（两种风格共用）
function readShareTheme() {
  var cs = getComputedStyle(document.documentElement);
  var v = function(name, fallback) {
    var val = cs.getPropertyValue(name);
    return (val && val.trim()) ? val.trim() : fallback;
  };
  var T = {
    bg:      v('--bg-0', '#F7F3EC'),
    card:    v('--bg-1', '#FDFBF6'),
    ink:     v('--ink', '#2C2A28'),
    ink2:    v('--ink-2', '#5A5651'),
    ink3:    v('--ink-3', '#8C867C'),
    accent:  v('--accent', '#C25946'),
    border:  v('--border', '#2C2A28'),
    radius:  parseInt(v('--radius', '0')) || 0,
    fontUI:   v('--font-ui', 'system-ui, sans-serif'),
    fontRead: v('--reader-font', v('--font-read', "'Noto Serif SC', Georgia, serif")),
    fontMono: v('--font-mono', "'Space Mono', monospace")
  };
  var isDark = false;
  try {
    var mCard = T.card.match(/^#([0-9a-f]{6})$/i);
    if (!mCard) { isDark = true; }
    else {
      var lumR = parseInt(mCard[1].substring(0,2),16), lumG = parseInt(mCard[1].substring(2,4),16), lumB = parseInt(mCard[1].substring(4,6),16);
      isDark = (lumR*299 + lumG*587 + lumB*114) / 1000 < 128;
    }
  } catch(e) {}
  return {
    T: T,
    isDark: isDark,
    shadowColor: isDark ? 'rgba(0,0,0,0.55)' : T.border,
    quoteBg: isDark ? 'rgba(255,255,255,0.06)' : T.card
  };
}

// 字体预热：canvas 用网络/主题字体前必须 load，否则静默 fallback
function preheatShareFonts(specs) {
  try {
    if (!document.fonts || !document.fonts.load) return Promise.resolve();
    var jobs = specs.map(function(s) {
      return document.fonts.load(s, '测试中文Abc123').catch(function() {});
    });
    return Promise.race([
      Promise.all(jobs),
      new Promise(function(res) { setTimeout(res, 1500); })
    ]);
  } catch(e) { return Promise.resolve(); }
}

// 按 bookId 取书籍元信息（作者等；失败 → 空对象）
function getShareBookMeta(bookId) {
  return new Promise(function(resolve) {
    try {
      if (!db) return resolve({});
      var tx = db.transaction(STORE_BOOKS, 'readonly');
      var rq = tx.objectStore(STORE_BOOKS).get(Number(bookId));
      rq.onsuccess = function() { resolve(rq.result || {}); };
      rq.onerror = function() { resolve({}); };
    } catch(e) { resolve({}); }
  });
}

// 书籍横幅：像素/墨水屏风格生成版画（书名哈希做种子 → 同一本书永远同一张）
function drawShareBanner(c, x, y, w, h, title, author, T) {
  var seed = 5381;
  var key = String(title || 'CoRead');
  for (var i = 0; i < key.length; i++) seed = ((seed * 131) + key.charCodeAt(i)) >>> 0;
  var rnd = function() { seed = (seed * 1103515245 + 12345) >>> 0; return (seed >>> 8) / 16777216; };
  var B = [[0,8,2,10],[12,4,14,6],[3,11,1,9],[15,7,13,5]];
  var style = Math.floor(rnd() * 4);
  var p1 = 5 + Math.floor(rnd() * 5);      // 图案密度参数
  var p2 = Math.floor(rnd() * 7);          // 图案相位参数
  var px = 4;                               // chunky 像素块
  var gw = Math.ceil(w / px), gh = Math.ceil(h / px);

  c.save();
  // -- 底纹 --
  c.fillStyle = T.ink;
  for (var j = 0; j < gh; j++) {
    for (var k = 0; k < gw; k++) {
      var on = false;
      var bay = (B[j % 4][k % 4] + 0.5) / 16;
      if (style === 0) {            // 网点晕影：四边浓、中心淡
        var dx = Math.abs(k - gw / 2) / (gw / 2), dy = Math.abs(j - gh / 2) / (gh / 2);
        var d = Math.max(dx, dy);
        on = bay < (d * d * 0.85 + 0.06);
      } else if (style === 1) {     // 斜纹
        on = ((k + j + p2) % p1) < 2;
      } else if (style === 2) {     // 扫描线 + 相位断点
        on = (j % 3 !== 2) && ((k + p2) % (p1 + 6) > 1) && bay < 0.72;
      } else {                      // 方格半调
        var cell = ((Math.floor(k / p1) + Math.floor(j / p1)) % 2 === 0);
        on = cell ? bay < 0.5 : bay < 0.07;
      }
      if (on) c.fillRect(x + k * px, y + j * px, px, px);
    }
  }
  // 外框收形
  c.strokeStyle = T.ink;
  c.lineWidth = 1.5;
  c.strokeRect(x, y, gw * px, gh * px);

  // -- 中央藏书票题签（双线框） --
  var t2 = '《' + String(title || '') + '》';
  var fs = 24;
  c.font = fs + 'px ' + T.fontRead;
  if (c.measureText(t2).width > w - 110) { fs = 20; c.font = fs + 'px ' + T.fontRead; }
  while (t2.length > 4 && c.measureText(t2).width > w - 90) t2 = t2.slice(0, -3) + '…》';
  var au = String(author || '').trim();
  c.font = '15px ' + T.fontMono;
  while (au.length > 2 && c.measureText(au).width > w - 120) au = au.slice(0, -1);
  c.font = fs + 'px ' + T.fontRead;
  var bw = Math.min(Math.max(c.measureText(t2).width + 56, 200), w - 36);
  var bh = au ? 88 : 62;
  var bx = x + (w - bw) / 2, by = y + (h - bh) / 2;
  c.fillStyle = T.card;
  c.fillRect(bx, by, bw, bh);
  c.strokeStyle = T.ink;
  c.lineWidth = 2;
  c.strokeRect(bx, by, bw, bh);
  c.lineWidth = 1;
  c.strokeRect(bx + 4, by + 4, bw - 8, bh - 8);
  c.fillStyle = T.ink;
  c.textAlign = 'center';
  c.fillText(t2, x + w / 2, by + (au ? 36 : 39));
  if (au) {
    c.font = '15px ' + T.fontMono;
    c.fillStyle = T.ink2;
    c.fillText(au, x + w / 2, by + 64);
  }
  c.restore();
}

// 印花税票：随机种子生成齿孔邮票（每次导出抽一张，8 种图案盲盒），斜盖当日邮戳
function drawShareStamp(c, x, y, w, h, seed0, postmark, T) {
  var seed = ((seed0 >>> 0) || 1);
  var seedBase = seed;
  var rnd = function() { seed = (seed * 1103515245 + 12345) >>> 0; return (seed >>> 8) / 16777216; };
  var B = [[0,8,2,10],[12,4,14,6],[3,11,1,9],[15,7,13,5]];
  var px = 3, ix = x + 11, iy = y + 11, iw = w - 22, ih = h - 22;
  var gw = Math.floor(iw / px), gh = Math.floor(ih / px);
  var bayAt = function(k, j) { return (B[j % 4][k % 4] + 0.5) / 16; };
  var hashAt = function(k, j) {
    var hh = ((k * 374761393 + j * 668265263) ^ seedBase) >>> 0;
    return ((hh ^ (hh >>> 13)) * 1274126177 >>> 0) >>> 8;
  };
  // 位图缓冲：先算后画，图层可互相覆盖
  var g = [];
  for (var i0 = 0; i0 < gw * gh; i0++) g.push(0);
  var set = function(k, j, v) { if (k >= 0 && k < gw && j >= 0 && j < gh) g[j * gw + k] = v; };

  var theme = rnd();
  if (theme < 0.42) {
    // ---- 山水票：抖动天空 + 日/月 + 双层随机游走山 + 水面 + 飞鸟 ----
    var horizon = Math.floor(gh * (0.55 + rnd() * 0.18));
    var night = rnd() < 0.35;
    for (var j = 0; j < horizon; j++) {
      var dens = (night ? 0.55 : 0.10) * (1 - j / horizon) + (night ? 0.04 : 0);
      for (var k = 0; k < gw; k++) {
        var on = bayAt(k, j) < dens;
        if (night && hashAt(k, j) % 97 < 3) on = !on;   // 星子
        if (on) set(k, j, 1);
      }
    }
    // 日/月（40% 概率挖成月牙）
    var scx = 3 + rnd() * (gw - 7), scy = 3 + rnd() * Math.max(2, horizon - 9);
    var sr = 2.2 + rnd() * 1.8;
    var crescent = rnd() < 0.4;
    for (var j2 = 0; j2 < horizon; j2++) {
      for (var k2 = 0; k2 < gw; k2++) {
        var du = Math.sqrt((k2 - scx) * (k2 - scx) + (j2 - scy) * (j2 - scy));
        if (du <= sr) {
          var dv = Math.sqrt((k2 - scx - sr * 0.7) * (k2 - scx - sr * 0.7) + (j2 - scy + sr * 0.4) * (j2 - scy + sr * 0.4));
          set(k2, j2, (crescent && dv <= sr * 0.95) ? 0 : 1);
        }
      }
    }
    // 远山（灰=半调）+ 近山（实心），各自随机游走
    var yf = horizon - 3 - Math.floor(rnd() * 5);
    var yn = horizon - 1 - Math.floor(rnd() * 3);
    for (var k3 = 0; k3 < gw; k3++) {
      yf += Math.round((rnd() - 0.5) * 2.4);
      if (yf < 2) yf = 2;
      if (yf > horizon - 2) yf = horizon - 2;
      yn += Math.round((rnd() - 0.48) * 2);
      if (yn < Math.floor(horizon * 0.45)) yn = Math.floor(horizon * 0.45);
      if (yn > horizon - 1) yn = horizon - 1;
      for (var j3 = yf; j3 < horizon; j3++) if (bayAt(k3, j3) < 0.45) set(k3, j3, 1);
      for (var j4 = yn; j4 < horizon; j4++) set(k3, j4, 1);
    }
    // 水面：断续横波
    var phase = Math.floor(rnd() * 5);
    for (var j5 = horizon; j5 < gh; j5++) {
      if ((j5 - horizon) % 3 === 0) {
        for (var k5 = 0; k5 < gw; k5++) if ((k5 + phase + j5 * 2) % 7 < 4) set(k5, j5, 1);
      }
    }
    // 飞鸟（白天限定）
    if (!night && rnd() < 0.6) {
      var nb = 1 + Math.floor(rnd() * 3);
      for (var b2 = 0; b2 < nb; b2++) {
        var bx = 2 + Math.floor(rnd() * (gw - 4));
        var by2 = 2 + Math.floor(rnd() * Math.max(2, Math.floor(horizon * 0.5)));
        set(bx - 1, by2, 1); set(bx, by2 - 1, 1); set(bx + 1, by2, 1);
      }
    }
  } else if (theme < 0.78) {
    // ---- 徽章票：随机位图 + 强制对称 = 小生物/纹章（Space Invader 原理） ----
    var quad = rnd() < 0.4;                       // 四重对称=纹章，左右镜像=小生物
    var ew = 14 + Math.floor(rnd() * 4);
    var eh = quad ? ew : 15 + Math.floor(rnd() * 5);
    if (ew > gw - 4) ew = gw - 4;
    if (eh > gh - 10) eh = gh - 10;
    var ox = Math.floor((gw - ew) / 2), oy = Math.floor((gh - eh) / 2);
    var hw = Math.ceil(ew / 2), hv = quad ? Math.ceil(eh / 2) : eh;
    var fill = 0.38 + rnd() * 0.14;
    for (var je = 0; je < hv; je++) {
      for (var ke = 0; ke < hw; ke++) {
        if (rnd() < fill) {
          set(ox + ke, oy + je, 1);
          set(ox + ew - 1 - ke, oy + je, 1);
          if (quad) { set(ox + ke, oy + eh - 1 - je, 1); set(ox + ew - 1 - ke, oy + eh - 1 - je, 1); }
        }
      }
    }
    // 周围撒一点微尘
    for (var jd = 0; jd < gh; jd++) {
      for (var kd = 0; kd < gw; kd++) {
        if (!g[jd * gw + kd] && hashAt(kd, jd) % 100 < 3) set(kd, jd, 1);
      }
    }
  } else {
    // ---- 普票：8 款纹理（原图案库） ----
    var style = Math.floor(rnd() * 8);
    var p1 = 5 + Math.floor(rnd() * 5);
    var p2 = Math.floor(rnd() * 7);
    for (var jt = 0; jt < gh; jt++) {
      for (var kt = 0; kt < gw; kt++) {
        var on2 = false;
        var bay = bayAt(kt, jt);
        if (style === 0) {
          var dx = Math.abs(kt - gw / 2) / (gw / 2), dy = Math.abs(jt - gh / 2) / (gh / 2);
          var dd = Math.max(dx, dy);
          on2 = bay < (dd * dd * 0.85 + 0.06);
        } else if (style === 1) {
          on2 = ((kt + jt + p2) % p1) < 2;
        } else if (style === 2) {
          on2 = (jt % 3 !== 2) && ((kt + p2) % (p1 + 6) > 1) && bay < 0.72;
        } else if (style === 3) {
          var cell = ((Math.floor(kt / p1) + Math.floor(jt / p1)) % 2 === 0);
          on2 = cell ? bay < 0.5 : bay < 0.07;
        } else if (style === 4) {
          var rx = (kt - gw / 2), ryy = (jt - gh / 2) * (gw / gh);
          on2 = ((Math.round(Math.sqrt(rx * rx + ryy * ryy)) + p2) % p1) < 2;
        } else if (style === 5) {
          on2 = ((Math.abs(kt - gw / 2) + Math.abs(jt - gh / 2) + p2) % p1) < 2;
        } else if (style === 6) {
          on2 = ((kt + jt + p2) % (p1 + 2)) < 2 || ((kt - jt + 64 + p2) % (p1 + 2)) < 2;
        } else {
          on2 = hashAt(kt, jt) % 100 < 38;
        }
        if (on2) set(kt, jt, 1);
      }
    }
  }

  c.save();
  // 票底 + 渲染位图
  c.fillStyle = T.card;
  c.fillRect(x, y, w, h);
  c.fillStyle = T.ink;
  for (var jr = 0; jr < gh; jr++) {
    for (var kr = 0; kr < gw; kr++) {
      if (g[jr * gw + kr]) c.fillRect(ix + kr * px, iy + jr * px, px, px);
    }
  }
  // 票面家具：面值（左上）+ 铭记（底边）
  c.textAlign = 'left';
  var fv = ['1分', '2分', '5分', '8分', '1角', '2角', '5角', '8角', '1元', '2元'][Math.floor(rnd() * 10)];
  c.font = '700 12px ' + T.fontMono;
  var fw = c.measureText(fv).width;
  c.fillStyle = T.card;
  c.fillRect(ix - 1, iy - 1, fw + 8, 16);
  c.fillStyle = T.ink;
  c.fillText(fv, ix + 3, iy + 11);
  var mz = 'COREAD邮政';
  c.font = '10px ' + T.fontMono;
  var mw = c.measureText(mz).width;
  c.fillStyle = T.card;
  c.fillRect(x + (w - mw) / 2 - 4, iy + ih - 12, mw + 8, 12);
  c.fillStyle = T.ink2;
  c.fillText(mz, x + (w - mw) / 2, iy + ih - 3);
  // 纹样细框
  c.strokeStyle = T.ink;
  c.lineWidth = 1;
  c.strokeRect(ix - 2.5, iy - 2.5, gw * px + 5, gh * px + 5);
  // 外框（粗）+ 齿孔：纸色圆洞沿边框咬一圈
  c.lineWidth = 3;
  c.strokeRect(x, y, w, h);
  c.fillStyle = T.card;
  var step = 9, r = 3;
  function punchRow(x0, y0, x1, y1) {
    var n = Math.round(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) / step);
    for (var t = 0; t <= n; t++) {
      c.beginPath();
      c.arc(x0 + (x1 - x0) * (t / n), y0 + (y1 - y0) * (t / n), r, 0, Math.PI * 2);
      c.fill();
    }
  }
  punchRow(x, y, x + w, y);
  punchRow(x, y + h, x + w, y + h);
  punchRow(x, y, x, y + h);
  punchRow(x + w, y, x + w, y + h);
  // 邮戳：双圈 + 日期，斜盖右下角
  if (postmark) {
    c.translate(x + w - 10, y + h - 8);
    c.rotate(-0.16);
    c.strokeStyle = T.ink2;
    c.lineWidth = 1.5;
    c.beginPath(); c.arc(0, 0, 25, 0, Math.PI * 2); c.stroke();
    c.lineWidth = 1;
    c.beginPath(); c.arc(0, 0, 19, 0, Math.PI * 2); c.stroke();
    c.fillStyle = T.ink2;
    c.font = '700 12px ' + T.fontMono;
    c.textAlign = 'center';
    c.fillText(postmark, 0, 4);
  }
  c.restore();
}

// ---- 样式选择：小票 / 卡片（记住上次选择） ----
function generateShareCard(item, btn) {
  var last = localStorage.getItem('cr-share-style') || 'receipt';
  var ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:10000;display:flex;align-items:center;justify-content:center;';
  function optHtml(key, zh, en) {
    var active = (key === last);
    return '<button data-style="' + key + '" style="display:block;width:100%;padding:14px 18px;margin-top:10px;text-align:left;cursor:pointer;' +
      'font-family:var(--font-mono);font-size:14px;font-weight:700;letter-spacing:0.08em;' +
      'background:' + (active ? 'var(--accent)' : 'var(--bg-1)') + ';color:' + (active ? 'var(--bg-0)' : 'var(--ink)') + ';' +
      'border:2px solid var(--border);border-radius:var(--radius);box-shadow:3px 3px 0 var(--border);">' +
      zh + '<span style="float:right;font-weight:400;opacity:0.6;">' + en + '</span></button>';
  }
  ov.innerHTML = '<div style="width:264px;padding:20px;background:var(--bg-0);border:2px solid var(--border);border-radius:var(--radius);box-shadow:6px 6px 0 var(--border);">' +
    '<div style="font-family:var(--font-mono);font-size:11px;font-weight:700;letter-spacing:0.14em;color:var(--ink-3);text-transform:uppercase;">EXPORT STYLE · 选择样式</div>' +
    optHtml('receipt', '小票风', 'RECEIPT') +
    optHtml('card', '卡片风', 'CARD') +
    '</div>';
  document.body.appendChild(ov);
  ov.addEventListener('click', function(e) {
    var b = e.target.closest ? e.target.closest('button[data-style]') : null;
    if (b) {
      var style = b.getAttribute('data-style');
      localStorage.setItem('cr-share-style', style);
      ov.remove();
      if (style === 'receipt') generateReceiptStyle(item, btn);
      else generateCardStyle(item, btn);
    } else if (e.target === ov) ov.remove();
  });
}

// ============ 小票风：热敏打印机质感（锯齿撕边 + 虚线 + 抖动书封 + 假条码） ============
function generateReceiptStyle(item, btn) {
  var oldIcon = btn ? btn.innerHTML : '';
  if (btn) btn.innerHTML = '<span class="mi">hourglass_empty</span>';
  function restore() { if (btn) btn.innerHTML = oldIcon; }

  var th = readShareTheme();
  var T = th.T;
  var FONT_MONO = T.fontMono;
  var FONT_READ = T.fontRead;

  // 异步准备：书籍元信息 + 字体预热，2.5s 兜底直接画
  var fired = false;
  function go(meta) {
    if (fired) return;
    fired = true;
    try { drawReceipt((meta && meta.author) || ''); } catch(e) { showToast('生成失败: ' + e.message); }
    restore();
  }
  Promise.all([
    getShareBookMeta(item.bookId),
    preheatShareFonts(['21px ' + FONT_READ, '18px ' + FONT_MONO, '700 26px ' + FONT_MONO])
  ]).then(function(res) { go(res[0]); });
  setTimeout(function() { go(null); }, 2500);

  function drawReceipt(bookAuthor) {
    // ---------- 文本预处理 ----------
    var quote = stripShareMd(item.text || '');
    if (quote.length > 200) quote = quote.substring(0, 200) + '…';
    var userNote = stripShareMd(item.note || '');
    var aiNote = stripShareMd(item.aiNote || '');
    var aiTitle = coreadConfig.cardName || 'AI';
    var bookTitle = item.bookTitle || '';
    var chapter = item.chapter || '';
    var noteCount = (userNote ? 1 : 0) + (aiNote ? 1 : 0);
    var people = 1 + (aiNote ? 1 : 0);
    var d = new Date();
    var pad2 = function(n) { return (n < 10 ? '0' : '') + n; };
    var dateStr = d.getFullYear() + '/' + pad2(d.getMonth() + 1) + '/' + pad2(d.getDate());
    var timeStr = pad2(d.getHours()) + ':' + pad2(d.getMinutes());
    var serial = 'No.' + d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) + '-' +
      String(item.id != null ? item.id : (Date.now() % 9973)).slice(-4).replace(/^/, '0000').slice(-4);

    // ---------- 版面参数 ----------
    var W = 560, MARGIN = 22, PX = 52, cw = W - PX * 2, scale = 2;
    var F_QUOTE = '21px ' + FONT_READ,   LH_QUOTE = 35, GAP_QUOTE = 16;
    var F_NOTE  = '19px ' + FONT_MONO,   LH_NOTE = 32,  GAP_NOTE = 14;
    var F_LABEL = '700 17px ' + FONT_MONO;
    var F_SMALL = '16px ' + FONT_MONO;

    // 测量
    var mCanvas = document.createElement('canvas');
    var mctx = mCanvas.getContext('2d');
    mctx.font = F_QUOTE;
    var quoteLines = wrapShareText(mctx, quote, cw);
    mctx.font = F_NOTE;
    var userLines = userNote ? wrapShareText(mctx, '[我] ' + userNote, cw) : [];
    var aiLines = aiNote ? wrapShareText(mctx, '[' + aiTitle + '] ' + aiNote, cw) : [];

    // 品名区高度（书籍信息行 + 印花税票取大者）
    var stampW = 96, stampH = 116;
    var bookRows = 1 + (bookAuthor ? 1 : 0) + (chapter ? 1 : 0);
    var bookBlockH = Math.max(stampH, 16 + bookRows * 32);

    // 高度预算（宽松估计，绘制后按实际 cy 裁剪合成）
    var estH = 620 + bookBlockH + 60 +
      shareLinesH(quoteLines, LH_QUOTE, GAP_QUOTE) +
      shareLinesH(userLines, LH_NOTE, GAP_NOTE) +
      shareLinesH(aiLines, LH_NOTE, GAP_NOTE) + 260;

    // ---------- 内容层（透明，坐标系与成品一致） ----------
    var cc = document.createElement('canvas');
    cc.width = W * scale;
    cc.height = estH * scale;
    var c = cc.getContext('2d');
    c.scale(scale, scale);
    c.textAlign = 'left';

    var cy = MARGIN + 46;
    var cxL = PX, cxR = W - PX, cxC = W / 2;

    function dashLine(y) {
      c.save();
      c.strokeStyle = T.ink3;
      c.lineWidth = 1.5;
      c.setLineDash([6, 5]);
      c.beginPath(); c.moveTo(cxL, y); c.lineTo(cxR, y); c.stroke();
      c.restore();
    }
    function solidLine(y, w2) {
      c.save();
      c.strokeStyle = T.ink;
      c.lineWidth = w2 || 2;
      c.beginPath(); c.moveTo(cxL, y); c.lineTo(cxR, y); c.stroke();
      c.restore();
    }
    function centerText(text, y) { c.save(); c.textAlign = 'center'; c.fillText(text, cxC, y); c.restore(); }
    function rowLR(l, r, y) {
      c.fillStyle = T.ink3; c.fillText(l, cxL, y);
      c.save(); c.textAlign = 'right'; c.fillStyle = T.ink; c.fillText(r, cxR, y); c.restore();
    }

    // -- 店头 --
    c.fillStyle = T.ink;
    c.font = '700 26px ' + FONT_MONO;
    centerText('CoRead 共读书店', cy);
    cy += 30;
    c.fillStyle = T.ink3;
    c.font = F_SMALL;
    centerText('· 人 机 共 读 凭 证 ·', cy);
    cy += 24;
    solidLine(cy, 2.5); solidLine(cy + 4, 1);
    cy += 32;

    // -- 收银信息 --
    c.font = F_SMALL;
    rowLR('收银员', aiTitle, cy); cy += 26;
    rowLR('时间', dateStr + '  ' + timeStr, cy); cy += 24;
    dashLine(cy); cy += 34;

    // -- 品名区：书籍信息行（左）+ 印花税票（右） --
    var stampX = cxR - stampW;
    var labelW = 62, infoMax = stampX - cxL - 26 - labelW;
    var blockTop = cy, ry = cy + 26;
    var F_TITLE = '700 19px ' + FONT_MONO;
    // 品名
    var tt = '《' + bookTitle + '》';
    mctx.font = F_TITLE;
    while (tt.length > 4 && mctx.measureText(tt).width > infoMax) tt = tt.slice(0, -3) + '…》';
    c.font = F_SMALL; c.fillStyle = T.ink3; c.fillText('品名', cxL, ry);
    c.font = F_TITLE; c.fillStyle = T.ink; c.fillText(tt, cxL + labelW, ry);
    ry += 32;
    // 著者
    if (bookAuthor) {
      var auStr = String(bookAuthor).trim();
      mctx.font = F_SMALL;
      while (auStr.length > 2 && mctx.measureText(auStr).width > infoMax) auStr = auStr.slice(0, -1);
      c.font = F_SMALL; c.fillStyle = T.ink3; c.fillText('著者', cxL, ry);
      c.fillStyle = T.ink; c.fillText(auStr, cxL + labelW, ry);
      ry += 32;
    }
    // 章节
    if (chapter) {
      var chStr = chapter;
      mctx.font = F_SMALL;
      while (chStr.length > 2 && mctx.measureText(chStr).width > infoMax) chStr = chStr.slice(0, -1);
      c.font = F_SMALL; c.fillStyle = T.ink3; c.fillText('章节', cxL, ry);
      c.fillStyle = T.ink2; c.fillText(chStr, cxL + labelW, ry);
      ry += 32;
    }
    drawShareStamp(c, stampX, blockTop, stampW, stampH, (Math.random() * 4294967296) >>> 0,
      pad2(d.getMonth() + 1) + '.' + pad2(d.getDate()), T);
    cy = blockTop + bookBlockH + 26;
    dashLine(cy); cy += 36;

    // -- 摘录 --
    c.fillStyle = T.ink;
    c.font = F_LABEL;
    c.fillText('▸ 摘录', cxL, cy);
    c.save(); c.textAlign = 'right'; c.fillText('×1', cxR, cy); c.restore();
    cy += 34;
    c.font = F_QUOTE;
    cy = drawShareLines(c, quoteLines, cxL, cy, LH_QUOTE, GAP_QUOTE);
    cy += 6;

    // -- 批注 --
    if (noteCount) {
      dashLine(cy); cy += 36;
      c.font = F_LABEL;
      c.fillStyle = T.ink;
      c.fillText('▸ 批注', cxL, cy);
      c.save(); c.textAlign = 'right'; c.fillText('×' + noteCount, cxR, cy); c.restore();
      cy += 32;
      c.font = F_NOTE;
      if (userLines.length) {
        c.fillStyle = T.ink;
        cy = drawShareLines(c, userLines, cxL, cy, LH_NOTE, GAP_NOTE);
        if (aiLines.length) cy += 14;
      }
      if (aiLines.length) {
        c.fillStyle = T.ink2;
        cy = drawShareLines(c, aiLines, cxL, cy, LH_NOTE, GAP_NOTE);
      }
      cy += 4;
    }

    // -- 合计 --
    dashLine(cy); cy += 38;
    c.font = '700 20px ' + FONT_MONO;
    c.fillStyle = T.ink;
    c.fillText('本单共读', cxL, cy);
    c.save(); c.textAlign = 'right'; c.fillText(people + ' 人', cxR, cy); c.restore();
    cy += 30;
    solidLine(cy, 1); cy += 30;
    c.fillStyle = T.ink3;
    c.font = F_SMALL;
    centerText('谢谢惠读 · 欢迎下次光临', cy);
    cy += 34;

    // -- 条码 + 流水号 --
    drawFakeBarcode(c, cxC - 140, cy, 280, 42, serial, T.ink);
    cy += 58;
    c.fillStyle = T.ink3;
    c.font = '15px ' + FONT_MONO;
    centerText(serial, cy);
    cy += 8;

    // ---------- 合成：底色 + 撕边纸 + 内容 ----------
    var paperBottom = cy + 30;
    var finalH = paperBottom + MARGIN;
    var canvas = document.createElement('canvas');
    canvas.width = W * scale;
    canvas.height = finalH * scale;
    var fc = canvas.getContext('2d');
    fc.scale(scale, scale);
    fc.fillStyle = T.bg;
    fc.fillRect(0, 0, W, finalH);

    function paperPath(ctx3, x, y, w2, h2, tooth, amp) {
      ctx3.beginPath();
      ctx3.moveTo(x, y);
      var n = Math.ceil(w2 / tooth);
      for (var i = 0; i < n; i++) {
        ctx3.lineTo(Math.min(x + (i + 0.5) * tooth, x + w2), y + amp);
        ctx3.lineTo(Math.min(x + (i + 1) * tooth, x + w2), y);
      }
      ctx3.lineTo(x + w2, y + h2);
      for (var j = n; j > 0; j--) {
        ctx3.lineTo(Math.max(x + (j - 0.5) * tooth, x), y + h2 - amp);
        ctx3.lineTo(x + (j - 1) * tooth, y + h2);
      }
      ctx3.closePath();
    }
    var pX = MARGIN, pY = MARGIN, pW = W - MARGIN * 2, pH = paperBottom - MARGIN;
    // 偏移阴影（跟随主题的硬阴影语言）
    fc.fillStyle = th.shadowColor;
    paperPath(fc, pX + 5, pY + 5, pW, pH, 16, 9);
    fc.fill();
    // 纸
    fc.fillStyle = T.card;
    paperPath(fc, pX, pY, pW, pH, 16, 9);
    fc.fill();
    // 内容
    fc.setTransform(1, 0, 0, 1, 0, 0);
    fc.drawImage(cc, 0, 0, W * scale, finalH * scale, 0, 0, W * scale, finalH * scale);

    var dataUrl = canvas.toDataURL('image/png');
    showSharePreview(dataUrl);
  }
}

// Bayer 4x4 有序抖动绘制封面（单色，chunky 像素，aspect-fill 中心裁切）
function drawDitheredCover(c, img, x, y, w, h, ink) {
  var px = 2;                                   // 逻辑像素块大小
  var gw = Math.max(1, Math.round(w / px)), gh = Math.max(1, Math.round(h / px));
  var oc = document.createElement('canvas');
  oc.width = gw; oc.height = gh;
  var octx = oc.getContext('2d');
  // 源图按目标比例中心裁切（竖封面取中段，偏上一点留住书名区）
  var tr = w / h, sr = img.width / img.height;
  var sx = 0, sy = 0, sw = img.width, sh = img.height;
  if (sr > tr) { sw = Math.round(img.height * tr); sx = Math.round((img.width - sw) / 2); }
  else { sh = Math.round(img.width / tr); sy = Math.round((img.height - sh) * 0.38); }
  octx.drawImage(img, sx, sy, sw, sh, 0, 0, gw, gh);
  var data;
  try { data = octx.getImageData(0, 0, gw, gh).data; } catch(e) { return; }
  var B = [[0,8,2,10],[12,4,14,6],[3,11,1,9],[15,7,13,5]];
  c.save();
  c.fillStyle = ink;
  for (var j = 0; j < gh; j++) {
    for (var i = 0; i < gw; i++) {
      var k = (j * gw + i) * 4;
      var lum = data[k] * 0.299 + data[k+1] * 0.587 + data[k+2] * 0.114;
      if (lum < (B[j % 4][i % 4] + 0.5) / 16 * 255) {
        c.fillRect(x + i * px, y + j * px, px, px);
      }
    }
  }
  // 细边框收一下形
  c.strokeStyle = ink;
  c.lineWidth = 1.5;
  c.strokeRect(x, y, gw * px, gh * px);
  c.restore();
}

// 假条码：由流水号确定性生成
function drawFakeBarcode(c, x, y, w, h, seed, ink) {
  var s = 0;
  for (var i = 0; i < seed.length; i++) s = (s * 31 + seed.charCodeAt(i)) >>> 0;
  var rand = function() { s = (s * 1103515245 + 12345) >>> 0; return s; };
  c.save();
  c.fillStyle = ink;
  var bx = x;
  while (bx < x + w - 4) {
    var bw = [2, 2, 3, 4, 2, 5][rand() % 6];
    if (rand() % 5 !== 0) c.fillRect(bx, y, bw, h);
    bx += bw + 2 + (rand() % 3);
  }
  c.restore();
}

// ============ 卡片风（原分享卡片） ============
function generateCardStyle(item, btn) {
  var oldIcon = btn ? btn.innerHTML : '';
  if (btn) btn.innerHTML = '<span class="mi">hourglass_empty</span>';
  function restore() { if (btn) btn.innerHTML = oldIcon; }

  var th = readShareTheme();
  var T = th.T;
  var FONT_MONO = T.fontMono;
  var FONT_READ = T.fontRead;

  var fired = false;
  function go(meta) {
    if (fired) return;
    fired = true;
    try { drawZineCard((meta && meta.author) || ''); } catch(e) { showToast('生成失败: ' + e.message); }
    restore();
  }
  Promise.all([
    getShareBookMeta(item.bookId),
    preheatShareFonts(['26px ' + FONT_READ, '18px ' + FONT_MONO, '700 22px ' + FONT_MONO])
  ]).then(function(res) { go(res[0]); });
  setTimeout(function() { go(null); }, 2500);

  function drawZineCard(bookAuthor) {
    // ---------- 文本预处理 ----------
    var quote = stripShareMd(item.text || '');
    if (quote.length > 180) quote = quote.substring(0, 180) + '…';
    var userNote = stripShareMd(item.note || '');
    var aiNote = stripShareMd(item.aiNote || '');
    var aiTitle = coreadConfig.cardName || 'AI';
    var bookTitle = item.bookTitle || '';
    var chapter = item.chapter || '';
    var d = new Date();
    var pad2 = function(n) { return (n < 10 ? '0' : '') + n; };
    var serial = 'No.' + String(item.id != null ? item.id : (Date.now() % 9973)).slice(-4).replace(/^/, '0000').slice(-4);

    // ---------- 版面参数 ----------
    var W = 560, PAD = 40, scale = 2;
    var cw = W - PAD * 2;
    var F_QUOTE = '22px ' + FONT_READ, LH_QUOTE = 37, GAP_QUOTE = 18;
    var F_NOTE  = '18px ' + FONT_MONO, LH_NOTE = 30, GAP_NOTE = 12;
    var F_LABEL = '700 14px ' + FONT_MONO;
    var F_HEAD  = '700 15px ' + FONT_MONO;

    // 测量
    var mCanvas = document.createElement('canvas');
    var mctx = mCanvas.getContext('2d');
    mctx.font = F_QUOTE;
    var quoteLines = wrapShareText(mctx, quote, cw - 20);
    mctx.font = '20px ' + FONT_MONO;
    var userLines = userNote ? wrapShareText(mctx, userNote, cw - 60) : [];
    var aiLines = aiNote ? wrapShareText(mctx, aiNote, cw - 60) : [];

    // 邮戳尺寸
    var pmR = 40;

    // 高度预算
    var estH = PAD + 44 + 30 + 24 +
      shareLinesH(quoteLines, LH_QUOTE, GAP_QUOTE) + 24 +
      30 + 30 +
      (userLines.length ? 60 + shareLinesH(userLines, LH_NOTE, GAP_NOTE) + 20 : 0) +
      (aiLines.length ? 60 + shareLinesH(aiLines, LH_NOTE, GAP_NOTE) + 20 : 0) +
      Math.max(pmR * 2 + 16, 60) + 40 + PAD;

    // ---------- 创建画布 ----------
    var canvas = document.createElement('canvas');
    canvas.width = W * scale;
    canvas.height = estH * scale;
    var c = canvas.getContext('2d');
    c.scale(scale, scale);

    // 背景
    c.fillStyle = T.bg;
    c.fillRect(0, 0, W, estH);

    // 主卡片（偏移硬阴影 + 硬边框）
    var cardX = 16, cardY = 16, cardW = W - 32, cardH = estH - 32;
        c.fillStyle = th.shadowColor;
    c.fillRect(cardX + 6, cardY + 6, cardW, cardH);
    c.fillStyle = T.bg;   // 卡片底色（与批注纸条互换：卡片用白色）
    c.fillRect(cardX, cardY, cardW, cardH);
    c.strokeStyle = T.border;
    c.lineWidth = 3;
    c.strokeRect(cardX, cardY, cardW, cardH);

    var cx = cardX + PAD, cy = cardY + PAD;
    var rx = cardX + cardW - PAD;

    // ---- 刊头：C O R E A D ──── No.xxxx ----
    c.font = '700 16px ' + FONT_MONO;
    c.fillStyle = T.ink;
    c.fillText('C O R E A D', cx, cy);
    // 横线 + 编号
    var headTextW = c.measureText('C O R E A D').width;
    c.strokeStyle = T.ink;
    c.lineWidth = 2;
    c.beginPath(); c.moveTo(cx + headTextW + 14, cy - 5); c.lineTo(rx - 80, cy - 5); c.stroke();
    c.font = '14px ' + FONT_MONO;
    c.fillStyle = T.ink3;
    c.textAlign = 'right';
    c.fillText(serial, rx, cy);
    c.textAlign = 'left';
    cy += 16;
    // 粗分割线
    c.strokeStyle = T.ink;
    c.lineWidth = 3.5;
    c.beginPath(); c.moveTo(cx, cy); c.lineTo(rx, cy); c.stroke();
    cy += 38;

    // ---- 摘录（大字，无框，居中；上下留白对称） ----
    var vPad = 34;   // 摘录上下留白相等 → 视觉垂直居中
    cy += vPad;
    c.font = F_QUOTE;
    c.fillStyle = T.ink;
    c.textAlign = 'center';
    var cxC2 = cardX + cardW / 2;
    for (var qi = 0; qi < quoteLines.length; qi++) {
      if (quoteLines[qi] === '') { cy += GAP_QUOTE; continue; }
      c.fillText(quoteLines[qi], cxC2, cy);
      cy += LH_QUOTE;
    }
    c.textAlign = 'left';
    cy += vPad - 14;
    // 细分割线
    c.strokeStyle = T.ink;
    c.lineWidth = 2.5;
    c.beginPath(); c.moveTo(cx, cy); c.lineTo(rx, cy); c.stroke();
    cy += 24;

    // ---- 书籍信息行 ----
    c.font = F_HEAD;
    c.fillStyle = T.ink2;
    var metaStr = '《' + bookTitle + '》';
    if (bookAuthor) metaStr += '  ' + bookAuthor;
    mctx.font = F_HEAD;
    while (metaStr.length > 4 && mctx.measureText(metaStr).width > cw) metaStr = metaStr.slice(0, -1) + '…';
    c.fillText(metaStr, cx, cy);
    if (chapter) {
      cy += 22;
      c.font = '13px ' + FONT_MONO;
      c.fillStyle = T.ink3;
      var chStr = chapter;
      mctx.font = '13px ' + FONT_MONO;
      while (chStr.length > 2 && mctx.measureText(chStr).width > cw - 20) chStr = chStr.slice(0, -1);
      c.fillText(chStr, cx, cy);
    }
    cy += 28;

    // ---- 批注纸条（锯齿撕边 + 微旋转） ----
    function drawNoteTape(lines, label, labelColor, angle) {
      if (!lines.length) return;
      var padV = 30;   // 内容上下留白（离锯齿边远一点）
      var tapeH = padV + shareLinesH(lines, LH_NOTE, GAP_NOTE) + padV + 16;  // 底部额外留出签名行
      var tapeW = cw - 30;
      var tapeX = cx + 12, tapeY = cy;
      c.save();
      c.translate(tapeX + tapeW / 2, tapeY + tapeH / 2);
      c.rotate(angle);
      c.translate(-(tapeX + tapeW / 2), -(tapeY + tapeH / 2));
      // 撕边纸底（与卡片底色互换：纸条用米色）
      c.fillStyle = T.card;
      c.beginPath();
      c.moveTo(tapeX, tapeY);
      var toothW = 12, amp = 5;
      var n = Math.ceil(tapeW / toothW);
      for (var i = 0; i < n; i++) {
        c.lineTo(Math.min(tapeX + (i + 0.5) * toothW, tapeX + tapeW), tapeY + amp);
        c.lineTo(Math.min(tapeX + (i + 1) * toothW, tapeX + tapeW), tapeY);
      }
      c.lineTo(tapeX + tapeW, tapeY + tapeH);
      for (var j = n; j > 0; j--) {
        c.lineTo(Math.max(tapeX + (j - 0.5) * toothW, tapeX), tapeY + tapeH - amp);
        c.lineTo(tapeX + (j - 1) * toothW, tapeY + tapeH);
      }
      c.closePath();
      c.fill();
      // 边框
      c.strokeStyle = T.border;
      c.lineWidth = 1.5;
      c.stroke();
      // 内容（深色字）
      c.font = '20px ' + FONT_MONO;
      c.fillStyle = T.ink;
      drawShareLines(c, lines, tapeX + 14, tapeY + padV + 16, LH_NOTE, GAP_NOTE);
      // 标签（右下角，小字）
      c.font = '700 12px ' + FONT_MONO;
      c.fillStyle = T.ink;
      c.globalAlpha = 0.65;
      c.textAlign = 'right';
      c.fillText('— ' + label, tapeX + tapeW - 14, tapeY + tapeH - 10);
      c.globalAlpha = 1;
      c.textAlign = 'left';
      c.restore();
      cy += tapeH + 18;
    }

    if (userLines.length || aiLines.length) cy += 10;
    drawNoteTape(userLines, '我', T.accent, -0.012);
    drawNoteTape(aiLines, aiTitle, T.ink3, 0.018);

    // ---- 底部：邮戳（右，斜盖） + 日期信息（左） ----
    cy += 10;
    var bottomY = cy;
    // 圆形邮戳：双圈 + 弧形文字 + 日期，斜盖
    var pmX = rx - pmR - 6, pmY = bottomY + pmR;
    c.save();
    c.translate(pmX, pmY);
    c.rotate(-0.14);
    c.strokeStyle = T.accent;
    c.globalAlpha = 0.75;
    c.lineWidth = 2.5;
    c.beginPath(); c.arc(0, 0, pmR, 0, Math.PI * 2); c.stroke();
    c.lineWidth = 1.5;
    c.beginPath(); c.arc(0, 0, pmR - 6, 0, Math.PI * 2); c.stroke();
    // 弧形文字 COREAD · READ（上弧）
    c.fillStyle = T.accent;
    c.font = '700 11px ' + FONT_MONO;
    c.textAlign = 'center';
    var arcTxt = 'COREAD·READ';
    var arcR = pmR - 15;
    for (var ai = 0; ai < arcTxt.length; ai++) {
      var ang = -Math.PI / 2 + (ai - (arcTxt.length - 1) / 2) * 0.22;
      c.save();
      c.translate(Math.cos(ang) * arcR, Math.sin(ang) * arcR);
      c.rotate(ang + Math.PI / 2);
      c.fillText(arcTxt[ai], 0, 0);
      c.restore();
    }
    // 中间横线 + 日期
    c.beginPath(); c.moveTo(-pmR + 10, 2); c.lineTo(pmR - 10, 2); c.stroke();
    c.fillStyle = T.accent;
    c.font = '700 12px ' + FONT_MONO;
    c.fillText(pad2(d.getMonth() + 1) + '.' + pad2(d.getDate()) + '.' + String(d.getFullYear()).slice(-2), 0, 20);
    c.restore();
    c.textAlign = 'left';
    // 左侧日期 + 品牌
    c.font = '13px ' + FONT_MONO;
    c.fillStyle = T.ink3;
    c.fillText(d.getFullYear() + '/' + pad2(d.getMonth() + 1) + '/' + pad2(d.getDate()), cx, bottomY + 20);
    c.fillText('由 CoRead 人机共读生成', cx, bottomY + 38);

    cy = Math.max(bottomY + pmR * 2 + 4, bottomY + 50);

    // ---------- 裁剪到实际高度 ----------
    var finalH = cy + 18 - cardY;
    var outCanvas = document.createElement('canvas');
    outCanvas.width = W * scale;
    outCanvas.height = finalH * scale;
    var oc = outCanvas.getContext('2d');
    // 重画背景（防止底部露白）
    oc.scale(scale, scale);
    oc.fillStyle = T.bg;
    oc.fillRect(0, 0, W, finalH);
    // 重画卡片到实际高度
    var realCardH = finalH - 32;
    oc.fillStyle = th.shadowColor;
    oc.fillRect(cardX + 6, cardY + 6, cardW, realCardH);
    oc.fillStyle = T.bg;
    oc.fillRect(cardX, cardY, cardW, realCardH);
    oc.strokeStyle = T.border;
    oc.lineWidth = 3;
    oc.strokeRect(cardX, cardY, cardW, realCardH);
    // 把内容层贴上去（跳过背景+卡片底，只取内容）
    oc.setTransform(1, 0, 0, 1, 0, 0);
    // 用 clip 只取卡片内部区域
    oc.save();
    oc.scale(scale, scale);
    oc.rect(cardX + 1.5, cardY + 1.5, cardW - 3, realCardH - 3);
    oc.clip();
    oc.setTransform(1, 0, 0, 1, 0, 0);
    oc.drawImage(canvas, 0, 0);
    oc.restore();
    // 重描外框（clip 后框线可能被裁）
    oc.scale(scale, scale);
    oc.strokeStyle = T.border;
    oc.lineWidth = 3;
    oc.strokeRect(cardX, cardY, cardW, realCardH);

    var dataUrl = outCanvas.toDataURL('image/png');
    showSharePreview(dataUrl);
  }
}

// 分享卡片全屏预览：先看效果，手动点「导出保存」才落盘
function showSharePreview(dataUrl, onExport) {
  var ov = document.createElement('div');
  ov.id = 'sharePreviewOverlay';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:10001;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px;';
  ov.innerHTML =
    '<img id="spImg" src="' + dataUrl + '" style="max-width:92%;max-height:66%;border-radius:8px;box-shadow:0 8px 40px rgba(0,0,0,0.5);" />' +
    '<div style="margin-top:16px;color:#fff;font-size:13px;opacity:0.6;">长按图片可直接分享到其他应用</div>' +
    '<div style="margin-top:14px;display:flex;gap:12px;">' +
      '<button id="spExportBtn" style="padding:10px 28px;border:2px solid #fff;border-radius:20px;background:#fff;color:#222;font-size:14px;font-weight:600;">导出保存</button>' +
      '<button id="spCloseBtn" style="padding:10px 28px;border:1.5px solid rgba(255,255,255,0.5);border-radius:20px;background:transparent;color:#fff;font-size:14px;">关闭</button>' +
    '</div>' +
    '<div id="spSaveStatus" style="margin-top:10px;color:#fff;font-size:12px;opacity:0;height:18px;"></div>';
  document.body.appendChild(ov);

  // 导出保存（Bridge 落盘）
  document.getElementById('spExportBtn').addEventListener('click', function() {
    var btn = this;
    var status = document.getElementById('spSaveStatus');
    btn.disabled = true;
    btn.style.opacity = '0.6';
    try {
      if (window.CoreadBridge && window.CoreadBridge.saveShareCard) {
        var resRaw = window.CoreadBridge.saveShareCard(dataUrl);
        var res = null;
        try { res = JSON.parse(resRaw); } catch(e2) {}
        if (res && res.ok && res.path) {
          status.textContent = '✓ 已保存：' + res.path.replace('/sdcard/Download/Operit/CoRead2/', '');
          status.style.opacity = '0.85';
          btn.textContent = '已保存 ✓';
          showToast('卡片已保存 ✓');
          return;
        }
        console.log('saveShareCard 返回:', resRaw);
      }
      status.textContent = '保存不可用，可长按图片保存';
      status.style.opacity = '0.6';
    } catch(e) {
      console.log('保存异常:', e);
      status.textContent = '保存失败，可长按图片保存';
      status.style.opacity = '0.6';
    }
    btn.disabled = false;
    btn.style.opacity = '1';
  });

  document.getElementById('spCloseBtn').addEventListener('click', function() { ov.remove(); });
  ov.addEventListener('click', function(e) { if (e.target === ov) ov.remove(); });
}

// 从详情页跳转到原文位置（等待书籍加载完成后跳章节 + 文字精确定位）
function jumpToHighlight(item) {
  try {
    var searchText = (item.text || '').substring(0, 30);
    var readerActive = $('readerOverlay') && $('readerOverlay').classList.contains('active');
    // 快照原进度：跳转属于临时浏览，退出时还原
    if (!__tempJump) {
      __tempJump = true;
      var p = loadProgress();
      __preJumpProgress = p ? JSON.parse(JSON.stringify(p)) : { chapterIdx: 0, scrollTop: 0, pageIndex: 0 };
    }
    if (!readerActive || String(currentBookId) !== String(item.bookId)) {
      openBook(item.bookId);
      // openBook 是异步链（IndexedDB→解压→解析→恢复进度），轮询等"目标书确实打开了"
      var tries = 0;
      var waitTimer = setInterval(function() {
        tries++;
        var ready = $('readerOverlay').classList.contains('active') &&
                    String(currentBookId) === String(item.bookId) &&
                    typeof chapters !== 'undefined' && chapters && chapters.length > 0;
        if (ready || tries > 50) {
          clearInterval(waitTimer);
          if (!ready) { showToast('书籍加载超时'); return; }
          // 再缓冲一下，避开 openBook 内部"恢复上次进度"的异步覆盖
          setTimeout(function() { doJumpWithRetry(item, searchText, 0); }, 400);
        }
      }, 100);
    } else {
      doJumpWithRetry(item, searchText, 0);
    }
  } catch(e) {
    console.log('跳转失败:', e);
  }
}

// 执行跳转并校验结果；若被进度恢复覆盖则重试
function doJumpWithRetry(item, searchText, attempt) {
  loadChapterAuto(item.chIdx, 0);
  setTimeout(function() {
    // 校验：章节是否真的切过去了（没切过去说明被 openBook 的进度恢复覆盖了）
    if (String(currentIdx) !== String(item.chIdx) && attempt < 4) {
      doJumpWithRetry(item, searchText, attempt + 1);
      return;
    }
    setTimeout(function() { locateHighlight(searchText); }, 400);
  }, 350);
}

// 精确定位到划线文字（复用书签面板的定位逻辑：滚动 scrollIntoView / 翻页模式计算页码）
function locateHighlight(searchText) {
  try {
    if (!searchText) return;
    var marks = document.querySelectorAll('.cr-highlight');
    for (var i = 0; i < marks.length; i++) {
      if (marks[i].textContent.indexOf(searchText) !== -1) {
        if (__pageMode === 'page' && __pagesReady) {
          var targetEl = marks[i];
          var pageText = $('pageText');
          var allCh = Array.from(pageText.children);
          var targetIdx = -1;
          for (var j = 0; j < allCh.length; j++) {
            if (allCh[j].contains(targetEl)) { targetIdx = j; break; }
          }
          if (targetIdx !== -1) {
            for (var p = 0; p < __pageBreaks.length; p++) {
              var pageItems = __pageBreaks[p];
              for (var k = 0; k < pageItems.length; k++) {
                if (pageItems[k].idx === targetIdx) {
                  currentPage = p;
                  __showCurrentPage();
                  flashMark(marks[i]);
                  return;
                }
              }
            }
          }
        } else {
          marks[i].scrollIntoView({ behavior: 'smooth', block: 'center' });
          flashMark(marks[i]);
        }
        return;
      }
    }
  } catch(e) {}
}

// 定位成功后闪烁提示
function flashMark(el) {
  el.style.outline = '2px solid var(--accent)';
  setTimeout(function() { el.style.outline = ''; }, 1500);
}

// 搜索结果定位：用 window.find 或 Range 在正文里找关键词，滚动/翻页到命中处
function locateSearchHit(kw) {
  try {
    if (!kw) return;
    var pageText = $('pageText');
    if (!pageText) return;

    // 方案1：TreeWalker 找包含关键词的文本节点
    var walker = document.createTreeWalker(pageText, NodeFilter.SHOW_TEXT, null);
    var node;
    while ((node = walker.nextNode())) {
      var idx = node.textContent.indexOf(kw);
      if (idx === -1) continue;

      // 用 Range 获取命中位置
      var range = document.createRange();
      range.setStart(node, idx);
      range.setEnd(node, Math.min(idx + kw.length, node.textContent.length));

      if (__pageMode === 'page' && __pagesReady) {
        // 翻页模式：找命中元素所在顶层子元素 → 计算页码
        var targetEl = range.startContainer.parentElement || pageText;
        var allCh = Array.from(pageText.children);
        var targetIdx = -1;
        for (var j = 0; j < allCh.length; j++) {
          if (allCh[j].contains(targetEl)) { targetIdx = j; break; }
        }
        if (targetIdx !== -1) {
          for (var p = 0; p < __pageBreaks.length; p++) {
            var pageItems = __pageBreaks[p];
            for (var k2 = 0; k2 < pageItems.length; k2++) {
              if (pageItems[k2].idx === targetIdx) {
                currentPage = p;
                __showCurrentPage();
                flashSearchHit(range);
                return;
              }
            }
          }
        }
      } else {
        // 滚动模式：scrollIntoView 到命中位置
        var span = document.createElement('span');
        try { range.surroundContents(span); } catch(e) { span.textContent = kw; }
        span.scrollIntoView({ behavior: 'smooth', block: 'center' });
        flashEl(span);
        // 3 秒后移除临时高亮包裹（还原文本）
        setTimeout(function() {
          var parent = span.parentNode;
          if (!parent) return;
          while (span.firstChild) parent.insertBefore(span.firstChild, span);
          parent.removeChild(span);
          parent.normalize();
        }, 3000);
      }
      return;
    }
  } catch(e) {}
}

// 翻页模式下给命中文字加临时高亮
function flashSearchHit(range) {
  try {
    var span = document.createElement('span');
    try { range.surroundContents(span); } catch(e) { return; }
    span.style.background = 'color-mix(in srgb, var(--accent) 30%, transparent)';
    setTimeout(function() {
      var parent = span.parentNode;
      if (!parent) return;
      while (span.firstChild) parent.insertBefore(span.firstChild, span);
      parent.removeChild(span);
      parent.normalize();
    }, 3000);
  } catch(e) {}
}

// 闪烁样式
function flashEl(el) {
  el.style.background = 'color-mix(in srgb, var(--accent) 30%, transparent)';
  setTimeout(function() { el.style.background = ''; }, 2000);
}

// 更新筛选标签：某本书的划线删光后，自动隐藏/禁用对应标签
function updateNotesFilter(deletedBookId) {
  try {
    var allKey = 'cr_hl_all_' + deletedBookId;
    var remaining = 0;
    var data = JSON.parse(localStorage.getItem(allKey) || '{}');
    Object.keys(data).forEach(function(chIdx) {
      if (Array.isArray(data[chIdx])) remaining += data[chIdx].length;
    });

    // 找到对应的筛选按钮
    var btn = document.querySelector('.notes-filter-btn[data-book="' + deletedBookId + '"]');
    if (!btn) return;

    if (remaining === 0) {
      // 该书已无任何划线：隐藏标签，并切回"全部"
      btn.style.display = 'none';
      var filterWrap = document.querySelector('.notes-filter');
      if (filterWrap) {
        var activeBtn = filterWrap.querySelector('.notes-filter-btn.active');
        if (activeBtn && activeBtn.getAttribute('data-book') === deletedBookId) {
          var allBtn = filterWrap.querySelector('.notes-filter-btn[data-book="all"]');
          if (allBtn) allBtn.click();
        }
      }
      // 检查是否所有书都空了 → 显示空状态
      var visibleBooks = {};
      document.querySelectorAll('.note-card').forEach(function(c) { visibleBooks[c.getAttribute('data-book')] = true; });
      delete visibleBooks[deletedBookId];
      var wrapEl = $('noteWrap');
      if (wrapEl && wrapEl.querySelectorAll('.note-card').length === 0) {
        renderNotesTab();
      }
    }
  } catch(e) {}
}

// 从批注总览页删除一条划线：清理全书高亮汇总 + 当前章高亮 + 用户批注
// 返回 true=删除成功，false=失败
function deleteNoteFromOverview(noteKey, bookId) {
  try {
    var chIdx = noteKey.split(':')[0];

    // 1. 全书高亮汇总：移除匹配项
    var allKey = 'cr_hl_all_' + bookId;
    var all = JSON.parse(localStorage.getItem(allKey) || '{}');
    if (all[chIdx] && Array.isArray(all[chIdx])) {
      all[chIdx] = all[chIdx].filter(function(it) {
        return (chIdx + ':' + (it.text || '').substring(0, 50)) !== noteKey;
      });
      if (all[chIdx].length === 0) delete all[chIdx];
      localStorage.setItem(allKey, JSON.stringify(all));
    }

    // 2. 用户批注：移除对应 key
    var notesKey = 'cr_notes_' + bookId;
    var notes = JSON.parse(localStorage.getItem(notesKey) || '{}');
    if (notes[noteKey] !== undefined) {
      delete notes[noteKey];
      localStorage.setItem(notesKey, JSON.stringify(notes));
    }

    // 3. 若删的是当前打开书籍的当前章节，同步刷新章节内高亮缓存
    if (String(currentBookId) === String(bookId)) {
      var hlKey = 'cr_hl_' + bookId + '_' + chIdx;
      var items = JSON.parse(localStorage.getItem(hlKey) || '[]');
      if (Array.isArray(items)) {
        items = items.filter(function(it) {
          var t = typeof it === 'string' ? it : it.text;
          return (chIdx + ':' + String(t).substring(0, 50)) !== noteKey;
        });
        localStorage.setItem(hlKey, JSON.stringify(items));
      }
      // 如果正停在该章节，重新渲染划线
      if (currentBookId && String(currentIdx) === chIdx && $('readerOverlay').classList.contains('active')) {
        restoreHighlights();
      }
    }

    return true;
  } catch(e) {
    showToast('删除失败: ' + e);
    return false;
  }
}

// ============ 划线书签面板 ============
function openBookmarks() {
  closeToc();
  closeSettings();
  var panel = $('bookmarkPanel');
  if (!panel) return;
  var list = $('bookmarkList');
  list.innerHTML = '';

  if (!currentBookId) {
    list.innerHTML = '<div class="notes-empty"><span class="mi">bookmark_border</span><p>请先打开一本书</p></div>';
    panel.classList.add('active');
    return;
  }

  // 读取当前书的所有高亮
  var allData = JSON.parse(localStorage.getItem('cr_hl_all_' + currentBookId) || '{}');
  var notes = JSON.parse(localStorage.getItem('cr_notes_' + currentBookId) || '{}');
  // 读取 AI 批注（从文件读取，通过 Bridge）
  var aiNotes = window.__currentAINotes || {};
  if (!aiNotes || Object.keys(aiNotes).length === 0) {
    try {
      if (window.CoreadBridge && window.CoreadBridge.getAINotes) {
        var res = window.CoreadBridge.getAINotes(currentBookId);
        if (res && res.notes) aiNotes = res.notes;
      }
    } catch(e) {
      console.log('读取 AI 批注失败:', e);
    }
  }
  var items = [];

  Object.keys(allData).forEach(function(chIdx) {
    var arr = allData[chIdx];
    if (!Array.isArray(arr)) return;
    arr.forEach(function(hl) {
      var noteKey = chIdx + ':' + (hl.text || '').substring(0, 50);
      var aiNote = aiNotes[noteKey] || '';
      items.push({
        text: hl.text || '',
        style: hl.style || '',
        color: hl.color || '',
        chapter: hl.chapterTitle || (chapters[parseInt(chIdx)] ? chapters[parseInt(chIdx)].title : 'Ch.' + (parseInt(chIdx) + 1)),
        chapterIdx: parseInt(chIdx),
        note: notes[noteKey] || '',
        aiNote: aiNote,
        time: hl.time || 0
      });
    });
  });

  items.sort(function(a, b) { return b.time - a.time; });

  if (items.length === 0) {
    list.innerHTML = '<div class="notes-empty"><span class="mi">bookmark_border</span><p>本书还没有划线</p><p class="sub">阅读时选中文字并划线即可添加</p></div>';
    panel.classList.add('active');
    return;
  }

  // 统计信息
  var statDiv = document.createElement('div');
  statDiv.style.cssText = 'text-align:center;padding:8px 0 12px;font-size:13px;color:var(--ink);opacity:0.5';
  statDiv.textContent = '共 ' + items.length + ' 条划线';
  list.appendChild(statDiv);

  items.forEach(function(item) {
    var card = document.createElement('div');
    card.className = 'note-card';
    card.style.cursor = 'pointer';

    var colorBorder = item.color ? ' style="border-left:3px solid ' + item.color + '"' : ' style="border-left:3px solid var(--accent)"';

    var noteHtml = item.note
      ? '<div class="note-card-comment">' + item.note.replace(/</g, '&lt;').replace(/\n/g, '<br>') + '</div>'
      : '';

    // AI 批注显示（兼容对象和字符串格式）
    var aiNoteText = '';
    if (item.aiNote) {
      if (typeof item.aiNote === 'object' && item.aiNote.text) {
        aiNoteText = item.aiNote.text;
      } else if (typeof item.aiNote === 'string') {
        aiNoteText = item.aiNote;
      }
    }
    var aiNoteHtml = aiNoteText
      ? '<div class="note-card-comment ai-note-comment"><span class="mi" style="font-size:13px;vertical-align:middle;margin-right:4px">smart_toy</span>' + aiNoteText.replace(/</g, '&lt;').replace(/\n/g, '<br>') + '</div>'
      : '';

    var timeStr = '';
    if (item.time) {
      var d = new Date(item.time);
      timeStr = (d.getMonth() + 1) + '/' + d.getDate() + ' ' + d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0');
    }

    card.innerHTML =
      '<div class="note-card-quote"' + colorBorder + '>' + item.text.replace(/</g, '&lt;') + '</div>' +
      noteHtml + aiNoteHtml +
      '<div class="note-card-meta"><span>' + item.chapter + '</span><span>' + timeStr + '</span>' +
      '<span class="note-card-del" style="margin-left:auto;color:var(--accent);cursor:pointer;font-size:12px;opacity:0.6" data-ch-del="' + item.chapterIdx + '" data-text-del="' + item.text.substring(0, 50).replace(/"/g, '"') + '">删除</span></div>';

    // 点击跳转到对应章节
    card.setAttribute('data-ch', item.chapterIdx);
    card.setAttribute('data-text', item.text.substring(0, 30));
    card.onclick = function() {
      var chIdx = parseInt(this.getAttribute('data-ch'));
      var searchText = this.getAttribute('data-text');
      closeBookmarks();
      loadChapterAuto(chIdx, 0);
      // 延迟搜索定位到划线文字
      setTimeout(function() {
        var marks = document.querySelectorAll('.cr-highlight');
        for (var i = 0; i < marks.length; i++) {
          if (marks[i].textContent.indexOf(searchText) !== -1) {
            // 翻页模式：计算目标元素在哪一页
            if (__pageMode === 'page' && __pagesReady) {
              var targetEl = marks[i];
              var pageText = $('pageText');
              var allCh = Array.from(pageText.children);
              // 找到目标元素所在的顶层子元素索引
              var targetIdx = -1;
              for (var j = 0; j < allCh.length; j++) {
                if (allCh[j].contains(targetEl)) {
                  targetIdx = j;
                  break;
                }
              }
              // 遍历所有页，找到包含该元素的页
              if (targetIdx !== -1) {
                for (var p = 0; p < __pageBreaks.length; p++) {
                  var pageItems = __pageBreaks[p];
                  for (var k = 0; k < pageItems.length; k++) {
                    if (pageItems[k].idx === targetIdx) {
                      currentPage = p;
                      __showCurrentPage();
                      // 闪烁高亮提示
                      marks[i].style.outline = '2px solid var(--accent)';
                      setTimeout(function(el) { el.style.outline = ''; }.bind(null, marks[i]), 1500);
                      return;
                    }
                  }
                }
              }
            } else {
              // 滚动模式：使用原有逻辑
              marks[i].scrollIntoView({ behavior: 'smooth', block: 'center' });
              // 闪烁高亮提示
              marks[i].style.outline = '2px solid var(--accent)';
              setTimeout(function(el) { el.style.outline = ''; }.bind(null, marks[i]), 1500);
            }
            break;
          }
        }
      }, 500);
    };

    // 删除按钮
    card.querySelector('.note-card-del').onclick = function(e) {
      e.stopPropagation();
      var delCh = this.getAttribute('data-ch-del');
      var delText = this.getAttribute('data-text-del');
      var thisCard = this.closest('.note-card');
      // 从 localStorage 删除该条高亮
      var key = 'cr_hl_all_' + currentBookId;
      var all = JSON.parse(localStorage.getItem(key) || '{}');
      if (all[delCh] && Array.isArray(all[delCh])) {
        all[delCh] = all[delCh].filter(function(h) {
          return (h.text || '').substring(0, 50) !== delText;
        });
        if (all[delCh].length === 0) delete all[delCh];
        localStorage.setItem(key, JSON.stringify(all));
      }
      // 同时删除对应批注
      var noteKey = 'cr_notes_' + currentBookId;
      var notes = JSON.parse(localStorage.getItem(noteKey) || '{}');
      var nk = delCh + ':' + delText;
      if (notes[nk]) { delete notes[nk]; localStorage.setItem(noteKey, JSON.stringify(notes)); }
      // 移除卡片 + 更新统计
      thisCard.remove();
      var remaining = list.querySelectorAll('.note-card').length;
      var stat = list.querySelector('div[style*="text-align:center"]');
      if (remaining === 0) {
        list.innerHTML = '<div class="notes-empty"><span class="mi">bookmark_border</span><p>本书还没有划线</p><p class="sub">阅读时选中文字并划线即可添加</p></div>';
      } else if (stat) {
        stat.textContent = '共 ' + remaining + ' 条划线';
      }
      showToast('已删除划线');
    };

    list.appendChild(card);
  });

  panel.classList.add('active');
  clearTimeout(autoHideTimer);
  readerUIVisible = true;
  $('readerTopbar').classList.add('visible');
  $('readerBottombar').classList.add('visible');
}

function closeBookmarks() {
  $('bookmarkPanel').classList.remove('active');
}

function toggleBookmarks() {
  var panel = $('bookmarkPanel');
  if (panel.classList.contains('active')) closeBookmarks();
  else openBookmarks();
}

window.openBookmarks = openBookmarks;
window.closeBookmarks = closeBookmarks;
window.toggleBookmarks = toggleBookmarks;

// ============ AI 对话面板 ============
var aiPanelOpen = false;

function openAIPanel(skipHistory) {
  $('aiPanel').classList.add('active');
  $('aiBackdrop').classList.add('active');
  aiPanelOpen = true;
  // 请求加载历史（除非调用方说跳过）
  if (!skipHistory && window.CoreadBridge && window.CoreadBridge.loadHistory) {
    try { window.CoreadBridge.loadHistory(); } catch(e) {}
  }
}

function closeAIPanel() {
  $('aiPanel').classList.remove('active');
  $('aiBackdrop').classList.remove('active');
  aiPanelOpen = false;
}

function toggleAIPanel() {
  if (aiPanelOpen) closeAIPanel();
  else openAIPanel();
}

// 发送选中文字给 AI（底栏 AI 按钮 或 划线菜单里调用）
function sendSelectionToAI() {
  var sel = window.getSelection();
  var text = sel ? sel.toString().trim() : '';
  if (!text && pendingRange) text = pendingRange.toString().trim();
  
  if (!text) {
    // 没有选中文字，直接打开面板
    openAIPanel();
    return;
  }

  openAIPanel(true);
  
  // 添加用户消息气泡
  addAIMessage('user', text, '');
  addAIMessage('ai-loading', '正在连接 AI ···', '');

  // 调用 Bridge
  if (window.CoreadBridge && window.CoreadBridge.sendToAI) {
    try {
      window.CoreadBridge.sendToAI(JSON.stringify({
        selectedText: text,
        bookTitle: currentBookTitle || '',
        chapterTitle: chapters[currentIdx] ? (chapters[currentIdx].title || '') : '',
        comment: ''
      }));
    } catch(e) {
      removeLoadingMessage();
      addAIMessage('ai', '桥接调用失败: ' + e, '');
    }
  } else {
    removeLoadingMessage();
    addAIMessage('ai', '桥接未就绪，请确认插件已正确安装。', '');
  }

  // 清除选区
  if (sel) sel.removeAllRanges();
  $('hlMenu').classList.remove('active');
}

// 追问
function sendAIFollowUp() {
  var input = $('aiInput');
  var msg = input.value.trim();
  if (!msg) return;
  input.value = '';

  addAIMessage('user', msg, '');
  addAIMessage('ai-loading', '正在接收回复 ···', '');

  if (window.CoreadBridge && window.CoreadBridge.sendFollowUp) {
    try {
      window.CoreadBridge.sendFollowUp(JSON.stringify({ message: msg }));
    } catch(e) {
      removeLoadingMessage();
      addAIMessage('ai', '发送失败: ' + e, '');
    }
  }
}

// 添加消息气泡
function addAIMessage(type, text, quote) {
  var container = $('aiMessages');
  // 移除空状态提示
  var empty = container.querySelector('.ai-empty');
  if (empty) empty.remove();

  var div = document.createElement('div');
  if (type === 'ai-loading') {
    div.className = 'ai-msg ai loading';
    div.id = 'aiLoadingMsg';
    div.textContent = text;
  } else if (type === 'user') {
    div.className = 'ai-msg user';
    if (quote) {
      div.innerHTML = '<div class="ai-msg-quote">' + quote.replace(/</g, '<').substring(0, 100) + '</div>' + text.replace(/</g, '<').replace(/\n/g, '<br>');
    } else {
      div.textContent = text;
    }
  } else {
    div.className = 'ai-msg ai';
    div.innerHTML = renderMd(text);
  }
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function removeLoadingMessage() {
  var el = $('aiLoadingMsg');
  if (el) el.remove();
}

// Bridge 回调：AI 回复（非流式 fallback）
window.__coreadAIReply = function(reply) {
  removeLoadingMessage();
  addAIMessage('ai', reply, '');
};

// 简易 Markdown → HTML 渲染（用于 AI 回复）
function renderMd(text) {
  if (!text) return '';
  
  // 1. 先过滤掉 <thinking>...</thinking> 和工具调用块
  text = text.replace(/<thinking[\s\S]*?<\/thinking>/gi, '');
  text = text.replace(/<function_calls>[\s\S]*?<\/function_calls>/gi, '');
  
  // 2. 转义 HTML 标签（保护用户内容）
  var html = text.replace(/</g, '&lt;');
  
  // 3. 渲染 Markdown 语法
  html = html
    .replace(/^### (.+)$/gm, '<strong style="font-size:14px;">$1</strong>')
    .replace(/^## (.+)$/gm, '<strong style="font-size:15px;">$1</strong>')
    .replace(/^# (.+)$/gm, '<strong style="font-size:16px;">$1</strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code style="background:var(--bg-2);padding:1px 4px;border-radius:3px;font-size:12px;">$1</code>')
    .replace(/^- (.+)$/gm, '• $1')
    .replace(/^> (.+)$/gm, '<span style="border-left:3px solid var(--accent);padding-left:8px;color:var(--ink-2);">$1</span>')
    .replace(/\n/g, '<br>');
  
  return html;
}

// Bridge 回调：流式 chunk（打字机效果）
var __streamingMsgEl = null;
var __streamingText = '';
window.__coreadAIChunk = function(chunk) {
  if (!__streamingMsgEl) {
    removeLoadingMessage();
    var container = $('aiMessages');
    var empty = container.querySelector('.ai-empty');
    if (empty) empty.remove();
    __streamingMsgEl = document.createElement('div');
    __streamingMsgEl.className = 'ai-msg ai';
    __streamingText = '';
    container.appendChild(__streamingMsgEl);
  }
  
  __streamingText += chunk;
  
  // 检测未闭合标签，显示占位符
  var inThinking = (__streamingText.indexOf('<thinking') > -1) && (__streamingText.indexOf('</thinking>') === -1);
  var inFunctionCall = (__streamingText.indexOf("<function_calls>") > -1) && (__streamingText.indexOf("</antml:function_calls>") === -1);

  // 临时渲染：过滤掉完整的思维链和工具调用标签
  var displayText = __streamingText
    .replace(/<thinking[\s\S]*?<\/thinking>/g, '')
    .replace(/<function_calls>[\s\S]*?<\/function_calls>/g, '');
  
  // 流式输出时，如果正在输出思维链或工具调用内部，显示占位符
  if (inThinking) {
    displayText += '<span style="color:var(--ink-3);font-size:12px;">💭 思考中...</span>';
  }
  if (inFunctionCall) {
    displayText += '<span style="color:var(--ink-3);font-size:12px;">🔧 调用工具...</span>';
  }
  
  __streamingMsgEl.innerHTML = renderMd(displayText);
  var container = $('aiMessages');
  container.scrollTop = container.scrollHeight;
};

// Bridge 回调：流式结束
window.__coreadAIDone = function(finalReply) {
  if (__streamingMsgEl) {
    // 流式完成，用最终完整回复渲染
    if (finalReply) {
      __streamingMsgEl.innerHTML = renderMd(finalReply);
    }
    __streamingMsgEl = null;
    __streamingText = '';
  } else {
    // 没有收到任何 chunk（fallback）
    removeLoadingMessage();
    if (finalReply) addAIMessage('ai', finalReply, '');
  }
};

// Bridge 回调：追问回复
window.__coreadAIFollowUp = function(reply) {
  removeLoadingMessage();
  addAIMessage('ai', reply, '');
};

// Bridge 回调：加载历史
window.__coreadLoadHistory = function(jsonStr) {
  try {
    var history = JSON.parse(jsonStr);
    if (!Array.isArray(history) || history.length === 0) return;
    var container = $('aiMessages');
    container.innerHTML = '';
    history.forEach(function(entry) {
      if (entry.selectedText || entry.comment) {
        var userText = entry.comment || entry.selectedText;
        addAIMessage('user', userText, entry.selectedText && entry.comment ? entry.selectedText : '');
      }
      if (entry.aiReply) {
        addAIMessage('ai', entry.aiReply, '');
      }
    });
  } catch(e) {}
};

// Bridge 回调：AI 批注预加载推送（打开书后由 Bridge 主动推过来）
window.__coreadAINotesLoaded = function(jsonStr) {
  try {
    var notes = JSON.parse(jsonStr);
    if (notes && typeof notes === 'object') {
      // 归一化格式（旧格式字符串 → {text, color}）
      var normalized = {};
      for (var k in notes) {
        var v = notes[k];
        if (typeof v === 'string') normalized[k] = { text: v, color: null };
        else if (v && typeof v === 'object') normalized[k] = { text: v.text || '', color: v.color || null };
      }
      window.__currentAINotes = normalized;
      // 若当前正在阅读，刷新划线的 AI 批注标记
      if ($('readerOverlay') && $('readerOverlay').classList.contains('active')) {
        try { restoreHighlights(); } catch(e) {}
      }
    }
  } catch(e) {}
};

// Bridge 回调：配置推送 + 空配置检测弹窗
window.__coreadSetConfig = function(jsonStr) {
  try {
    var cfg = JSON.parse(jsonStr);
    var valEl = $('valChatId');
    var len = cfg.chatId ? cfg.chatId.length : 0;
    if (cfg.chatId && len >= 8) {
      // 非空且长度合理（兼容36位 UUID 与短 ID），视为有效
      if (valEl) valEl.textContent = len > 12 ? cfg.chatId.substring(0, 8) + '...' : cfg.chatId;
    } else if (cfg.chatId && len > 0) {
      // 过短或过长才提示检查
      if (valEl) valEl.textContent = '配置有误';
      var hint = 'chat_id 格式可能不正确';
      if (len < 8) hint += '（当前长度 ' + len + '，请确认是否复制完整）';
      else hint += '（当前长度 ' + len + '，过长，请检查是否多复制了内容）';
      hint += '。若共读功能可正常使用可忽略此提醒。';
      showConfigAlert(hint);
    } else {
      // 空 = 尚未配置
      if (valEl) valEl.textContent = '未配置';
      showConfigAlert('');
    }
  } catch(e) {}
};

// 配置提醒弹窗
function showConfigAlert(extraMsg) {
  // 避免重复弹
  if ($('configAlert')) return;
  var title = extraMsg ? '配置有误' : 'AI 共读尚未配置';
  var icon = extraMsg ? 'error_outline' : 'link_off';
  var desc = extraMsg || '请在 Operit 对话中告诉 AI「帮我配置 CoRead」或使用工具 <code style="background:var(--bg-1);padding:2px 4px;border-radius:3px;">coread2_config:set_coread_config</code> 设置 chat_id。';
  var overlay = document.createElement('div');
  overlay.id = 'configAlert';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;';
  overlay.innerHTML = '<div style="background:var(--bg-0);border:1px solid var(--border);border-radius:12px;padding:24px;max-width:320px;width:85%;text-align:center;">' +
    '<div style="margin-bottom:12px;"><span class="mi" style="font-size:36px;color:var(--accent);">' + icon + '</span></div>' +
    '<div style="font-family:var(--font-read);font-size:15px;font-weight:600;margin-bottom:8px;">' + title + '</div>' +
    '<div style="font-family:var(--font-read);font-size:13px;color:var(--ink-2);line-height:1.6;margin-bottom:16px;">' + desc + '</div>' +
    '<button onclick="this.parentNode.parentNode.remove()" style="background:var(--accent);color:var(--bg-0);border:none;border-radius:8px;padding:10px 24px;font-size:13px;font-weight:600;cursor:pointer;">我知道了</button>' +
    '</div>';
  document.body.appendChild(overlay);
}

// 绑定底栏 AI 按钮（只打开面板，不自动发送）
var btnAI = $('btnAI');
if (btnAI) {
  btnAI.onclick = function() {
    openAIPanel();
  };
}

// 输入框回车发送
var aiInput = $('aiInput');
if (aiInput) {
  aiInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendAIFollowUp();
    }
  });
}

// ============ AI 快捷发送面板 ============
var aiQuickText = ''; // 存储选中的文字
var aiQuickRange = null; // 保存 Range 用于"同时划线"

function askAIAboutSelection() {
  var sel = window.getSelection();
  var text = sel ? sel.toString().trim() : '';
  if (!text && pendingRange) text = pendingRange.toString().trim();
  if (!text) return;

  aiQuickText = text;
  // 保存当前 Range 以便后续划线
  aiQuickRange = pendingRange ? pendingRange.cloneRange() : (sel && sel.rangeCount > 0 ? sel.getRangeAt(0).cloneRange() : null);
  
  $('aiQuickQuote').textContent = text;
  $('aiQuickInput').value = '';
  $('aiQuick').classList.add('active');
  
  // 清除选区和菜单
  if (sel) sel.removeAllRanges();
  $('hlMenu').classList.remove('active');
}

function closeAIQuick() {
  $('aiQuick').classList.remove('active');
  aiQuickText = '';
  aiQuickRange = null;
}

function submitAIQuick() {
  var comment = $('aiQuickInput').value.trim();
  var shouldHighlight = $('aiQuickHighlight').checked;
  var text = aiQuickText;
  
  if (!text) { closeAIQuick(); return; }

  // 同时划线标记（普通用户划线，不是 AI 划线）
  if (shouldHighlight && aiQuickRange) {
    pendingRange = aiQuickRange;
    doHighlight(); // 不传参数，默认是用户划线
  }

  closeAIQuick();

  // 打开侧边栏面板显示对话（跳过历史加载，因为要显示新消息）
  openAIPanel(true);
  addAIMessage('user', comment || text, comment ? text : '');
  addAIMessage('ai-loading', '正在接收回复 ···', '');

  // 调用 Bridge 发送
  if (window.CoreadBridge && window.CoreadBridge.sendToAI) {
    try {
      window.CoreadBridge.sendToAI(JSON.stringify({
        selectedText: text,
        bookTitle: currentBookTitle || '',
        chapterTitle: chapters[currentIdx] ? (chapters[currentIdx].title || '') : '',
        comment: comment
      }));
    } catch(e) {
      removeLoadingMessage();
      addAIMessage('ai', '桥接调用异常: ' + e, '');
    }
  } else {
    removeLoadingMessage();
    addAIMessage('ai', '桥接未就绪，请重新打开 CoRead。', '');
  }
}

window.openAIPanel = openAIPanel;
window.closeAIPanel = closeAIPanel;
window.toggleAIPanel = toggleAIPanel;
window.sendSelectionToAI = sendSelectionToAI;
window.sendAIFollowUp = sendAIFollowUp;
window.askAIAboutSelection = askAIAboutSelection;
window.closeAIQuick = closeAIQuick;
window.submitAIQuick = submitAIQuick;

})();

