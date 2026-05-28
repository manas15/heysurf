import { ChromeMessage, AgentUpdate } from '../shared/types';
import { AgentLoop } from './agent-loop';

let agentLoop: AgentLoop | null = null;

// Open side panel when extension icon is clicked
chrome.action.onClicked.addListener((tab) => {
  if (tab.id) {
    chrome.sidePanel.open({ tabId: tab.id });
  }
});

// Enable side panel for all tabs
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

// Handle messages from side panel
chrome.runtime.onMessage.addListener(
  (message: ChromeMessage, sender, sendResponse) => {
    switch (message.type) {
      case 'START_AGENT': {
        handleStartAgent(message.task);
        sendResponse({ success: true });
        return false;
      }

      case 'STOP_AGENT': {
        if (agentLoop) {
          agentLoop.stop();
          agentLoop = null;
        }
        sendResponse({ success: true });
        return false;
      }
    }

    return false;
  },
);

async function handleStartAgent(task: string) {
  // Stop any running agent
  if (agentLoop) {
    agentLoop.stop();
  }

  // Get active tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    broadcastUpdate({ kind: 'error', message: 'No active tab found.' });
    return;
  }

  // Ensure content script is injected
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content/content-script.js'],
    });
  } catch {
    // Script may already be injected, that's fine
  }

  agentLoop = new AgentLoop();

  agentLoop.run(tab.id, task, (update: AgentUpdate) => {
    broadcastUpdate(update);

    if (update.kind === 'done' || update.kind === 'error') {
      agentLoop = null;
    }
  });
}

function broadcastUpdate(update: AgentUpdate) {
  chrome.runtime.sendMessage({
    type: 'AGENT_UPDATE',
    update,
  }).catch(() => {
    // Side panel might not be open
  });
}
