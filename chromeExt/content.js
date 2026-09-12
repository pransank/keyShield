async function scanChatGPT() {
    // 1. Locate the input element
    const textbox = document.querySelector("#prompt-textarea");

    if (!textbox) {
        return {
            message: "Could not find ChatGPT textbox."
        };
    }

    // 2. Check element type and retrieve text safely
    const isEditable = textbox.isContentEditable;
    const code = isEditable ? textbox.innerText : textbox.value;

    console.log("KeyShield textbox:", textbox);
    console.log("KeyShield code:", code);

    if (!code || !code.trim()) {
        return {
            message: "Textbox is empty."
        };
    }

    try {
        // 3. Send text to local scan backend
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

        console.log("KeyShield result:", result);

        if (!result.secrets_detected || result.secrets_detected.length === 0) {
            return {
                message: "No secrets detected."
            };
        }

        // 4. Update element content based on input type
        if (isEditable) {
            // For div contenteditable (ProseMirror)
            textbox.innerText = result.secured_code;
        } else {
            // For standard HTMLTextAreaElement (React bypass)
            const setter = Object.getOwnPropertyDescriptor(
                HTMLTextAreaElement.prototype,
                "value"
            ).set;
            setter.call(textbox, result.secured_code);
        }

        // 5. Trigger input event so underlying editor state updates
        textbox.dispatchEvent(
            new Event("input", {
                bubbles: true
            })
        );

        return {
            message: `${result.secrets_detected.length} secret(s) secured.`
        };

    } catch (error) {
        console.error("KeyShield error:", error);

        return {
            message: "Could not connect to KeyShield backend."
        };
    }
}

// 6. Chrome Runtime Message Listener
chrome.runtime.onMessage.addListener(
    (request, sender, sendResponse) => {
        if (request.action === "scanChatGPT") {
            scanChatGPT().then(sendResponse);
            return true; // Keeps async channel open for sendResponse
        }
    }
);