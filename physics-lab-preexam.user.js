// ==UserScript==
// @name         大物预习 · 一键答题
// @namespace    https://github.com/c2451134117-cyber/physics-lab-preexam
// @version      0.2.0
// @description  科大奥锐大学物理实验预习系统：读取试卷 XML 里的标准答案，自动填充并可选自动提交。
// @author       c2451134117-cyber
// @match        *://*/Student/ReadyForExam/*
// @grant        none
// @run-at       document-idle
// @all_frames   true
// @noframes     false
// ==/UserScript==

/* ============================================================
 * 配置（改这里）
 * ------------------------------------------------------------
 * AUTO_SUBMIT = true   填完自动交卷
 * AUTO_SUBMIT = false  只填答案，提交留给你自己点（更保险）
 * ============================================================ */
var AUTO_SUBMIT = true;

(function () {
    "use strict";

    var SUBMIT = AUTO_SUBMIT;
    var RETRY_MS = 1000;   // 找不到试卷数据时，每隔多久重试一次（毫秒）
    var MAX_RETRY = 20;    // 最多重试多少次

    var TAG = "[大物预习]";
    function log() {
        var args = Array.prototype.slice.call(arguments);
        console.log.apply(console, [TAG].concat(args));
    }

    if (window.__PLP_RUNNING__) {
        log("脚本已经在运行，手动再填一次……");
        if (window.__PLP__) window.__PLP__.fill();
        return;
    }
    window.__PLP_RUNNING__ = true;

    /* ---------- 小工具 ---------- */
    function toArray(list) { return Array.prototype.slice.call(list || []); }
    function tailNumber(s) {
        var m = String(s).match(/(\d+)(?!.*\d)/);
        return m ? parseInt(m[1], 10) : 0;
    }
    function sameText(a, b) {
        return String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
    }

    /* ---------- 找页面元素：主文档 + 同源 iframe 都找 ---------- */
    function documents() {
        var out = [];
        try { out.push(document); } catch (e) {}
        var frames = document.querySelectorAll("iframe, frame");
        for (var i = 0; i < frames.length; i++) {
            try {
                var d = frames[i].contentDocument;
                if (d && out.indexOf(d) === -1) out.push(d);
            } catch (e) { /* 跨域 iframe，跳过 */ }
        }
        return out;
    }

    function queryAll(docs, selector) {
        var out = [];
        for (var i = 0; i < docs.length; i++) {
            try { out = out.concat(toArray(docs[i].querySelectorAll(selector))); } catch (e) {}
        }
        return out;
    }

    /* ---------- 找试卷数据 window.view ---------- */
    function findView() {
        var wins = [window];
        try {
            for (var i = 0; i < window.frames.length; i++) wins.push(window.frames[i]);
        } catch (e) {}
        for (var j = 0; j < wins.length; j++) {
            try {
                var w = wins[j];
                if (w && w.view && typeof w.view.NewContentXml === "function") return w.view;
            } catch (e) {}
        }
        return null;
    }

    function parseQuestions(xml) {
        var doc = new DOMParser().parseFromString(xml, "text/xml");
        if (doc.querySelector("parsererror")) return [];
        var nodes = toArray(doc.querySelectorAll("Question"));
        var out = [];
        for (var i = 0; i < nodes.length; i++) {
            var idNode = nodes[i].querySelector("QuestionID");
            var ansNode = nodes[i].querySelector("StdAnswer");
            if (!idNode || !ansNode) continue;
            out.push({
                type: (nodes[i].getAttribute("Type") || "").toUpperCase(),
                id: (idNode.textContent || "").trim(),
                answer: (ansNode.textContent || "").trim()
            });
        }
        return out;
    }

    /* ---------- 各题型填充 ---------- */
    function fillSS(docs, q) {
        var list = queryAll(docs, 'input[type="radio"][name="ss' + q.id + '"]');
        for (var i = 0; i < list.length; i++) {
            if (sameText(list[i].value, q.answer)) { list[i].click(); return 1; }
        }
        return 0;
    }

    function fillMS(docs, q) {
        var letters = String(q.answer).match(/[A-Za-z]/g) || [];
        var list = queryAll(docs, 'input[type="checkbox"]');
        var hit = 0;
        for (var i = 0; i < letters.length; i++) {
            var ch = letters[i].toUpperCase();
            for (var j = 0; j < list.length; j++) {
                var el = list[j];
                var id = el.id || "";
                var name = el.name || "";
                if (id === "ms" + q.id + "_" + ch ||
                    name === "ms" + q.id + "_" + ch ||
                    (id.indexOf(q.id) !== -1 && id.slice(-1).toUpperCase() === ch)) {
                    if (!el.checked) el.click();
                    hit++;
                    break;
                }
            }
        }
        return hit;
    }

    function fillTF(docs, q) {
        var yes = /^\s*(正确|对|是|true|t|√|1|a)\s*$/i.test(q.answer);
        var want = yes
            ? ["T", "A", "1", "true", "正确", "对"]
            : ["F", "B", "0", "false", "错误", "错"];
        var list = queryAll(docs, 'input[type="radio"][name="tf' + q.id + '"]');
        for (var i = 0; i < want.length; i++) {
            for (var j = 0; j < list.length; j++) {
                if (sameText(list[j].value, want[i])) { list[j].click(); return 1; }
            }
        }
        return 0;
    }

    function applySelect(sel, value) {
        sel.value = value;
        sel.dispatchEvent(new Event("change", { bubbles: true }));
        return 1;
    }
    function setSelect(sel, want) {
        var opts = toArray(sel.options);
        var i;
        for (i = 0; i < opts.length; i++) {
            if (sameText(opts[i].value, want)) return applySelect(sel, opts[i].value);
        }
        for (i = 0; i < opts.length; i++) {
            if (sameText(opts[i].textContent, want)) return applySelect(sel, opts[i].value);
        }
        return 0;
    }

    function fillBL(docs, q) {
        var sels = queryAll(docs, 'select[id^="bl' + q.id + '_"]');
        if (!sels.length) return 0;
        sels.sort(function (a, b) { return tailNumber(a.id) - tailNumber(b.id); });
        var parts = q.answer.split(/[;；]/);
        if (parts.length < sels.length) parts = q.answer.split(/[,，、]/);
        parts = parts.map(function (x) { return x.trim(); }).filter(Boolean);
        var hit = 0;
        for (var i = 0; i < sels.length && i < parts.length; i++) {
            hit += setSelect(sels[i], parts[i]);
        }
        return hit;
    }

    function fillSK(docs, q) {
        var list = queryAll(docs, "textarea");
        for (var i = 0; i < list.length; i++) {
            var key = (list[i].id || "") + " " + (list[i].name || "") + " " + (list[i].className || "");
            if (key.indexOf(q.id) !== -1) {
                list[i].value = q.answer;
                list[i].dispatchEvent(new Event("input", { bubbles: true }));
                list[i].dispatchEvent(new Event("change", { bubbles: true }));
                return 1;
            }
        }
        return 0;
    }

    /* ---------- 主流程 ---------- */
    function run() {
        var view = findView();
        if (!view) { log("还没找到试卷数据 window.view，等一会儿再试…"); return false; }

        var xml = "";
        try { xml = view.NewContentXml() || ""; } catch (e) { log("NewContentXml() 报错：", e); return false; }
        if (!xml) { log("试卷 XML 还是空的，等一会儿再试…"); return false; }

        var questions = parseQuestions(xml);
        if (!questions.length) { log("试卷 XML 里还没解析出题目，等一会儿再试…"); return false; }

        var docs = documents();
        var ok = { SS: 0, MS: 0, TF: 0, BL: 0, SK: 0 };
        var missed = [];

        for (var i = 0; i < questions.length; i++) {
            var q = questions[i];
            var n = 0;
            if (q.type === "SS") n = fillSS(docs, q);
            else if (q.type === "MS") n = fillMS(docs, q);
            else if (q.type === "TF") n = fillTF(docs, q);
            else if (q.type === "BL") n = fillBL(docs, q);
            else if (q.type === "SK") n = fillSK(docs, q);
            else { missed.push(q.id + " 题型 " + q.type + " 暂不支持"); continue; }
            if (n > 0) ok[q.type]++; else missed.push(q.id + "（" + q.type + "）没匹配上");
        }

        log("共 " + questions.length + " 题，填充情况：", ok);
        if (missed.length) log("这些题没填上：", missed);
        return true;
    }

    function submit() {
        var fn = null;
        try { if (typeof window.SubmitExam === "function") fn = window.SubmitExam.bind(window); } catch (e) {}
        for (var i = 0; !fn && i < window.frames.length; i++) {
            try {
                var w = window.frames[i];
                if (typeof w.SubmitExam === "function") fn = w.SubmitExam.bind(w);
            } catch (e) {}
        }
        if (!fn) { log("没找到 SubmitExam()，请自己点页面上的提交按钮。"); return; }
        log("正在提交…");
        try { fn(); } catch (e) { log("提交出错：", e); }
    }

    function finish() {
        if (!SUBMIT) { log("已跳过自动提交（SUBMIT = false），请自己点提交。"); return; }
        setTimeout(submit, 400);
    }

    function addButton() {
        if (window.top !== window) return;          // 只在最外层窗口显示按钮
        if (document.getElementById("__plp_btn__")) return;
        if (!document.body) return;
        var btn = document.createElement("button");
        btn.id = "__plp_btn__";
        btn.type = "button";
        btn.textContent = "一键答题" + (SUBMIT ? "并提交" : "（不提交）");
        btn.style.cssText = "position:fixed;right:24px;bottom:24px;z-index:99999;padding:10px 14px;" +
            "background:#0f8bfd;color:#fff;border:none;border-radius:6px;cursor:pointer;" +
            "font-size:14px;box-shadow:0 2px 8px rgba(0,0,0,.25)";
        btn.addEventListener("click", function () { if (run()) finish(); });
        document.body.appendChild(btn);
    }

    /* ---------- 启动 ---------- */
    var tries = 0;
    var timer = null;

    function attempt() {
        if (run()) {
            if (timer) clearInterval(timer);
            finish();
            return true;
        }
        return false;
    }

    window.__PLP__ = { run: run, fill: run, submit: submit };

    addButton();
    timer = setInterval(function () {
        tries++;
        if (!attempt() && tries >= MAX_RETRY) {
            clearInterval(timer);
            log("等了 " + MAX_RETRY + " 秒还是没拿到题目，已停止。请确认：1) 页面已经进入试卷 2) 换个 frame 再试一次。");
        }
    }, RETRY_MS);
    attempt();
})();