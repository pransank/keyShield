async function scanChatGPT() {
    const textbox = document.querySelector("#prompt-textarea");

    if (!textbox) {
        return {
            message: "Could not find ChatGPT textbox."
        };
    }

    const code = textbox.value || "";

    console.log("KeyShield found textbox:", textbox);
    console.log("KeyShield textbox content:", code);

    if (!code.trim()) {
        return {
            message: "Textbox is empty."
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

        console.log("KeyShield backend response:", result);

        if (result.secrets_detected.length === 0) {
            return {
                message: "No secrets detected."
            };
        }

        textbox.value = result.secured_code;

        // Tell ChatGPT that the textbox changed
        textbox.dispatchEvent(
            new Event("input", {
                bubbles: true
            })
        );

        return {
            message:
                `${result.secrets_detected.length} secret(s) secured.`
        };

    } catch (error) {
        console.error("KeyShield error:", error);

        return {
            message: "Could not connect to KeyShield backend."
        };
    }
}


chrome.runtime.onMessage.addListener(
    (request, sender, sendResponse) => {

        if (request.action === "scanChatGPT") {
            scanChatGPT().then(sendResponse);

            return true;
        }
    }
);