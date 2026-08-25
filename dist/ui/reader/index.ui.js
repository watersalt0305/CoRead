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

// ============ 内存状态 ============
var __chatId = "";
var __cardName = "";
var __currentBookId = "";
var __lastUsedChatId = "";
var __localHistory = [];
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

// 生成上下文恢复摘要
function buildContextSummary(bookTitle) {
    if (__localHistory.length === 0) return "";
    var recent = __localHistory.slice(-CONTEXT_RESTORE_COUNT);
    var lines = recent.map(function(entry, i) {
        var summary = "";
        if (entry.selectedText) summary += "选中: \"" + entry.selectedText.substring(0, 60) + "...\"";
        if (entry.comment) summary += " 问: " + entry.comment.substring(0, 40);
        if (entry.aiReply) summary += " AI: " + entry.aiReply.substring(0, 80) + "...";
        return (i + 1) + ". " + summary;
    });
    return "\u3010CoRead \u4E0A\u4E0B\u6587\u6062\u590D\u3011\u4F60\u4E4B\u524D\u548C\u7528\u6237\u8BA8\u8BBA\u8FC7\u300A" + bookTitle + "\u300B\uFF1A\n" + lines.join("\n") + "\n\n\u8BF7\u7EE7\u7EED\u8BA8\u8BBA\uFF1A\n\n";
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
        }
    } catch(e) {}
}

async function saveConfig() {
    try {
        var data = JSON.stringify({ chatId: __chatId, cardName: __cardName }, null, 2);
        await Tools.Files.write(CONFIG_FILE, data);
    } catch(e) {}
}

async function loadHistory(bookId) {
    if (!bookId) return;
    var safe = sanitizeBookId(bookId);
    if (!safe) return;
    __localHistory = [];
    var historyFile = DATA_ROOT + "/_coread_history_" + safe + ".json";
    try {
        var result = await Tools.Files.read(historyFile);
        if (result && result.content) {
            var arr = JSON.parse(result.content);
            if (Array.isArray(arr)) __localHistory = arr;
        }
    } catch(e) {}
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
                    JSON.stringify(JSON.stringify(__aiNotesCache[bookId])) + ")"
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

                if (!text) return { ok: false, error: "没有选中文字" };
                if (!__chatId) {
                    controller.evaluateJavascript(
                        "window.__coreadAIReply && window.__coreadAIReply(" +
                        JSON.stringify("⚠️ 未配置对话 ID。请在设置页面填写 chat_id。") + ")"
                    );
                    return { ok: false, error: "未配置 chat_id" };
                }

                // 构造消息
                var message = "";
                // 检测 chatId 是否变更，需要注入上下文恢复
                if ((!__lastUsedChatId || __lastUsedChatId !== __chatId) && __localHistory.length > 0) {
                    message += buildContextSummary(bookTitle);
                }
                __lastUsedChatId = __chatId;

                message += "\u3010CoRead\u3011\u6B63\u5728\u9605\u8BFB\u300A" + bookTitle + "\u300B";
                if (chapterTitle) message += " - " + chapterTitle;
                message += "\n\n\u7528\u6237\u9009\u4E2D\u4E86\u8FD9\u6BB5\u6587\u5B57\uFF1A\n> " + text.replace(/\n/g, "\n> ");
                if (comment) {
                    message += "\n\n\u7528\u6237\u7684\u60F3\u6CD5/\u95EE\u9898\uFF1A" + comment;
                } else {
                    message += "\n\n\u8BF7\u5E2E\u6211\u5206\u6790\u6216\u8BA8\u8BBA\u8FD9\u6BB5\u5185\u5BB9\u3002";
                }

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
                                    "window.__coreadAIReply && window.__coreadAIReply(" + JSON.stringify("发送失败: " + String(e)) + ")"
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
                if (!msg) return { ok: false, error: "空消息" };
                if (!__chatId) return { ok: false, error: "未配置 chat_id" };

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

                        var p = Tools.Chat.sendMessageStreaming(msg, __chatId, undefined, undefined, streamOpts);
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
                                    "window.__coreadAIReply && window.__coreadAIReply(" + JSON.stringify("失败: " + String(e)) + ")"
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
                
                if (!bookId || !bookTitle) return { ok: false, error: "缺少书籍信息或 bookId 非法" };
                
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
                "  for (var i = 0; i < localStorage.length; i++) {" +
                "    var k = localStorage.key(i);" +
                "    if (k && k.indexOf('cr_hl_all_') === 0) {" +
                "      var bid = k.replace('cr_hl_all_', '');" +
                "      try {" +
                "        result.books[bid] = { highlights: JSON.parse(localStorage.getItem(k) || '{}'), title: '' };" +
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
            var keys = ["reader_html", "reader_css", "reader_js", "jszip_js"];
            var names = ["reader.html", "reader.css", "reader.js", "jszip.min.js"];
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
