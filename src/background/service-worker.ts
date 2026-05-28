import { ChromeMessage, AgentUpdate } from '../shared/types';
import { AgentLoop } from './agent-loop';
import { initTabListeners } from './tab-manager';

let agentLoop: AgentLoop | null = null;

// Initialize tab manager event listeners at top level (survives SW restarts)
initTabListeners();

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

  // Send INIT_OVERLAY to content script
  try {
    chrome.tabs.sendMessage(tab.id, { type: 'INIT_OVERLAY' });
  } catch {
    // best-effort
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
      // Send DESTROY_OVERLAY to content script
      if (tab.id) {
        try {
          chrome.tabs.sendMessage(tab.id, { type: 'DESTROY_OVERLAY' });
        } catch {
          // best-effort
        }
      }
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
