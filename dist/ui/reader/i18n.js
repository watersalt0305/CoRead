// CoRead — EPUB / TXT / MD Reader + AI Co-Read
// Copyright (C) 2025 Mishio / 三岛尾 (watersalt0305) & Claude
// SPDX-License-Identifier: AGPL-3.0-or-later

// === CoRead i18n ===
// 用法：_t('key') / _t('key', {n: 3})，词条内 {n} 会被替换
// HTML 静态文案：data-i18n="key"（textContent）/ data-i18n-ph="key"（placeholder）/ data-i18n-title="key"（title）

(function() {
'use strict';

var DICT = { zh: {}, en: {} };

// 批量注册词条：_i18nAdd({ key: ['中文', 'English'], ... })
function add(map) {
  for (var k in map) {
    if (!map.hasOwnProperty(k)) continue;
    DICT.zh[k] = map[k][0];
    DICT.en[k] = map[k][1];
  }
}

function detectLang() {
  try {
    var saved = localStorage.getItem('cr-lang');
    if (saved === 'zh' || saved === 'en') return saved;
  } catch(e) {}
  var nav = String((navigator.languages && navigator.languages[0]) || navigator.language || 'zh').toLowerCase();
  return nav.indexOf('zh') === 0 ? 'zh' : 'en';
}

var LANG = detectLang();

function _t(key, params) {
  var s = DICT[LANG][key];
  if (s === undefined) s = DICT.zh[key];
  if (s === undefined) return key;
  if (params) {
    s = s.replace(/\{(\w+)\}/g, function(m, p) {
      return params[p] !== undefined ? String(params[p]) : m;
    });
  }
  return s;
}

function applyI18n(root) {
  root = root || document;
  var nodes = root.querySelectorAll('[data-i18n]');
  for (var i = 0; i < nodes.length; i++) nodes[i].textContent = _t(nodes[i].getAttribute('data-i18n'));
  nodes = root.querySelectorAll('[data-i18n-ph]');
  for (i = 0; i < nodes.length; i++) nodes[i].setAttribute('placeholder', _t(nodes[i].getAttribute('data-i18n-ph')));
  nodes = root.querySelectorAll('[data-i18n-title]');
  for (i = 0; i < nodes.length; i++) nodes[i].setAttribute('title', _t(nodes[i].getAttribute('data-i18n-title')));
  document.documentElement.lang = LANG === 'zh' ? 'zh' : 'en';
  var pills = document.querySelectorAll('[data-lang-pill]');
  for (i = 0; i < pills.length; i++) {
    pills[i].classList.toggle('active', pills[i].getAttribute('data-lang-pill') === LANG);
  }
}

function setLang(lang) {
  if (lang !== 'zh' && lang !== 'en') return;
  LANG = lang;
  try { localStorage.setItem('cr-lang', lang); } catch(e) {}
  applyI18n();
  // 通知 reader.js 重绘动态内容（书架/批注等）
  try { window.dispatchEvent(new CustomEvent('cr-lang-change', { detail: lang })); } catch(e) {}
}

window._t = _t;
window._i18nAdd = add;
window.applyI18n = applyI18n;
window.setLang = setLang;
window.getLang = function() { return LANG; };

})();
