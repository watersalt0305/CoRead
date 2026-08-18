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
      coverInner = '<div class="cover-spine">' + (book.title || '').substring(0, 6) + '</div>';
    }

    var isReading = localStorage.getItem('cr_last_book') === String(book.id);
    card.innerHTML = (isReading ? '<div class="badge-reading">READING</div>' : '') +
      '<div class="book-cover" style="' + coverStyle + '">' + coverInner + '</div>' +
      '<div class="book-title">' + (book.title || '未知') + '</div>' +
      '<div class="book-author">' + (book.author || '') + '</div>';

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
    var text = ev.target.result;
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
  reader.readAsText(file);
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
    if (!book) { showToast('书籍数据丢失'); return; }
    currentBookId = bookId;
    currentBookTitle = book.title;
    localStorage.setItem('cr_last_book', String(bookId));

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
  var html = text
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

// ============ 加载章节 ============
function loadChapter(idx, restoreScroll) {
  if (idx < 0 || idx >= chapters.length) return Promise.resolve();
  currentIdx = idx;
  var ch = chapters[idx];
  var pageText = $('pageText');
  pageText.innerHTML = '';

  return epubZip.file(ch.fullPath).async('text').then(function(raw) {
    var d = document.createElement('div');
    d.innerHTML = raw;
    var base = ch.fullPath.indexOf('/') >= 0 ? ch.fullPath.substring(0, ch.fullPath.lastIndexOf('/') + 1) : '';

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
      var target = content.scrollTop - content.clientHeight * 0.9;
      if (target < 0 && currentIdx > 0) {
        loadChapterAuto(currentIdx - 1, 999999);
      } else {
        content.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
      }
    }
    // 右侧 70%：下一页
    else {
      var maxScroll = content.scrollHeight - content.clientHeight;
      var target2 = content.scrollTop + content.clientHeight * 0.9;
      if (target2 >= maxScroll && currentIdx < chapters.length - 1) {
        loadChapterAuto(currentIdx + 1, 0);
      } else {
        content.scrollTo({ top: target2, behavior: 'smooth' });
      }
    }
  });

  // --- 左右滑动唤醒/关闭工具栏（document 级别，绝对不被吞） ---
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

  document.addEventListener('touchend', function(e) {
    // 只在阅读器打开时生效
    if (!$('readerOverlay').classList.contains('active')) return;
    // 不拦截工具栏/面板内的触摸
    var t = e.target;
    if (t.closest && (t.closest('.reader-topbar') || t.closest('.reader-bottombar') || t.closest('.toc-panel'))) return;
    var dt = Date.now() - _swTime;
    if (dt > 400) return;
    var touch = e.changedTouches[0];
    var dx = touch.clientX - _swX;
    var dy = Math.abs(touch.clientY - _swY);
    // 需要横向 60px+ 且横向明显大于纵向
    if (Math.abs(dx) > 60 && Math.abs(dx) > dy * 2) {
      toggleReaderUI();
      if (readerUIVisible) startAutoHide();
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
  saveProgress(); // 必须在隐藏 overlay 之前保存，否则 scrollTop 会被重置为 0
  $('readerOverlay').classList.remove('active');
  refreshLibrary();
}

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
    item.innerHTML = '<span class="ch-name">' + (chapters[i].title || 'Chapter ' + (i + 1)) + '</span><span class="ch-idx">' + (i + 1) + '</span>';
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

// 禁用系统长按菜单（复制/分享/全选/搜索）
document.addEventListener('contextmenu', function(e) { e.preventDefault(); return false; });
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

function doHighlight() {
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
  try {
    pendingRange.surroundContents(mark);
  } catch (e) {
    var frag = pendingRange.extractContents();
    mark.appendChild(frag);
    pendingRange.insertNode(mark);
  }

  window.getSelection().removeAllRanges();
  saveHighlights();
  showToast('已划线');

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

// 保存所有高亮（合并相邻同样式 mark，存文本 + 样式 + 颜色 + 章节索引）
function saveHighlights() {
  if (!currentBookId) return;
  var marks = $('pageText').querySelectorAll('.cr-highlight');
  var items = [];
  
  for (var i = 0; i < marks.length; i++) {
    var cls = marks[i].className.replace('cr-highlight', '').trim();
    var color = marks[i].getAttribute('data-color') || '';
    var text = marks[i].textContent;
    
    // 合并相邻且样式+颜色相同的 mark（处理跨标签划线被拆分的情况）
    var prev = items.length > 0 ? items[items.length - 1] : null;
    if (prev && prev.style === cls && prev.color === color) {
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
    
    items.push({ text: text, style: cls, color: color });
  }
  
  var key = 'cr_hl_' + currentBookId + '_' + currentIdx;
  localStorage.setItem(key, JSON.stringify(items));

  // 全书批注汇总
  var allKey = 'cr_hl_all_' + currentBookId;
  var all = JSON.parse(localStorage.getItem(allKey) || '{}');
  all[currentIdx] = items.map(function(item) {
    return { text: item.text, style: item.style, color: item.color, chapter: currentIdx, chapterTitle: chapters[currentIdx] ? chapters[currentIdx].title : '', time: Date.now() };
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

  var pageText = $('pageText');

  items.forEach(function(item) {
    var text = typeof item === 'string' ? item : item.text;
    var style = typeof item === 'string' ? '' : (item.style || '');
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
  $('notePopup').classList.remove('active');
  showToast(noteText ? '批注已保存' : '批注已清除');
}

function closeNote() {
  $('notePopup').classList.remove('active');
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
      filterDiv.innerHTML += '<button class="notes-filter-btn" data-book="' + book.bookId + '">' + (book.title || '').substring(0, 8) + '</button>';
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
    Object.keys(book.data).forEach(function(chIdx) {
      var items = book.data[chIdx];
      if (!Array.isArray(items)) return;
      items.forEach(function(item) {
        var noteKey = chIdx + ':' + (item.text || '').substring(0, 50);
        allItems.push({
          text: item.text || '',
          style: item.style || '',
          color: item.color || '',
          chapter: item.chapterTitle || 'Ch.' + (parseInt(chIdx) + 1),
          note: notes[noteKey] || '',
          time: item.time || 0,
          bookId: book.bookId,
          bookTitle: book.title
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

    var colorStyle = item.color ? ' style="border-left-color:' + item.color + '"' : '';

    var noteHtml = item.note
      ? '<div class="note-card-comment">' + item.note.replace(/</g, '<').replace(/\n/g, '<br>') + '</div>'
      : '';

    var timeStr = '';
    if (item.time) {
      var d = new Date(item.time);
      timeStr = (d.getMonth() + 1) + '/' + d.getDate() + ' ' + d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0');
    }

    card.innerHTML =
      '<div class="note-card-quote' + (item.style ? ' ' + item.style : '') + '"' + colorStyle + '>' + item.text.replace(/</g, '<') + '</div>' +
      noteHtml +
      '<div class="note-card-meta"><span>' + item.chapter + '</span><span class="note-card-book">' + item.bookTitle + '</span><span>' + timeStr + '</span></div>';

    wrap.appendChild(card);
  });
}

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
  var html = text
    .replace(/</g, '<')
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
    // 首个 chunk：移除 loading，创建 AI 消息气泡
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
  __streamingMsgEl.innerHTML = renderMd(__streamingText);
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

// Bridge 回调：配置推送 + 空配置检测弹窗
window.__coreadSetConfig = function(jsonStr) {
  try {
    var cfg = JSON.parse(jsonStr);
    var valEl = $('valChatId');
    if (cfg.chatId && cfg.chatId.length >= 30) {
      // 有效 chatId
      if (valEl) valEl.textContent = cfg.chatId.substring(0, 8) + '...';
    } else if (cfg.chatId && cfg.chatId.length > 0) {
      // 非空但不合法
      if (valEl) valEl.textContent = '配置有误';
      var hint = 'chat_id 格式不合法';
      if (cfg.chatId.length < 30) hint += '（当前长度 ' + cfg.chatId.length + '，标准 UUID 应为 36 位）';
      else if (cfg.chatId.length > 40) hint += '（过长，请检查是否多复制了内容）';
      hint += '。请重新配置。';
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
  var desc = extraMsg || '请在 Operit 对话中告诉 AI「帮我配置 CoRead」或使用工具 <code style="background:var(--bg-1);padding:2px 4px;border-radius:3px;">coread_config:set_coread_config</code> 设置 chat_id。';
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

function askAIAboutSelection() {
  var sel = window.getSelection();
  var text = sel ? sel.toString().trim() : '';
  if (!text && pendingRange) text = pendingRange.toString().trim();
  if (!text) return;

  aiQuickText = text;
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
}

function submitAIQuick() {
  var comment = $('aiQuickInput').value.trim();
  var shouldHighlight = $('aiQuickHighlight').checked;
  var text = aiQuickText;
  
  if (!text) { closeAIQuick(); return; }

  // 同时划线标记
  if (shouldHighlight && pendingRange) {
    doHighlight();
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
