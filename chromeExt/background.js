chrome.commands.onCommand.addListener(async (command) => {
    console.log("Shortcut triggered:", command); // Check if the shortcut works
    
    if (command === "run-scan") {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        console.log("Found active tab:", tab); // Check if it found the tab
        
        if (tab) {
            chrome.tabs.sendMessage(tab.id, { action: "scanAIInput" }, (response) => {
                if (chrome.runtime.lastError) {
                    console.error("Message error:", chrome.runtime.lastError.message);
                } else {
                    console.log("Response from page:", response);
                }
            });
        }
    }
});