// CoRead — EPUB / TXT / MD Reader + AI Co-Read
// Copyright (C) 2025 Mishio / 三岛尾 (watersalt0305) & Claude
// SPDX-License-Identifier: AGPL-3.0-or-later

/* METADATA
{
    "name": "coread2_tools",
    "description": {
        "zh": "CoRead AI 共读工具：查看当前书的划线批注、为划线添加 AI 批注",
        "en": "CoRead AI tools: view highlights/notes, add AI annotations"
    },
    "enabledByDefault": true,
    "tools": [
        {
            "name": "get_highlights",
            "description": {
                "zh": "获取 CoRead 中当前阅读书籍（或指定书籍）的所有划线和批注。返回划线文字、所在章节、用户批注、时间等信息，帮助 AI 了解用户的阅读痕迹。",
                "en": "Get all highlights and notes for the current (or specified) book in CoRead."
            },
            "parameters": [
                {"name": "book_id", "type": "string", "required": false, "description": {"zh": "书籍 ID。不传则自动使用当前正在阅读的书", "en": "Book ID. If omitted, uses the currently reading book."}}
            ]
        },
        {
            "name": "add_annotation",
            "description": {
                "zh": "为 CoRead 中的某条划线添加或更新 AI 批注。批注会显示在阅读器的划线标记上。可以指定章节索引精确查找，或省略章节索引让工具自动遍历所有章节查找匹配的划线。",
                "en": "Add or update an AI annotation on a highlight in CoRead. Can specify chapter_index for precise lookup, or omit it to auto-search all chapters."
            },
            "parameters": [
                {"name": "chapter_index", "type": "number", "required": false, "description": {"zh": "章节索引（从0开始，可从 get_highlights 返回值中获取）。不传则自动遍历所有章节查找匹配的划线。", "en": "Chapter index (0-based, from get_highlights result). If omitted, auto-searches all chapters."}},
                {"name": "highlight_text", "type": "string", "required": true, "description": {"zh": "划线文字（前50字即可匹配）", "en": "Highlight text (first 50 chars for matching)"}},
                {"name": "annotation", "type": "string", "required": true, "description": {"zh": "要添加的批注内容", "en": "Annotation content to add"}},
                {"name": "book_id", "type": "string", "required": false, "description": {"zh": "书籍 ID。不传则自动使用当前正在阅读的书", "en": "Book ID. If omitted, uses the currently reading book."}}
            ]
        },
        {
            "name": "remove_annotation",
            "description": {
                "zh": "删除 CoRead 中某条划线的批注。",
                "en": "Remove an annotation from a highlight in CoRead."
            },
            "parameters": [
                {"name": "chapter_index", "type": "number", "required": true, "description": {"zh": "章节索引（从0开始）", "en": "Chapter index (0-based)"}},
                {"name": "highlight_text", "type": "string", "required": true, "description": {"zh": "划线文字（前50字即可匹配）", "en": "Highlight text (first 50 chars for matching)"}},
                {"name": "book_id", "type": "string", "required": false, "description": {"zh": "书籍 ID。不传则自动使用当前正在阅读的书", "en": "Book ID. If omitted, uses the currently reading book."}}
            ]
        }
    ]
}
*/

"use strict";

var DATA_DIR = "/sdcard/Download/Operit/CoRead2";
var HIGHLIGHTS_FILE = DATA_DIR + "/_coread_highlights_export.json";
var NOTES_DIR = DATA_DIR;

// book_id 白名单校验：只允许字母/数字/下划线/连字符/点，防止路径穿越
function sanitizeBookId(bookId) {
    var id = String(bookId || "").trim();
    if (!id || id.length > 128) return null;
    if (!/^[A-Za-z0-9._-]+$/.test(id)) return null;
    if (id === "." || id === "..") return null;
    return id;
}

