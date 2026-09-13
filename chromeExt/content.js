// KeyShield content script — works on ChatGPT, Claude, and Gemini

// ============================================================
// PLATFORM SELECTORS
// ============================================================

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
        // Claude uses a ProseMirror-style contenteditable.
        "div[contenteditable='true'].ProseMirror",
        "div[contenteditable='true'][aria-label*='Claude']",
        "fieldset div[contenteditable='true']"
    ],

    "gemini.google.com": [
        // Gemini's composer has changed over time, so keep several
        // selectors and verify that the element is actually visible.
        "rich-textarea div[contenteditable='true']",
        "div[contenteditable='true'].ql-editor",
        ".simplified-input-area div[contenteditable='true']",
        "div[contenteditable='true'][aria-label*='Gemini']"
    ]
};


// Generic fallback selectors.
// Used if a platform is redesigned or the hostname is unknown.
const FALLBACK_SELECTORS = [
    "textarea",
    "div[contenteditable='true'][role='textbox']",
    "div[contenteditable='true']"
];


// ============================================================
// FIND ACTIVE INPUT
// ============================================================

function getActivePromptElement() {
    const host = window.location.hostname;

    const scoped = PLATFORM_SELECTORS[host] || [];
    const candidates = [...scoped, ...FALLBACK_SELECTORS];

    for (const selector of candidates) {
        const elements = document.querySelectorAll(selector);

        for (const el of elements) {
            // Ignore hidden elements.
            if (!el || el.offsetParent === null) {
                continue;
            }

            // Ignore disabled/read-only controls.
            if (el.disabled || el.readOnly) {
                continue;
            }

            return el;
        }
    }

    return null;
}


// ============================================================
// EXTRACT TEXT
// ============================================================

function extractText(el) {
    if (el.tagName === "TEXTAREA") {
        return el.value;
    }

    return el.innerText || el.textContent || "";
}


// ============================================================
// REPLACE CONTENTEDITABLE TEXT
// ============================================================

function pasteText(el, text) {
    el.focus();

    // Select all existing content.
    const selection = window.getSelection();
    const range = document.createRange();

    range.selectNodeContents(el);

    selection.removeAllRanges();
    selection.addRange(range);


    // --------------------------------------------------------
    // Preferred method:
    // Let the browser/editor handle the replacement as a real
    // text insertion instead of manually modifying the DOM.
    // --------------------------------------------------------

    try {
        const inserted = document.execCommand(
            "insertText",
            false,
            text
        );

        if (inserted) {
            return true;
        }
    } catch (error) {
        console.warn(
            "KeyShield execCommand insertion failed:",
            error
        );
    }


    // --------------------------------------------------------
    // Secondary fallback:
    // Dispatch a paste event.
    //
    // IMPORTANT:
    // Do NOT manually set el.textContent here.
    // Gemini maintains its own editor state and direct DOM
    // replacement can desynchronize the visible DOM from the
    // editor's internal document model.
    // --------------------------------------------------------

    try {
        const dataTransfer = new DataTransfer();

        dataTransfer.setData("text/plain", text);

        const pasteEvent = new ClipboardEvent("paste", {
            clipboardData: dataTransfer,
            bubbles: true,
            cancelable: true
        });

        el.dispatchEvent(pasteEvent);

        return true;
    } catch (error) {
        console.error(
            "KeyShield paste fallback failed:",
            error
        );
    }

    return false;
}


// ============================================================
// REPLACE TEXTAREA VALUE
// ============================================================

function replaceTextareaValue(el, newText) {
    const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value"
    ).set;

    setter.call(el, newText);

    el.dispatchEvent(
        new Event("input", {
            bubbles: true
        })
    );

    el.dispatchEvent(
        new Event("change", {
            bubbles: true
        })
    );
}


// ============================================================
// SCAN AI INPUT
// ============================================================

async function scanAIInput() {
    const textbox = getActivePromptElement();

    if (!textbox) {
        return {
            message: "Could not find input box on this AI platform."
        };
    }

    const isEditable = textbox.isContentEditable;
    const code = extractText(textbox);

    console.log(
        "KeyShield textbox target:",
        textbox
    );

    console.log(
        "KeyShield extracted content:",
        code
    );

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

                body: JSON.stringify({
                    code: code
                })
            }
        );


        if (!response.ok) {
            return {
                message: "Backend error."
            };
        }


        const result = await response.json();

        console.log(
            "KeyShield result:",
            result
        );


        // ----------------------------------------------------
        // No secrets
        // ----------------------------------------------------

        if (
            !result.secrets_detected ||
            result.secrets_detected.length === 0
        ) {
            return {
                message: "No secrets detected.",

                secretsDetected: [],

                severityCounts: {
                    serious: 0,
                    moderate: 0,
                    low: 0
                }
            };
        }


        // ----------------------------------------------------
        // Replace detected secrets
        // ----------------------------------------------------

        let replacementSucceeded = false;

        if (isEditable) {
            replacementSucceeded = pasteText(
                textbox,
                result.secured_code
            );
        } else {
            replaceTextareaValue(
                textbox,
                result.secured_code
            );

            replacementSucceeded = true;
        }


        if (!replacementSucceeded) {
            return {
                message: "Could not replace the input safely.",

                secretsDetected:
                    result.secrets_detected,

                severityCounts:
                    result.severity_counts
            };
        }


        return {
            message:
                `${result.secrets_detected.length} secret(s) secured.`,

            secretsDetected:
                result.secrets_detected,

            severityCounts:
                result.severity_counts
        };


    } catch (error) {
        console.error(
            "KeyShield error:",
            error
        );

        return {
            message:
                "Could not connect to KeyShield backend."
        };
    }
}


