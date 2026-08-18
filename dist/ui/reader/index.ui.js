// CoRead — EPUB / TXT / MD Reader + AI Co-Read
// Copyright (C) 2025 Mishio / 三岛尾 (watersalt0305) & Claude
// SPDX-License-Identifier: AGPL-3.0-or-later

"use strict";

Object.defineProperty(exports, "__esModule", { value: true });
exports.default = Screen;

// ============ 配置常量 ============
var READER_HTML_PATH = "file:///data/user/0/com.ai.assistance.operit/files/workspace/ecf37c48-b3bd-40c7-8139-478135fec74d/dist/ui/reader/reader.html";
var BRIDGE_NAME = "CoreadBridge";
var CONFIG_FILE = "/sdcard/Download/Operit/CoRead2/_coread_config.json";
var HISTORY_FILE = "/sdcard/Download/Operit/CoRead2/_coread_history.json";
var MAX_HISTORY = 100;
var CONTEXT_RESTORE_COUNT = 8; // chatId 变更时注入最近 N 条摘要

// ============ 内存状态 ============
var __chatId = "";
var __cardName = "";
var __lastUsedChatId = "";
var __localHistory = [];

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

// 生成上下文恢复摘要（chatId 变更时注入）
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
async function ensureDir() {
    try {
        await Tools.System.terminal.hiddenExec('mkdir -p "/sdcard/Download/Operit/CoRead2"');
    } catch(e) {}
}

async function loadConfig() {
    try {
        var raw = await Tools.System.terminal.hiddenExec('cat "' + CONFIG_FILE + '" 2>/dev/null');
        if (raw && raw.exitCode === 0 && raw.output) {
            var cfg = JSON.parse(raw.output);
            if (cfg.chatId) __chatId = cfg.chatId;
            if (cfg.cardName) __cardName = cfg.cardName;
            if (cfg.lastUsedChatId) __lastUsedChatId = cfg.lastUsedChatId;
        }
    } catch(e) {}
}

async function saveConfig() {
    try {
        var data = JSON.stringify({ chatId: __chatId, cardName: __cardName, lastUsedChatId: __lastUsedChatId }, null, 2);
        await Tools.Files.write(CONFIG_FILE, data);
    } catch(e) {}
}

async function loadHistory() {
    try {
        var raw = await Tools.System.terminal.hiddenExec('cat "' + HISTORY_FILE + '" 2>/dev/null');
        if (raw && raw.exitCode === 0 && raw.output) {
            var arr = JSON.parse(raw.output);
            if (Array.isArray(arr)) __localHistory = arr;
        }
    } catch(e) {}
}

async function saveHistory() {
    try {
        if (__localHistory.length > MAX_HISTORY) __localHistory = __localHistory.slice(-MAX_HISTORY);
        await Tools.Files.write(HISTORY_FILE, JSON.stringify(__localHistory));
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
                saveConfig(); // 异步保存

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
                    try {
                        var escaped = JSON.stringify(JSON.stringify(__localHistory.slice(-50)));
                        controller.evaluateJavascript(
                            "window.__coreadLoadHistory && window.__coreadLoadHistory(" + escaped + ")"
                        );
                    } catch(e) {}
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

            // 心跳
            ping: function() {
                return { ok: true, bridge: BRIDGE_NAME, time: new Date().toISOString() };
            }
        };

        controller.addJavascriptInterface(BRIDGE_NAME, bridgeObj);
    }

    async function boot() {
        if (initialized) return;
        setInitialized(true);

        await ensureDir();
        await loadConfig();

        // 首次安装：如果配置文件为空，自动创建空配置
        if (!__chatId) {
            await saveConfig();
        }

        await loadHistory();
        registerBridge();

        // 推送配置给 WebView（含空检测触发）
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
                url: READER_HTML_PATH,
                javaScriptEnabled: true,
                domStorageEnabled: true,
                allowFileAccess: true,
                allowFileAccessFromFileURLs: true,
                allowUniversalAccessFromFileURLs: true,
                supportZoom: false,
            })
        ]
    );
}
