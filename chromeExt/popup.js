document.getElementById("scanButton").addEventListener("click", async () => {
    const status = document.getElementById("status");

    status.textContent = "Scanning...";

    try {
        const [tab] = await chrome.tabs.query({
            active: true,
            currentWindow: true
        });

        chrome.tabs.sendMessage(
            tab.id,
            { action: "scanChatGPT" },
            (response) => {
                if (chrome.runtime.lastError) {
                    status.textContent = "Open ChatGPT first.";
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
        status.textContent = "Something went wrong.";
    }
});