// 读取 WebView 导出的划线数据
async function readHighlightsExport() {
    try {
        var result = await Tools.Files.read(HIGHLIGHTS_FILE);
        if (result && result.content) return JSON.parse(result.content);
    } catch(e) {}
    return null;
}

// 获取当前书 ID
async function getCurrentBookId() {
    var data = await readHighlightsExport();
    if (data && data.currentBookId) return String(data.currentBookId);
    return null;
}

// 读取某本书的批注
async function readNotes(bookId) {
    var safe = sanitizeBookId(bookId);
    if (!safe) return {};
    var notesFile = NOTES_DIR + "/_coread_notes_" + safe + ".json";
    try {
        var result = await Tools.Files.read(notesFile);
        if (result && result.content) return JSON.parse(result.content);
    } catch(e) {}
    return {};
}

// 写入某本书的批注
async function writeNotes(bookId, notes) {
    var safe = sanitizeBookId(bookId);
    if (!safe) throw new Error("invalid book_id");
    var notesFile = NOTES_DIR + "/_coread_notes_" + safe + ".json";
    await Tools.Files.write(notesFile, JSON.stringify(notes, null, 2));
}

async function get_highlights(params) {
    var data = await readHighlightsExport();
    if (!data) {
        complete({
            ok: false,
            error: "未找到划线数据。请先打开 CoRead 阅读一本书（数据会在打开/切换章节时自动导出）。"
        });
        return;
    }

    var bookId = (params.book_id ? String(params.book_id) : data.currentBookId) || "";
    if (params.book_id && !sanitizeBookId(bookId)) {
        complete({ ok: false, error: "无效的 book_id：只允许字母、数字、下划线、连字符和点。" });
        return;
    }
    if (!bookId) {
        complete({ ok: false, error: "无法确定书籍 ID，请传入 book_id 参数或先在 CoRead 中打开一本书。" });
        return;
    }

    var bookData = data.books ? data.books[bookId] : null;
    if (!bookData) {
        complete({
            ok: false,
            error: "未找到书籍 " + bookId + " 的划线数据。",
            available_books: data.books ? Object.keys(data.books) : []
        });
        return;
    }

    // 读取批注
    var notes = await readNotes(bookId);
    // 也检查导出文件里的批注
    if (data.notes && data.notes[bookId]) {
        var exportedNotes = data.notes[bookId];
        for (var k in exportedNotes) {
            if (!notes[k]) notes[k] = exportedNotes[k];
        }
    }

    // 组装结果
    var items = [];
    var hlData = bookData.highlights || {};
    Object.keys(hlData).forEach(function(chIdx) {
        var arr = hlData[chIdx];
        if (!Array.isArray(arr)) return;
        arr.forEach(function(hl) {
            var noteKey = chIdx + ":" + (hl.text || "").substring(0, 50);
            items.push({
                chapter_index: parseInt(chIdx),
                chapter_title: hl.chapterTitle || "",
                text: hl.text || "",
                style: hl.style || "",
                note: notes[noteKey] || "",
                time: hl.time || 0
            });
        });
    });

    items.sort(function(a, b) { return a.chapter_index - b.chapter_index || a.time - b.time; });

    complete({
        ok: true,
        book_id: bookId,
        book_title: bookData.title || "未知",
        total_highlights: items.length,
        highlights: items
    });
}

