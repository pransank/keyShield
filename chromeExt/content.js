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

// Rich contenteditable editors (ProseMirror, Quill/Lexical-style) track
// their own document model. Overwriting innerText bypasses that model and
// leaves the editor's internal state out of sync with the DOM, which is
// exactly the bug in the original script. Instead: select all existing
// content and use execCommand('insertText'), which fires the native
// "beforeinput"/"input" sequence these editors actually listen for.
function replaceContentEditableText(el, newText) {
    el.focus();

    const range = document.createRange();
    range.selectNodeContents(el);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);

    if (document.execCommand("insertText", false, newText)) {
        return true;
    }

    // execCommand is deprecated and some browsers/editors ignore it.
    // Fall back to manual DOM replacement + a properly-typed InputEvent,
    // which is what React/ProseMirror/Lexical actually subscribe to
    // (a generic `new Event('input')` alone is often not enough).
    el.textContent = "";
    el.appendChild(document.createTextNode(newText));

    const inputEvent = new InputEvent("input", {
        bubbles: true,
        cancelable: true,
        inputType: "insertText",
        data: newText
    });
    el.dispatchEvent(inputEvent);
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
            return { message: "No secrets detected." };
        }

        if (isEditable) {
            replaceContentEditableText(textbox, result.secured_code);
        } else {
            replaceTextareaValue(textbox, result.secured_code);
        }

        return {
            message: `${result.secrets_detected.length} secret(s) secured.`
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