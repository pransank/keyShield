chrome.commands.onCommand.addListener(async (command) => {
    if (command === "_execute_action") {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab) {
            // Updated to match the listener in content.js
            chrome.tabs.sendMessage(tab.id, { action: "scanAIInput" });
        }
    }
});