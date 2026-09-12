// KeyShield content script — works on ChatGPT, Claude, and Gemini

// Site-scoped selector groups. Checking hostname first avoids wasting time
// probing selectors that belong to a platform you're not even on.
const PLATFORM_SELECTORS = {
    "chatgpt.com": [
        "#prompt-textarea",
        "div[contenteditable='true'][aria-label*='ChatGPT']",
        "div[contenteditable='true'][id='prompt-textarea']"
    ],
    "chat.openai.com": [
        "#prompt-textarea",
        "div[contenteditable='true'][aria-label*='ChatGPT']"
    ],
    "claude.ai": [
        // Claude's composer is a ProseMirror instance, not a plain div.
        "div[contenteditable='true'].ProseMirror",
        "div[contenteditable='true'][aria-label*='Claude']",
        "fieldset div[contenteditable='true']"
    ],
    "gemini.google.com": [
        // Gemini's input is a rich-textarea custom element wrapping a
        // contenteditable (historically Quill-based) div.
        "rich-textarea div[contenteditable='true']",
        "div[contenteditable='true'].ql-editor",
        ".simplified-input-area div[contenteditable='true']",
        "div[contenteditable='true'][aria-label*='Gemini']"
    ]
};

// Generic fallback list, tried if the hostname isn't recognized or none of
// its selectors hit — e.g. the platforms ship a redesign before you notice.
const FALLBACK_SELECTORS = [
    "textarea",
    "div[contenteditable='true'][role='textbox']",
    "div[contenteditable='true']"
];

function getActivePromptElement() {
    const host = window.location.hostname;
    const scoped = PLATFORM_SELECTORS[host] || [];
    const candidates = [...scoped, ...FALLBACK_SELECTORS];

    for (const selector of candidates) {
        const el = document.querySelector(selector);
        // Skip elements that exist in the DOM but aren't actually visible/usable
        if (el && el.offsetParent !== null) return el;
    }

    return null;
}

function extractText(el) {
    if (el.tagName === "TEXTAREA") return el.value;
    return el.innerText;
}

// Rich contenteditable editors (ChatGPT and Claude both run on ProseMirror;
// Gemini's is Quill/Lexical-flavored) do NOT take raw DOM edits at face
// value. They own their internal document model and reconcile whatever
// lands in the DOM against their own schema.
function pasteText(el, text) {
    el.focus();

    // Select existing content so the paste replaces it
    const range = document.createRange();
    range.selectNodeContents(el);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);

    const dataTransfer = new DataTransfer();
    dataTransfer.setData("text/plain", text);

    const pasteEvent = new ClipboardEvent("paste", {
        clipboardData: dataTransfer,
        bubbles: true,
        cancelable: true
    });

    const handled = el.dispatchEvent(pasteEvent);

    if (!handled) return true;

    // Fall back to manual line-by-line DOM insertion if paste handler isn't registered
    el.textContent = "";
    const lines = text.split("\n");
    lines.forEach((line, i) => {
        el.appendChild(document.createTextNode(line));
        if (i < lines.length - 1) {
            el.appendChild(document.createElement("br"));
        }
    });

    el.dispatchEvent(
        new InputEvent("input", {
            bubbles: true,
            cancelable: true,
            inputType: "insertText",
            data: text
        })
    );
    return false;
}

function replaceTextareaValue(el, newText) {
    const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value"
    ).set;
    setter.call(el, newText);

    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
}

async function scanAIInput() {
    const textbox = getActivePromptElement();

    if (!textbox) {
        return { message: "Could not find input box on this AI platform." };
    }

    const isEditable = textbox.isContentEditable;
    const code = extractText(textbox);

    console.log("KeyShield textbox target:", textbox);
    console.log("KeyShield extracted content:", code);

    if (!code || !code.trim()) {
        return { message: "Input box is empty." };
    }

    try {
        const response = await fetch("http://127.0.0.1:5000/scan", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code })
        });

        if (!response.ok) {
            return { message: "Backend error." };
        }

        const result = await response.json();
        console.log("KeyShield result:", result);

        if (!result.secrets_detected || result.secrets_detected.length === 0) {
            return {
                message: "No secrets detected.",
                secretsDetected: [],
                severityCounts: { serious: 0, moderate: 0, low: 0 }
            };
        }

        if (isEditable) {
            pasteText(textbox, result.secured_code);
        } else {
            replaceTextareaValue(textbox, result.secured_code);
        }

        return {
            message: `${result.secrets_detected.length} secret(s) secured.`,
            secretsDetected: result.secrets_detected,
            severityCounts: result.severity_counts
        };
    } catch (error) {
        console.error("KeyShield error:", error);
        return { message: "Could not connect to KeyShield backend." };
    }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "scanChatGPT" || request.action === "scanAIInput") {
        scanAIInput().then(sendResponse);
        return true;
    }
});

// --- Pre-flight Intercept Feature ---

async function checkAndIntercept(event) {
    const textbox = getActivePromptElement();
    if (!textbox) return;

    const isEnterKey = event.type === "keydown" && event.key === "Enter" && !event.shiftKey;
    const isSubmitClick = event.type === "pointerdown" || event.type === "click";

    if (!isEnterKey && !isSubmitClick) return;

    if (isSubmitClick) {
        const isSendButton = event.target.closest(
            'button[aria-label*="Send"], ' +
            'button[aria-label*="send"], ' +
            'button[data-testid*="send"], ' +
            'button[aria-label*="Submit"], ' +
            'button:has(svg)'
        );
        if (!isSendButton) return;
    }

    const code = extractText(textbox);
    if (!code || !code.trim()) return;

    try {
        const response = await fetch("http://127.0.0.1:5000/scan", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code })
        });

        if (response.ok) {
            const result = await response.json();
            const counts = result.severity_counts || {};
            const moderateCount = counts.moderate || 0;
            const seriousCount = counts.serious || 0;

            if (moderateCount > 0 || seriousCount > 0) {
                event.preventDefault();
                event.stopPropagation();
                event.stopImmediatePropagation();

                alert(`⚠️ KeyShield Interception!\n\nDetected ${seriousCount} serious and ${moderateCount} moderate severity secret(s).\n\nPlease sanitize your code with KeyShield before sending.`);
                return false;
            }
        }
    } catch (err) {
        console.error("KeyShield pre-flight check failed:", err);
    }
}

// Capture phase listeners catch interactions before framework event handlers execute
window.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
        const textbox = getActivePromptElement();
        if (textbox && (textbox === e.target || textbox.contains(e.target))) {
            checkAndIntercept(e);
        }
    }
}, true);

window.addEventListener("pointerdown", (e) => {
    checkAndIntercept(e);
}, true);