async function add_annotation(params) {
    if (!params.highlight_text) {
        complete({ ok: false, error: "缺少 highlight_text 参数" }); return;
    }
    if (!params.annotation) {
        complete({ ok: false, error: "缺少 annotation 参数" }); return;
    }

    var bookId = params.book_id ? String(params.book_id) : await getCurrentBookId();
    if (!bookId) {
        complete({ ok: false, error: "无法确定书籍 ID" }); return;
    }
    if (!sanitizeBookId(bookId)) {
        complete({ ok: false, error: "无效的 book_id：只允许字母、数字、下划线、连字符和点。" }); return;
    }

    var inputPrefix = String(params.highlight_text);
    
    // 读取划线数据
    var data = await readHighlightsExport();
    if (!data || !data.books || !data.books[bookId] || !data.books[bookId].highlights) {
        complete({ ok: false, error: "无法读取划线数据" }); return;
    }
    
    var allHighlights = data.books[bookId].highlights;
    
    // 如果传了 chapter_index，只在该章节查找；否则遍历所有章节
    var chIdx = null;
    var matchedText = null;
    
    if (params.chapter_index !== undefined && params.chapter_index !== null) {
        // 指定章节查找
        chIdx = String(params.chapter_index);
        var chapterHighlights = allHighlights[chIdx];
        if (!chapterHighlights || !Array.isArray(chapterHighlights)) {
            complete({ ok: false, error: "章节 " + chIdx + " 没有划线数据" }); return;
        }
        
        for (var i = 0; i < chapterHighlights.length; i++) {
            var hl = chapterHighlights[i];
            if (hl.text && (hl.text.indexOf(inputPrefix) === 0 || hl.text.indexOf(inputPrefix) > 0)) {
                matchedText = hl.text;
                break;
            }
        }
    } else {
        // 自动遍历所有章节查找
        for (var ch in allHighlights) {
            var highlights = allHighlights[ch];
            if (!Array.isArray(highlights)) continue;
            
            for (var i = 0; i < highlights.length; i++) {
                var hl = highlights[i];
                if (hl.text && (hl.text.indexOf(inputPrefix) === 0 || hl.text.indexOf(inputPrefix) > 0)) {
                    chIdx = ch;
                    matchedText = hl.text;
                    break;
                }
            }
            if (matchedText) break;
        }
    }
    
    if (!matchedText || chIdx === null) {
        complete({ ok: false, error: "未找到匹配的划线。请检查 highlight_text 前缀是否正确。" });
        return;
    }
    
    // 用完整文字的前50字生成 noteKey（与 get_highlights 保持一致）
    var noteKey = chIdx + ":" + matchedText.substring(0, 50);

    var notes = await readNotes(bookId);
    
    // 直接存储批注文本（字符串格式）
    notes[noteKey] = String(params.annotation);
    await writeNotes(bookId, notes);

    complete({
        ok: true,
        book_id: bookId,
        chapter_index: parseInt(chIdx),
        highlight_text_prefix: inputPrefix,
        matched_full_text: matchedText.substring(0, 100) + (matchedText.length > 100 ? "..." : ""),
        annotation: String(params.annotation),
        hint: "批注已保存。重新打开 CoRead 或切换章节后可见。"
    });
}

async function remove_annotation(params) {
    if (!params.chapter_index && params.chapter_index !== 0) {
        complete({ ok: false, error: "缺少 chapter_index 参数" }); return;
    }
    if (!params.highlight_text) {
        complete({ ok: false, error: "缺少 highlight_text 参数" }); return;
    }

    var bookId = params.book_id ? String(params.book_id) : await getCurrentBookId();
    if (!bookId) {
        complete({ ok: false, error: "无法确定书籍 ID" }); return;
    }
    if (!sanitizeBookId(bookId)) {
        complete({ ok: false, error: "无效的 book_id：只允许字母、数字、下划线、连字符和点。" }); return;
    }

    var chIdx = String(params.chapter_index);
    var textPrefix = String(params.highlight_text).substring(0, 50);
    var noteKey = chIdx + ":" + textPrefix;

    var notes = await readNotes(bookId);
    if (notes[noteKey]) {
        delete notes[noteKey];
        await writeNotes(bookId, notes);
        complete({ ok: true, hint: "批注已删除。" });
    } else {
        complete({ ok: false, error: "未找到匹配的批注。noteKey=" + noteKey });
    }
}

exports.get_highlights = get_highlights;
exports.add_annotation = add_annotation;
exports.remove_annotation = remove_annotation;
