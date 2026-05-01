chrome.runtime.onInstalled.addListener(() => { 
  chrome.action.setBadgeText({ text: "OFF" });
});

const extensions = 'https://developer.chrome.com/docs/extensions';
const webstore = 'https://developer.chrome.com/docs/webstore';

chrome.action.onClicked.addListener(async (tab: chrome.tabs.Tab) => {
  if(tab.url?.startsWith(extensions) || tab.url?.startsWith(webstore)) {
    const prevState = await chrome.action.getBadgeText({ tabId: tab.id! });
    const nextState = prevState === "ON" ? "OFF" : "ON";
    await chrome.action.setBadgeText({ text: nextState, tabId: tab.id! });

    if (nextState === "ON") {
      // Insert the CSS file when the user turns the extension on
      await chrome.scripting.insertCSS({
        files: ["focus-mode.css"],
        target: { tabId: tab.id! },
      });
    } else if (nextState === "OFF") {
      // Remove the CSS file when the user turns the extension off
      await chrome.scripting.removeCSS({
        files: ["focus-mode.css"],
        target: { tabId: tab.id! },
      });
    }
  }
});
