// CoRead — EPUB / TXT / MD Reader + AI Co-Read
// Copyright (C) 2025 Mishio / 三岛尾 (watersalt0305) & Claude
// SPDX-License-Identifier: AGPL-3.0-or-later

/* METADATA
{
    "name": "coread_config",
    "description": {
        "zh": "查看/修改 CoRead AI 共读配置（chatId、cardName）",
        "en": "View/edit CoRead AI co-read config (chatId, cardName)"
    },
    "enabledByDefault": true,
    "tools": [
        {
            "name": "get_coread_config",
            "description": {
                "zh": "查看 CoRead 共读插件当前的 AI 对话配置（chatId、cardName）",
                "en": "Get CoRead AI chat config (chatId, cardName)"
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
                {"name": "card_name", "type": "string", "required": false, "description": {"zh": "角色卡名称", "en": "Character card name"}}
            ]
        }
    ]
}
*/

"use strict";

var CONFIG_FILE = "/sdcard/Download/Operit/CoRead2/_coread_config.json";

function ensureDir() {
    try {
        Tools.System.terminal.hiddenExec('mkdir -p "/sdcard/Download/Operit/CoRead2"');
    } catch(e) {}
}

function readConfig() {
    try {
        var r = Tools.Files.read(CONFIG_FILE);
        if (r && r.content) return JSON.parse(r.content);
    } catch(e) {}
    return { chatId: "", cardName: "" };
}

function get_coread_config() {
    var cfg = readConfig();
    complete({
        ok: true,
        chatId: cfg.chatId || "(未配置)",
        cardName: cfg.cardName || "(未配置)",
        configPath: CONFIG_FILE
    });
}

function set_coread_config(params) {
    ensureDir();
    var cfg = readConfig();
    if (params.chat_id) {
        cfg.chatId = String(params.chat_id).trim();
        // 不覆盖 lastUsedChatId —— 让 index.ui.js 的恢复检测能感知到变更
    }
    if (params.card_name) {
        cfg.cardName = String(params.card_name).trim();
    }
    try {
        Tools.Files.write(CONFIG_FILE, JSON.stringify(cfg, null, 2));
        complete({
            ok: true,
            chatId: cfg.chatId,
            cardName: cfg.cardName,
            hint: "配置已保存。重新打开 CoRead 生效。"
        });
    } catch(e) {
        complete({ ok: false, error: String(e) });
    }
}

exports.get_coread_config = get_coread_config;
exports.set_coread_config = set_coread_config;
