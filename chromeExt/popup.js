// Maps a tab's hostname to a display label. Add new platforms here — and
// don't forget to also add the matching host to manifest.json's
// content_scripts.matches, or the content script simply won't be injected.
const SUPPORTED_PLATFORMS = [
    { test: (host) => host === "chatgpt.com" || host === "chat.openai.com", label: "ChatGPT" },
    { test: (host) => host === "claude.ai", label: "Claude" },
    { test: (host) => host === "gemini.google.com", label: "Gemini" }
];

function detectPlatform(url) {
    if (!url) return null;
    let host;
    try {
        host = new URL(url).hostname;
    } catch {
        return null;
    }
    const match = SUPPORTED_PLATFORMS.find((p) => p.test(host));
    return match ? match.label : null;
}

async function getActiveTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab;
}

async function init() {
    const button = document.getElementById("scanButton");
    const status = document.getElementById("status");

    const tab = await getActiveTab();
    const platform = detectPlatform(tab?.url);

    if (platform) {
        button.textContent = `Scan ${platform}`;
        button.disabled = false;
        status.textContent = `Detected: ${platform}`;
    } else {
        button.textContent = "Scan AI Chat";
        button.disabled = true;
        status.textContent = "Open ChatGPT, Claude, or Gemini to use KeyShield.";
    }

    button.addEventListener("click", async () => {
        status.textContent = "Scanning...";
        button.disabled = true;

        try {
            const activeTab = await getActiveTab();

            chrome.tabs.sendMessage(
                activeTab.id,
                { action: "scanAIInput" },
                (response) => {
                    button.disabled = false;

                    if (chrome.runtime.lastError) {
                        // Most common cause: page loaded before the content script
                        // finished injecting. Refreshing the tab fixes this.
                        status.textContent = "Refresh the page and try again.";
                        return;
                    }

                    if (!response) {
                        status.textContent = "No response.";
                        return;
                    }

                    status.textContent = response.message;
                }
            );
        } catch (error) {
            console.error(error);
            button.disabled = false;
            status.textContent = "Something went wrong.";
        }
    });
}

document.addEventListener("DOMContentLoaded", init);
