// KeyShield content script — works on ChatGPT, Claude, and Gemini

// Site-scoped selector groups.
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
        "div[contenteditable='true'].ProseMirror",
        "div[contenteditable='true'][aria-label*='Claude']",
        "fieldset div[contenteditable='true']"
    ],
    "gemini.google.com": [
        "rich-textarea div[contenteditable='true']",
        "div[contenteditable='true'].ql-editor",
        ".simplified-input-area div[contenteditable='true']",
        "div[contenteditable='true'][aria-label*='Gemini']"
    ]
};

// Generic fallback list.
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
        const elements = document.querySelectorAll(selector);

        for (const el of elements) {
            // Skip elements that aren't actually visible.
            if (el.offsetParent !== null) {
                return el;
            }
        }
    }

    return null;
}

function extractText(el) {
    if (el.tagName === "TEXTAREA") {
        return el.value;
    }

    return el.innerText;
}

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

    el.dispatchEvent(new Event("input", {
        bubbles: true
    }));

    el.dispatchEvent(new Event("change", {
        bubbles: true
    }));
}

async function scanAIInput() {
    const textbox = getActivePromptElement();

    if (!textbox) {
        return {
            message: "Could not find input box on this AI platform."
        };
    }

    const isEditable = textbox.isContentEditable;
    const code = extractText(textbox);

    console.log("KeyShield textbox target:", textbox);
    console.log("KeyShield extracted content:", code);

    if (!code || !code.trim()) {
        return {
            message: "Input box is empty."
        };
    }

    try {
        const response = await fetch(
            "http://127.0.0.1:5000/scan",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ code })
            }
        );

        if (!response.ok) {
            return {
                message: "Backend error."
            };
        }

        const result = await response.json();

        console.log("KeyShield result:", result);

        if (
            !result.secrets_detected ||
            result.secrets_detected.length === 0
        ) {
            return {
                message: "No secrets detected."
            };
        }

        if (isEditable) {
            replaceContentEditableText(
                textbox,
                result.secured_code
            );
        } else {
            replaceTextareaValue(
                textbox,
                result.secured_code
            );
        }

        return {
            message:
                `${result.secrets_detected.length} secret(s) secured.`
        };

    } catch (error) {
        console.error("KeyShield error:", error);

        return {
            message:
                "Could not connect to KeyShield backend."
        };
    }
}


// ============================================================
// AUTO-DETECTION / DOM WATCHER
// ============================================================

// Prevent attaching our initialization logic multiple times.
let keyShieldInitialized = false;

function initializeKeyShield() {
    const textbox = getActivePromptElement();

    if (!textbox) {
        return false;
    }

    if (keyShieldInitialized) {
        return true;
    }

    keyShieldInitialized = true;

    console.log(
        "KeyShield: input detected. Protection initialized."
    );

    return true;
}


// Try immediately in case the page is already loaded.
initializeKeyShield();


// ChatGPT/Claude/Gemini dynamically create their UI.
// MutationObserver watches for those elements appearing later.
const keyShieldObserver = new MutationObserver(() => {
    if (!keyShieldInitialized) {
        initializeKeyShield();
    }
});


// Start watching the entire page for dynamically-created elements.
keyShieldObserver.observe(document.documentElement, {
    childList: true,
    subtree: true
});


// ============================================================
// MESSAGE HANDLER
// ============================================================

chrome.runtime.onMessage.addListener(
    (request, sender, sendResponse) => {

        if (
            request.action === "scanChatGPT" ||
            request.action === "scanAIInput"
        ) {
            scanAIInput().then(sendResponse);

            return true;
        }
    }
);