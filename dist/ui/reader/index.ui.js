// CoRead — EPUB / TXT / MD Reader + AI Co-Read
// Copyright (C) 2025 Mishio / 三岛尾 (watersalt0305) & Claude
// SPDX-License-Identifier: AGPL-3.0-or-later

"use strict";

Object.defineProperty(exports, "__esModule", { value: true });
exports.default = Screen;

// ============ 配置常量 ============
var READER_DIR = "/sdcard/Download/Operit/CoRead2/reader";
var READER_HTML_URL = "file://" + READER_DIR + "/reader.html?v=" + Date.now();
var BRIDGE_NAME = "CoreadBridge";
var CONFIG_FILE = "/sdcard/Download/Operit/CoRead2/_coread_config.json";
var MAX_HISTORY = 100;
var CONTEXT_RESTORE_COUNT = 8;

// ============ 提示词模板（按语言） ============
// 占位符：{bookTitle} {chapter} {text} {comment} {history}
// 预留：下个版本可从配置读取用户自定义模板覆盖这里的默认值
var PROMPT_TEMPLATES = {
    zh: {
        header:      "【CoRead】正在阅读《{bookTitle}》",
        chapter:     " - {chapter}",
        selection:   "\n\n{user}选中了这段文字：\n> {text}",
        withComment: "\n\n{user}的想法/问题：{comment}",
        noComment:   "\n\n请帮忙分析或讨论这段内容。",
        restore:     "【CoRead 上下文恢复】你之前和{user}讨论过《{bookTitle}》：\n{history}\n\n请继续讨论：\n\n",
        hSelected:   "选中: ",
        hAsked:      "问: ",
        hAI:         "AI: ",
        unknownBook: "当前书籍"
    },
    en: {
        header:      "[CoRead] Reading \u201C{bookTitle}\u201D",
        chapter:     " - {chapter}",
        selection:   "\n\n{User} selected this passage:\n> {text}",
        withComment: "\n\n{User}'s thought/question: {comment}",
        noComment:   "\n\nPlease analyze or discuss this passage.",
        restore:     "[CoRead context restore] You previously discussed \u201C{bookTitle}\u201D with {user}:\n{history}\n\nPlease continue the discussion:\n\n",
        hSelected:   "Selected: ",
        hAsked:      "Asked: ",
        hAI:         "AI: ",
        unknownBook: "the current book"
    }
};

var MSG = {
    zh: {
        noText:      "没有选中文字",
        noChatId:    "⚠️ 未配置对话 ID。请在设置页面填写 chat_id。",
        noChatIdErr: "未配置 chat_id",
        sendFail:    "发送失败: ",
        fail:        "失败: ",
        emptyMsg:    "空消息",
        badBook:     "缺少书籍信息或 bookId 非法"
    },
    en: {
        noText:      "No text selected",
        noChatId:    "⚠️ No chat ID configured. Ask the AI to set chat_id via coread2_config:set_coread_config.",
        noChatIdErr: "chat_id not configured",
        sendFail:    "Send failed: ",
        fail:        "Failed: ",
        emptyMsg:    "Empty message",
        badBook:     "Missing book info or invalid bookId"
    }
};

function normLang(lang) { return lang === "en" ? "en" : "zh"; }

// ============ 共读称呼 ============
// persona: { mode: "user" | "me" | "name", name: "..." }，缺省 = user（与旧版一致）
// "me" 模式人称结构不同（我的想法 / My thought），不能靠替换名字实现，单独一套覆盖字段
var PROMPT_ME = {
    zh: {
        selection:   "\n\n我选中了这段文字：\n> {text}",
        withComment: "\n\n我的想法/问题：{comment}",
        noComment:   "\n\n请帮我分析或讨论这段内容。",
        restore:     "【CoRead 上下文恢复】你之前和我讨论过《{bookTitle}》：\n{history}\n\n请继续讨论：\n\n"
    },
    en: {
        selection:   "\n\nI selected this passage:\n> {text}",
        withComment: "\n\nMy thought/question: {comment}",
        noComment:   "\n\nPlease help me analyze or discuss this passage.",
        restore:     "[CoRead context restore] You previously discussed \u201C{bookTitle}\u201D with me:\n{history}\n\nPlease continue the discussion:\n\n"
    }
};
var PERSONA_DEFAULT = { zh: { user: "用户", User: "用户" }, en: { user: "the user", User: "The user" } };

