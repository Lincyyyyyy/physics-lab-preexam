// ==UserScript==
// @name         Physics Lab Preexam Auto Fill & Submit
// @namespace    https://github.com/c2451134117-cyber/physics-lab-preexam
// @version      0.1.0
// @description  Fill 科大奥锐 physics lab pre-study exam answers from NewContentXml and submit once.
// @match        http://172.31.80.14:7101/Student/ReadyForExam/*
// @match        https://172.31.80.14:7101/Student/ReadyForExam/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    "use strict";

    let done = false;

    function getView() {
        try {
            return typeof window.view !== "undefined" ? window.view : null;
        } catch (e) {
            return null;
        }
    }

    function getPaperXml() {
        const v = getView();
        if (!v || typeof v.NewContentXml !== "function") return "";
        return v.NewContentXml() || "";
    }

    function parseQuestions(xmlText) {
        const doc = new DOMParser().parseFromString(xmlText, "text/xml");
        if (doc.querySelector("parsererror")) return [];
        return Array.from(doc.querySelectorAll("Paper > Content > Question"));
    }

    function fillQuestion(question) {
        const type = question.getAttribute("Type") || "";
        const qidNode = question.querySelector("QuestionID");
        const stdNode = question.querySelector("StdAnswer");
        if (!qidNode || !stdNode) return;

        const qid = qidNode.textContent.trim();
        const std = stdNode.textContent.trim();

        if (type === "SS") {
            const radio = document.querySelector(
                'input[type="radio"][name="ss' + qid + '"][value="' + std + '"]'
            );
            if (radio) radio.click();
            return;
        }

        if (type === "MS") {
            for (const ch of std.split("")) {
                if (!/[A-G]/.test(ch)) continue;
                const box = document.getElementById("ms" + qid + "_" + ch);
                if (box) {
                    box.checked = true;
                    box.dispatchEvent(new Event("change", { bubbles: true }));
                }
            }
            return;
        }

        if (type === "TF") {
            const value = std === "正确" ? "T" : "F";
            const radio = document.querySelector(
                'input[type="radio"][name="tf' + qid + '"][value="' + value + '"]'
            );
            if (radio) radio.click();
            return;
        }

        if (type === "BL") {
            const values = std
                .split(";")
                .map((x) => x.trim())
                .filter(Boolean);
            const selects = Array.from(
                document.querySelectorAll('select[id^="bl' + qid + '_"]')
            ).sort((a, b) => a.id.localeCompare(b.id));

            selects.forEach((select, index) => {
                const value = values[index] || "A";
                if (Array.from(select.options).some((opt) => opt.value === value)) {
                    select.value = value;
                    select.dispatchEvent(new Event("change", { bubbles: true }));
                }
            });
            return;
        }

        if (type === "SK") {
            const textarea = document.querySelector(
                'textarea[id*="' + qid + '"]'
            );
            if (textarea) {
                textarea.value = std;
                textarea.dispatchEvent(new Event("input", { bubbles: true }));
            }
        }
    }

    function fillAll() {
        const xmlText = getPaperXml();
        if (!xmlText) return false;

        const questions = parseQuestions(xmlText);
        if (!questions.length) return false;

        questions.forEach(fillQuestion);
        return true;
    }

    function submitExam() {
        if (typeof window.SubmitExam === "function") {
            window.SubmitExam();
        }
    }

    function tryRun() {
        if (done) return true;
        if (!fillAll()) return false;

        // Wait briefly for the page's own ViewModel state to settle, then submit.
        setTimeout(submitExam, 250);
        done = true;
        return true;
    }

    function addButton() {
        const button = document.createElement("button");
        button.textContent = "一键答题并提交";
        button.type = "button";
        button.style.position = "fixed";
        button.style.right = "24px";
        button.style.bottom = "24px";
        button.style.zIndex = "99999";
        button.style.padding = "10px 14px";
        button.style.background = "#0f8bfd";
        button.style.color = "#fff";
        button.style.border = "none";
        button.style.borderRadius = "6px";
        button.style.cursor = "pointer";
        button.addEventListener("click", tryRun);
        document.body.appendChild(button);
    }

    function watch() {
        const observer = new MutationObserver(() => {
            if (!done && getPaperXml()) {
                tryRun();
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });

        const interval = window.setInterval(() => {
            if (!done && getPaperXml()) {
                tryRun();
                window.clearInterval(interval);
            }
        }, 1000);
    }

    addButton();
    watch();
})();