// ============================================================
// EXTENSION MESSAGE HANDLER
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


// ============================================================
// PRE-FLIGHT INTERCEPT
// ============================================================

async function checkAndIntercept(event) {
    const textbox = getActivePromptElement();

    if (!textbox) {
        return;
    }


    // --------------------------------------------------------
    // Determine whether this is an actual submission attempt.
    // --------------------------------------------------------

    const isEnterKey =
        event.type === "keydown" &&
        event.key === "Enter" &&
        !event.shiftKey;

    const isSubmitClick =
        event.type === "pointerdown" ||
        event.type === "click";


    if (!isEnterKey && !isSubmitClick) {
        return;
    }


    // --------------------------------------------------------
    // For mouse/pointer events, make sure this is actually a
    // send/submit button.
    // --------------------------------------------------------

    if (isSubmitClick) {

        const sendButton = event.target.closest(
            [
                'button[aria-label*="Send"]',
                'button[aria-label*="send"]',
                'button[data-testid*="send"]',
                'button[aria-label*="Submit"]'
            ].join(", ")
        );


        if (!sendButton) {
            return;
        }
    }


    // --------------------------------------------------------
    // Immediately stop the site's submission.
    //
    // This happens BEFORE awaiting the backend.
    // Otherwise the site's own handler can submit the message
    // while our fetch() is still running.
    // --------------------------------------------------------

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();


    const code = extractText(textbox);

    if (!code || !code.trim()) {
        return false;
    }


    try {

        console.log(
            "KeyShield pre-flight scan started."
        );


        const response = await fetch(
            "http://127.0.0.1:5000/scan",
            {
                method: "POST",

                headers: {
                    "Content-Type": "application/json"
                },

                body: JSON.stringify({
                    code: code
                })
            }
        );


        if (!response.ok) {

            alert(
                "KeyShield could not scan this message.\n\n" +
                "The message was not sent."
            );

            return false;
        }


        const result = await response.json();

        console.log(
            "KeyShield pre-flight result:",
            result
        );


        const counts =
            result.severity_counts || {};


        const moderateCount =
            counts.moderate || 0;

        const seriousCount =
            counts.serious || 0;


        // ----------------------------------------------------
        // BLOCK UNSAFE MESSAGE
        // ----------------------------------------------------

        if (
            moderateCount > 0 ||
            seriousCount > 0
        ) {

            alert(
                `⚠️ KeyShield Interception!\n\n` +
                `Detected ${seriousCount} serious ` +
                `and ${moderateCount} moderate ` +
                `severity secret(s).\n\n` +
                `Please sanitize your code with KeyShield ` +
                `before sending.`
            );

            return false;
        }


        // ----------------------------------------------------
        // SAFE MESSAGE
        //
        // At this point we have already intercepted the
        // original event. We cannot simply "resume" it because
        // the original event has finished.
        //
        // For now, notify the user that the scan passed.
        // The extension's normal scan flow can then be used
        // to submit the sanitized text.
        // ----------------------------------------------------

        console.log(
            "KeyShield pre-flight: message is safe."
        );


        // Re-submit using the platform's send button.
        //
        // Delay slightly so the current event has completely
        // finished before triggering the click.

        setTimeout(() => {

            const currentTextbox =
                getActivePromptElement();

            if (!currentTextbox) {
                return;
            }


            const sendButton =
                findSendButton();


            if (sendButton) {
                sendButton.click();
            }

        }, 50);


        return false;


    } catch (error) {

        console.error(
            "KeyShield pre-flight check failed:",
            error
        );


        alert(
            "KeyShield could not scan this message.\n\n" +
            "The message was not sent."
        );

        return false;
    }
}


// ============================================================
// FIND SEND BUTTON
// ============================================================

function findSendButton() {

    const selectors = [
        'button[aria-label*="Send"]',
        'button[aria-label*="send"]',
        'button[data-testid*="send"]',
        'button[aria-label*="Submit"]'
    ];


    for (const selector of selectors) {

        const buttons =
            document.querySelectorAll(selector);


        for (const button of buttons) {

            if (
                button.offsetParent !== null &&
                !button.disabled
            ) {
                return button;
            }
        }
    }


    return null;
}


// ============================================================
// CAPTURE PHASE INTERCEPTION
// ============================================================

// Enter key
window.addEventListener(
    "keydown",
    (event) => {

        if (
            event.key !== "Enter" ||
            event.shiftKey
        ) {
            return;
        }


        const textbox =
            getActivePromptElement();


        if (
            textbox &&
            (
                textbox === event.target ||
                textbox.contains(event.target)
            )
        ) {
            checkAndIntercept(event);
        }
    },
    true
);


// Send button
window.addEventListener(
    "pointerdown",
    (event) => {
        checkAndIntercept(event);
    },
    true
);