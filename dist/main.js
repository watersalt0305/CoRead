// CoRead — EPUB / TXT / MD Reader + AI Co-Read
// Copyright (C) 2025 Mishio / 三岛尾 (watersalt0305) & Claude
// SPDX-License-Identifier: AGPL-3.0-or-later

"use strict";

var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerToolPkg = registerToolPkg;

var index_ui_js_1 = __importDefault(require("./ui/reader/index.ui.js"));

var COREAD2_ROUTE = "toolpkg:coread2:ui:reader";

function registerToolPkg() {
  ToolPkg.registerUiRoute({
    id: "reader",
    route: COREAD2_ROUTE,
    runtime: "compose_dsl",
    screen: index_ui_js_1.default,
    params: {},
    keepAlive: false,
    title: { zh: "CoRead", en: "CoRead" }
  });

  ToolPkg.registerNavigationEntry({
    id: "reader_sidebar",
    route: COREAD2_ROUTE,
    surface: "main_sidebar_plugins",
    title: { zh: "CoRead", en: "CoRead" },
    icon: "auto_stories",
    order: 101
  });

  return true;
}