function sanitizePersonaName(n) {
    return String(n || "").replace(/[\r\n\t{}]/g, " ").replace(/\s+/g, " ").trim().substring(0, 24);
}

// 返回 { P: 合并后的模板, user, User }
function resolvePrompt(lang, persona) {
    lang = normLang(lang);
    var base = PROMPT_TEMPLATES[lang];
    var p = asRecordSafe(persona);
    var mode = p.mode;
    var name = sanitizePersonaName(p.name);
    if (mode === "me") {
        var P = {};
        for (var k in base) P[k] = base[k];
        var o = PROMPT_ME[lang];
        for (var k2 in o) P[k2] = o[k2];
        return { P: P, user: "", User: "" };
    }
    if (mode === "name" && name) return { P: base, user: name, User: name };
    var d = PERSONA_DEFAULT[lang];
    return { P: base, user: d.user, User: d.User };
}

function asRecordSafe(v) {
    if (!v) return {};
    if (typeof v === "string") { try { v = JSON.parse(v); } catch (e) { return {}; } }
    return (typeof v === "object") ? v : {};
}

function fillTpl(tpl, vars) {
    return String(tpl).replace(/\{(\w+)\}/g, function(m, k) {
        return vars[k] !== undefined ? String(vars[k]) : m;
    });
}

// ============ 内存状态 ============
var __chatId = "";
var __cardName = "";
var __currentBookId = "";
var __lastUsedChatId = "";
var __localHistory = [];
var __historyLoaded = false;   // 区分"历史尚未异步加载完"与"加载完但为空"
var __chatSwitchAt = 0;        // 记录 chatId 切换时刻：恢复摘要只包含此前的历史，防止把新对话里刚产生的记录回灌
var __aiNotesCache = {};  // bookId -> AI批注缓存（异步预加载）

// ============ 工具函数 ============
function unwrap(value) {
    if (Array.isArray(value)) return value[0];
    return value;
}

