// CoRead — EPUB / TXT / MD Reader + AI Co-Read
// Copyright (C) 2025 Mishio / 三岛尾 (watersalt0305) & Claude
// SPDX-License-Identifier: AGPL-3.0-or-later

/* METADATA
{
    "name": "coread2_config",
    "description": {
        "zh": "查看/修改 CoRead AI 共读配置（chatId、cardName、aiDotColor）",
        "en": "View/edit CoRead AI co-read config (chatId, cardName, aiDotColor)"
    },
    "enabledByDefault": true,
    "tools": [
        {
            "name": "get_coread_config",
            "description": {
                "zh": "查看 CoRead 共读插件当前的 AI 对话配置（chatId、cardName、aiDotColor）",
                "en": "Get CoRead AI chat config (chatId, cardName, aiDotColor)"
            },
            "parameters": []
        },
        {
            "name": "set_coread_config",
            "description": {
                "zh": "设置 CoRead 共读插件的 AI 对话配置。设置后重新打开 CoRead 生效。",
                "en": "Set CoRead AI chat config. Requires reopening CoRead to take effect."
            },
            "parameters": [
                {"name": "chat_id", "type": "string", "required": false, "description": {"zh": "Operit 对话 ID（用于 AI 共读讨论）", "en": "Operit chat ID for AI co-read"}},
                {"name": "card_name", "type": "string", "required": false, "description": {"zh": "角色卡名称（会显示在批注标题）", "en": "Character card name (shown in annotation header)"}},
                {"name": "ai_dot_color", "type": "string", "required": false, "description": {"zh": "AI 批注圆点颜色（十六进制，如 #D97757）", "en": "AI annotation dot color (hex, e.g. #D97757)"}}
            ]
        }
    ]
}
*/

"use strict";

var CONFIG_FILE = "/sdcard/Download/Operit/CoRead2/_coread_config.json";

function ensureDir() {
    try {
        // 通过写入占位文件确保目录存在（结构化文件 API，自动创建父目录）
        Tools.Files.write("/sdcard/Download/Operit/CoRead2/.keep", "");
    } catch(e) {}
}

async function readConfig() {
    try {
        var r = await Tools.Files.read(CONFIG_FILE);
        if (r && r.content) return JSON.parse(r.content);
    } catch(e) {}
    return { chatId: "", cardName: "", aiDotColor: "#D97757" };
}

async function get_coread_config() {
    var cfg = await readConfig();
    complete({
        ok: true,
        chatId: cfg.chatId || "(未配置)",
        cardName: cfg.cardName || "(未配置)",
        aiDotColor: cfg.aiDotColor || "#D97757",
        configPath: CONFIG_FILE
    });
}

// 常见错误值检测：返回错误提示字符串，合法返回 null
function validateChatId(id) {
    var lower = id.toLowerCase();
    // 占位词/口语化输入
    var placeholders = ["current", "当前", "当前对话", "当前窗口", "本对话", "这个对话", "this", "here", "test", "测试", "null", "undefined", "none", "无"];
    for (var i = 0; i < placeholders.length; i++) {
        if (lower === placeholders[i]) {
            return "chat_id 不能是占位词 \"" + id + "\"。请使用 extended_chat 工具包的 list_chats 查询真实对话 ID 后再设置。";
        }
    }
    // 粘贴了整个 JSON
    if (id.indexOf("{") !== -1 && id.indexOf("chatId") !== -1) {
        return "chat_id 看起来是粘贴了整个 JSON 配置。请只提取 chatId 字段的值（引号内的 ID 本身）。";
    }
    // 带了字段名前缀
    if (/^chat[_\s-]?id\s*[:=]/i.test(id)) {
        return "chat_id 只需要 ID 本身，不要带 \"chat_id:\" 前缀。";
    }
    // 含空白字符
    if (/\s/.test(id)) {
        return "chat_id 含有空格或换行，请检查是否复制不完整或混入了其他内容。";
    }
    // 过短
    if (id.length < 8) {
        return "chat_id 长度仅 " + id.length + " 位，过短，可能复制不完整。请使用 extended_chat 工具包查询完整对话 ID。";
    }
    return null;
}

async function set_coread_config(params) {
    ensureDir();
    var cfg = await readConfig();
    if (params.chat_id) {
        var newId = String(params.chat_id).trim();
        var err = validateChatId(newId);
        if (err) {
            complete({ ok: false, error: err, rejectedChatId: newId });
            return;
        }
        cfg.chatId = newId;
        // 不覆盖 lastUsedChatId —— 让 index.ui.js 的恢复检测能感知到变更
    }
    if (params.card_name !== undefined) {
        cfg.cardName = String(params.card_name).trim();
    }
    if (params.ai_dot_color) {
        var color = String(params.ai_dot_color).trim();
        if (!/^#[0-9a-fA-F]{3,8}$/.test(color)) {
            complete({ ok: false, error: "ai_dot_color 格式不正确：\"" + color + "\"。应为十六进制颜色，如 #D97757 或 #A855F7。" });
            return;
        }
        cfg.aiDotColor = color;
    }
    try {
        await Tools.Files.write(CONFIG_FILE, JSON.stringify(cfg, null, 2));
        complete({
            ok: true,
            chatId: cfg.chatId,
            cardName: cfg.cardName,
            aiDotColor: cfg.aiDotColor,
            hint: "配置已保存。重新打开 CoRead 生效。"
        });
    } catch(e) {
        complete({ ok: false, error: String(e) });
    }
}

exports.get_coread_config = get_coread_config;
exports.set_coread_config = set_coread_config;