function asRecord(value) {
    if (typeof value === "string") {
        try { value = JSON.parse(value); } catch(e) {}
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return value;
}

function cleanReply(text) {
    if (!text) return "";
    text = String(text);
    text = text.replace(/<think>[\s\S]*?<\/think>/gi, "");
    text = text.replace(/<tool[\s\S]*?<\/tool[^>]*>/gi, "");
    text = text.replace(/<tool_result[\s\S]*?<\/tool_result[^>]*>/gi, "");
    var ti = text.indexOf("<tool ");
    if (ti > 0) text = text.substring(0, ti);
    text = text.replace(/\n{3,}/g, "\n\n");
    return text.trim();
}

// 从结果中提取 AI 回复文本
function extractReply(result) {
    var r = result;
    if (typeof r === "string") { try { r = JSON.parse(r); } catch(e) {} }
    return (r && r.aiResponse) ||
           (r && r.data && r.data.aiResponse) ||
           (r && r.data && r.data.result && r.data.result.aiResponse) ||
           (r && r.data && r.data.result && r.data.result.reply) ||
           (r && r.result && r.result.aiResponse) ||
           (r && r.data && r.data.reply) ||
           (r && r.response) || "";
}

// 生成上下文恢复摘要（cutoff：只收录该时间点之前的历史，避免把新对话中产生的记录当旧上下文）
function buildContextSummary(bookTitle, cutoff, lang, persona) {
    var R = resolvePrompt(lang, persona);
    var P = R.P;
    var pool = __localHistory;
    if (cutoff) {
        pool = pool.filter(function(e) { return !e.timestamp || e.timestamp < cutoff; });
    }
    if (pool.length === 0) return "";
    // 追问场景可能拿不到书名，从历史里兜底找一个
    if (!bookTitle) {
        for (var j = pool.length - 1; j >= 0; j--) {
            if (pool[j].bookTitle) { bookTitle = pool[j].bookTitle; break; }
        }
        if (!bookTitle) bookTitle = P.unknownBook;
    }
    var recent = pool.slice(-CONTEXT_RESTORE_COUNT);
    var lines = [];
    for (var i = 0; i < recent.length; i++) {
        var entry = recent[i];
        var summary = "";
        if (entry.selectedText) summary += P.hSelected + "\"" + entry.selectedText.substring(0, 60) + (entry.selectedText.length > 60 ? "...\"" : "\"");
        if (entry.comment) summary += (summary ? " " : "") + P.hAsked + entry.comment.substring(0, 40) + (entry.comment.length > 40 ? "..." : "");
        if (entry.aiReply) summary += (summary ? " " : "") + P.hAI + entry.aiReply.substring(0, 80) + (entry.aiReply.length > 80 ? "..." : "");
        if (summary) lines.push((i + 1) + ". " + summary);
    }
    if (lines.length === 0) return "";
    return fillTpl(P.restore, { bookTitle: bookTitle, history: lines.join("\n"), user: R.user, User: R.User });
}

// ============ 文件 IO ============
var DATA_ROOT = "/sdcard/Download/Operit/CoRead2";

// book_id 白名单校验：只允许字母/数字/下划线/连字符/点，防止路径穿越
function sanitizeBookId(bookId) {
    var id = String(bookId || "").trim();
    if (!id || id.length > 128) return "";
    if (!/^[A-Za-z0-9._-]+$/.test(id)) return "";
    if (id === "." || id === "..") return "";
    return id;
}

async function ensureDir() {
    try {
        await Tools.Files.write(DATA_ROOT + "/.keep", "");
    } catch(e) {}
}

async function loadConfig() {
    try {
        var result = await Tools.Files.read(CONFIG_FILE);
        if (result && result.content) {
            var cfg = JSON.parse(result.content);
            if (cfg.chatId) __chatId = cfg.chatId;
            if (cfg.cardName) __cardName = cfg.cardName;
            // 恢复上次实际使用的 chatId：与当前配置不同说明用户换过对话，
            // 该差异必须活过插件重开，否则 boot 里一同步就永远不触发上下文恢复
            if (cfg.lastUsedChatId) __lastUsedChatId = cfg.lastUsedChatId;
        }
    } catch(e) {}
}

async function saveConfig() {
    try {
        var data = JSON.stringify({ chatId: __chatId, cardName: __cardName, lastUsedChatId: __lastUsedChatId || __chatId }, null, 2);
        await Tools.Files.write(CONFIG_FILE, data);
    } catch(e) {}
}

async function loadHistory(bookId) {
    if (!bookId) { __historyLoaded = true; return; }
    var safe = sanitizeBookId(bookId);
    if (!safe) { __historyLoaded = true; return; }
    __historyLoaded = false;
    __localHistory = [];
    var historyFile = DATA_ROOT + "/_coread_history_" + safe + ".json";
    try {
        var result = await Tools.Files.read(historyFile);
        if (result && result.content) {
            var arr = JSON.parse(result.content);
            if (Array.isArray(arr)) __localHistory = arr;
        }
    } catch(e) {}
    // 读取失败/文件不存在也算"加载完成"——此时历史确实为空，可以放心消费恢复标志
    __historyLoaded = true;
}

// 统一的上下文恢复入口：sendToAI 与 sendFollowUp 都走这里
// 返回需要拼在消息前面的恢复前缀（可能为空串）
function maybeBuildRestorePrefix(bookTitle, lang, persona) {
    if (__lastUsedChatId === __chatId) return "";
    // 首次检测到 chatId 切换：记下时刻，之后新对话里产生的历史不会被当作旧上下文回灌
    if (!__chatSwitchAt) __chatSwitchAt = Date.now();
    // 历史尚未异步加载完成：本次不注入也不消费标志，待加载完成后下次发送再触发
    if (!__historyLoaded) return "";
    var summary = buildContextSummary(bookTitle, __chatSwitchAt, lang, persona);
    // 历史已加载完毕即消费标志：摘要为空说明确实没有可恢复的内容，不该让标志一直悬着
    __lastUsedChatId = __chatId;
    __chatSwitchAt = 0;
    saveConfig(); // 持久化 lastUsedChatId，避免重开插件后重复注入
    return summary;
}

async function saveHistory() {
    if (!__currentBookId) return;
    var safe = sanitizeBookId(__currentBookId);
    if (!safe) return;
    var historyFile = DATA_ROOT + "/_coread_history_" + safe + ".json";
    try {
        if (__localHistory.length > MAX_HISTORY) __localHistory = __localHistory.slice(-MAX_HISTORY);
        await Tools.Files.write(historyFile, JSON.stringify(__localHistory));
    } catch(e) {}
}

// 异步预加载某本书的 AI 批注到内存缓存，并推送给 WebView
async function preloadAINotes(bookId) {
    if (!bookId) return;
    // 安全整改：bookId 白名单校验，防止路径穿越
    var safe = sanitizeBookId(bookId);
    if (!safe) return;
    var notesFile = "/sdcard/Download/Operit/CoRead2/_coread_notes_" + safe + ".json";
    try {
        var r = await Tools.Files.read(notesFile);
        if (r && r.content) {
            __aiNotesCache[safe] = JSON.parse(r.content);
            try {
                controller && controller.evaluateJavascript(
                    "window.__coreadAINotesLoaded && window.__coreadAINotesLoaded(" +
                    JSON.stringify(JSON.stringify(__aiNotesCache[safe])) + ")"
                );
            } catch(e) {}
        }
    } catch(e) {}
}

// ============ Screen 函数 ============
function Screen(ctx) {
    var UI = ctx.UI;
    var controller = ctx.createWebViewController("coread2_webview");

    var _init = ctx.useState("initialized", false);
    var initialized = _init[0];
    var setInitialized = _init[1];

    function registerBridge() {
        controller.removeJavascriptInterface(BRIDGE_NAME);

        var bridgeObj = {
            // WebView 调用：发送选中文字给 AI
            sendToAI: function() {
                var payload = asRecord(unwrap(arguments[0]));
                var text = String(payload.selectedText || payload.text || "").trim();
                var bookTitle = String(payload.bookTitle || "").trim();
                var chapterTitle = String(payload.chapterTitle || "").trim();
                var comment = String(payload.comment || "").trim();
                var lang = normLang(payload.lang);
                var R = resolvePrompt(lang, payload.persona);
                var P = R.P;
                var M = MSG[lang];

                if (!text) return { ok: false, error: M.noText };
                if (!__chatId) {
                    controller.evaluateJavascript(
                        "window.__coreadAIReply && window.__coreadAIReply(" +
                        JSON.stringify(M.noChatId) + ")"
                    );
                    return { ok: false, error: M.noChatIdErr };
                }

                // 构造消息（chatId 切换后首条消息注入上下文恢复摘要，逻辑见 maybeBuildRestorePrefix）
                var message = maybeBuildRestorePrefix(bookTitle, lang, payload.persona);

                var vars = { bookTitle: bookTitle, chapter: chapterTitle, text: text.replace(/\n/g, "\n> "), comment: comment, user: R.user, User: R.User };
                message += fillTpl(P.header, vars);
                if (chapterTitle) message += fillTpl(P.chapter, vars);
                message += fillTpl(P.selection, vars);
                message += comment ? fillTpl(P.withComment, vars) : fillTpl(P.noComment, vars);

                // 异步调用（流式传输）
                setTimeout(function() {
                    try {
                        var streamOpts = {
                            persist_turn: true,
                            notify_reply: false,
                            hide_user_message: true,
                            disable_warning: true,
                            timeout_ms: 300000,
                            onIntermediateResult: function(event) {
                                if (event && event.type === "chunk" && event.chunk) {
                                    // 逐 chunk 推回 WebView
                                    try {
                                        controller.evaluateJavascript(
                                            "window.__coreadAIChunk && window.__coreadAIChunk(" + JSON.stringify(event.chunk) + ")"
                                        );
                                    } catch(e2) {}
                                }
                            }
                        };

                        var p = Tools.Chat.sendMessageStreaming(
                            message,
                            __chatId,
                            undefined,
                            undefined,
                            streamOpts
                        );

                        if (p && typeof p.then === "function") {
                            p.then(function(result) {
                                // 流式完成，发送结束信号
                                var finalReply = "";
                                try {
                                    if (result && result.aiResponse) finalReply = result.aiResponse;
                                    else if (result && result.response) finalReply = result.response;
                                } catch(e) {}
                                finalReply = cleanReply(finalReply);

                                // 存本地历史
                                __localHistory.push({
                                    timestamp: Date.now(),
                                    bookTitle: bookTitle,
                                    chapterTitle: chapterTitle,
                                    selectedText: text,
                                    comment: comment,
                                    aiReply: finalReply
                                });
                                saveHistory();

                                // 通知 WebView 流式结束
                                controller.evaluateJavascript(
                                    "window.__coreadAIDone && window.__coreadAIDone(" + JSON.stringify(finalReply) + ")"
                                );
                            }).catch(function(e) {
                                controller.evaluateJavascript(
                                    "window.__coreadAIReply && window.__coreadAIReply(" + JSON.stringify(M.sendFail + String(e)) + ")"
                                );
                            });
                        }
                    } catch(e) {}
                }, 100);

                return { ok: true };
            },

            // 追问（流式）
            sendFollowUp: function() {
                var payload = asRecord(unwrap(arguments[0]));
                var msg = String(payload.message || "").trim();
                var lang = normLang(payload.lang);
                var M = MSG[lang];
                if (!msg) return { ok: false, error: M.emptyMsg };
                if (!__chatId) return { ok: false, error: M.noChatIdErr };

                // 追问同样需要上下文恢复：否则切换 chatId 后先追问，新对话完全不知道在聊什么
                var outMsg = maybeBuildRestorePrefix("", lang, payload.persona) + msg;

                setTimeout(function() {
                    try {
                        var streamOpts = {
                            persist_turn: true,
                            notify_reply: false,
                            hide_user_message: true,
                            disable_warning: true,
                            timeout_ms: 300000,
                            onIntermediateResult: function(event) {
                                if (event && event.type === "chunk" && event.chunk) {
                                    try {
                                        controller.evaluateJavascript(
                                            "window.__coreadAIChunk && window.__coreadAIChunk(" + JSON.stringify(event.chunk) + ")"
                                        );
                                    } catch(e2) {}
                                }
                            }
                        };

                        var p = Tools.Chat.sendMessageStreaming(outMsg, __chatId, undefined, undefined, streamOpts);
                        if (p && typeof p.then === "function") {
                            p.then(function(result) {
                                var finalReply = "";
                                try {
                                    if (result && result.aiResponse) finalReply = result.aiResponse;
                                    else if (result && result.response) finalReply = result.response;
                                } catch(e) {}
                                finalReply = cleanReply(finalReply);

                                __localHistory.push({
                                    timestamp: Date.now(),
                                    bookTitle: "",
                                    chapterTitle: "",
                                    selectedText: "",
                                    comment: msg,
                                    aiReply: finalReply
                                });
                                saveHistory();

                                controller.evaluateJavascript(
                                    "window.__coreadAIDone && window.__coreadAIDone(" + JSON.stringify(finalReply) + ")"
                                );
                            }).catch(function(e) {
                                controller.evaluateJavascript(
                                    "window.__coreadAIReply && window.__coreadAIReply(" + JSON.stringify(M.fail + String(e)) + ")"
                                );
                            });
                        }
                    } catch(e) {}
                }, 50);
                return { ok: true };
            },

            // 加载本地历史
            loadHistory: function() {
                setTimeout(function() {
                    // 确保已加载当前书的历史
                    var historyPromise = __currentBookId ? loadHistory(__currentBookId) : Promise.resolve();
                    
                    historyPromise.then(function() {
                        try {
                            var escaped = JSON.stringify(JSON.stringify(__localHistory.slice(-50)));
                            controller.evaluateJavascript(
                                "window.__coreadLoadHistory && window.__coreadLoadHistory(" + escaped + ")"
                            );
                        } catch(e) {}
                    }).catch(function(e) {});
                }, 50);
                return { ok: true };
            },

            // 保存配置
            saveConfig: function() {
                var payload = asRecord(unwrap(arguments[0]));
                if (payload.chatId !== undefined) __chatId = String(payload.chatId || "");
                if (payload.cardName !== undefined) __cardName = String(payload.cardName || "");
                saveConfig();
                return { ok: true };
            },

            // 获取配置
            getConfig: function() {
                return { chatId: __chatId, cardName: __cardName };
            },
            
            // 通知打开了新书（加载该书的历史）
            onBookOpened: function() {
                var payload = asRecord(unwrap(arguments[0]));
                // 安全整改：bookId 白名单校验，防止路径穿越
                var bookId = sanitizeBookId(payload.bookId);
                var bookTitle = String(payload.bookTitle || "");
                
                if (!bookId || !bookTitle) return { ok: false, error: MSG.zh.badBook + " / " + MSG.en.badBook };
                
                __currentBookId = bookId;
                // 不重置 __lastUsedChatId，只在真正切换对话时才注入

                // 异步加载该书的历史 + 预加载 AI 批注
                setTimeout(function() {
                    Promise.all([
                        loadHistory(bookId),
                        preloadAINotes(bookId)
                    ]).then(function() {
                        // 通知 WebView 历史已加载
                        try {
                            controller.evaluateJavascript(
                                "window.__coreadBookSwitched && window.__coreadBookSwitched()"
                            );
                        } catch(e) {}
                    }).catch(function(e) {});
                }, 100);
                
                return { ok: true };
            },

            // 心跳
            ping: function() {
                return { ok: true, bridge: BRIDGE_NAME, time: new Date().toISOString() };
            },
            // 导出划线数据写文件（由 WebView 内 JS 调用）
            __saveExport: function() {
                var data = String(arguments[0] || "");
                if (data && data.indexOf("currentBookId") !== -1) {
                    try {
                        Tools.Files.write("/sdcard/Download/Operit/CoRead2/_coread_highlights_export.json", data);
                    } catch(e) {}
                }
            },

            // 保存批注分享卡片图片（base64 PNG dataURL，由 WebView 内 Canvas 生成）
            // 返回 { ok, path?, error? }；WebView 端据此决定是否提示"已自动保存"
            saveShareCard: function() {
                var dataUrl = String(arguments[0] || "");
                if (!dataUrl) return JSON.stringify({ ok: false, error: "empty dataUrl" });
                try {
                    var b64 = dataUrl.indexOf(",") >= 0 ? dataUrl.substring(dataUrl.indexOf(",") + 1) : dataUrl;
                    var ts = new Date();
                    var pad2 = function(n) { return (n < 10 ? '0' : '') + n; };
                    var fname = DATA_ROOT + "/CoRead_" +
                        ts.getFullYear() + pad2(ts.getMonth()+1) + pad2(ts.getDate()) + "_" +
                        pad2(ts.getHours()) + pad2(ts.getMinutes()) + pad2(ts.getSeconds()) + ".png";

                    // Java Bridge：解码 base64 → 二进制写入
                    var JBase64 = Java.use("android.util.Base64");
                    var JFOS = Java.use("java.io.FileOutputStream");
                    var bytes = JBase64.decode(b64, 0); // 0 = DEFAULT
                    if (!bytes || bytes.length === 0) return JSON.stringify({ ok: false, error: "decode failed (0 bytes)" });
                    var fos = JFOS.newInstance(fname);
                    fos.write(bytes);
                    fos.close();
                    return JSON.stringify({ ok: true, path: fname });
                } catch(e) {
                    return JSON.stringify({ ok: false, error: String(e && e.message || e) });
                }
            },

            // 读取 AI 批注（由 WebView 调用）：从内存缓存读取（异步加载见 onBookOpened）
            getAINotes: function() {
                var bookId = String(arguments[0] || "");
                if (!bookId) return { ok: false, notes: {} };
                var cached = __aiNotesCache[bookId];
                if (cached) return { ok: true, notes: cached };
                return { ok: true, notes: {} };
            }
        };

        controller.addJavascriptInterface(BRIDGE_NAME, bridgeObj);
    }

    // 导出划线数据到文件（供 AI 工具子包读取）
    function exportHighlightsToFile() {
        var EXPORT_FILE = "/sdcard/Download/Operit/CoRead2/_coread_highlights_export.json";
        try {
            controller.evaluateJavascript(
                "(function() {" +
                "  var result = { currentBookId: '', books: {}, notes: {} };" +
                "  try { result.currentBookId = localStorage.getItem('cr_last_book') || ''; } catch(e) {}" +
                "  try { result.currentBookTitle = window.currentBookTitle || ''; } catch(e) {}" +
                "  for (var i = 0; i < localStorage.length; i++) {" +
                "    var k = localStorage.key(i);" +
                "    if (k && k.indexOf('cr_hl_all_') === 0) {" +
                "      var bid = k.replace('cr_hl_all_', '');" +
                "      try {" +
                "        result.books[bid] = { highlights: JSON.parse(localStorage.getItem(k) || '{}'), title: (bid === result.currentBookId ? (window.currentBookTitle || '') : '') };" +
                "        var notes = localStorage.getItem('cr_notes_' + bid);" +
                "        if (notes) result.notes[bid] = JSON.parse(notes);" +
                "      } catch(e) {}" +
                "    }" +
                "  }" +
                "  if (window.CoreadBridge && window.CoreadBridge.__saveExport) {" +
                "    window.CoreadBridge.__saveExport(JSON.stringify(result));" +
                "  }" +
                "})()"
            );
        } catch(e) {}
    }

    async function boot() {
        if (initialized) return;
        setInitialized(true);

        // 先注册桥接：addJavascriptInterface 只对注册后加载的页面生效，
        // 必须在 loadUrl 之前完成，否则页面里 window.CoreadBridge 为 undefined（"桥接未就绪"）
        registerBridge();

        await ensureDir();

        // 释放资源文件到 reader 目录（同步完成后再加载 WebView）
        try {
            var keys = ["reader_html", "reader_css", "reader_js", "jszip_js", "i18n_js", "i18n_dict_js"];
            var names = ["reader.html", "reader.css", "reader.js", "jszip.min.js", "i18n.js", "i18n_dict.js"];
            for (var i = 0; i < keys.length; i++) {
                var resPath = await ToolPkg.readResource(keys[i]);
                if (resPath) {
                    var content = await Tools.Files.read(resPath);
                    if (content && content.content !== undefined) {
                        await Tools.Files.write(READER_DIR + "/" + names[i], content.content);
                    }
                }
            }
        } catch(e) {}

        // 资源就位后加载页面
        controller.loadUrl(READER_HTML_URL);

        await loadConfig();
        // 注意：这里不再无条件 __lastUsedChatId = __chatId。
        // lastUsedChatId 已从配置文件恢复（loadConfig）；若配置文件里没有该字段
        // （老版本配置/首次安装），才视为"上次用的就是当前配置的对话"
        if (!__lastUsedChatId) {
            __lastUsedChatId = __chatId;
            await saveConfig(); // 把初始 lastUsedChatId 写入配置文件持久化
        }

        // 首次安装：如果配置文件为空，自动创建空配置
        if (!__chatId) {
            await saveConfig();
        }

        // 延迟首次导出划线数据 + 定时导出
        setTimeout(function() {
            exportHighlightsToFile();
            setInterval(exportHighlightsToFile, 10000);
        }, 3000);

        // 推送配置给 WebView
        setTimeout(function() {
            try {
                controller.evaluateJavascript(
                    "window.__coreadSetConfig && window.__coreadSetConfig(" +
                    JSON.stringify(JSON.stringify({ chatId: __chatId, cardName: __cardName })) + ")"
                );
            } catch(e) {}
        }, 500);
    }

    return UI.Box(
        {
            fillMaxSize: true,
            onLoad: boot,
        },
        [
            UI.WebView({
                fillMaxSize: true,
                controller: controller,
                key: "coread2_reader_webview",
                url: "about:blank",
                javaScriptEnabled: true,
                domStorageEnabled: true,
                allowFileAccess: true,
                // 允许 file:// 页面用 XHR 读取同源本地文件（AI 批注 JSON 等）
                // 注意：仅放开同源访问；跨域访问（universal）保持关闭
                allowFileAccessFromFileURLs: true,
                allowUniversalAccessFromFileURLs: false,
                supportZoom: false,
            })
        ]
    );
}
