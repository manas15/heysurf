import { TabEntry } from '../shared/types';

const STORAGE_KEY = 'tabRegistry';

async function getRegistry(): Promise<TabEntry[]> {
  const result = await chrome.storage.session.get(STORAGE_KEY);
  return (result[STORAGE_KEY] as TabEntry[] | undefined) ?? [];
}

async function setRegistry(entries: TabEntry[]): Promise<void> {
  await chrome.storage.session.set({ [STORAGE_KEY]: entries });
}

export async function registerTab(
  tabId: number,
  url: string,
  title: string,
  purpose: string,
): Promise<void> {
  const registry = await getRegistry();
  const existing = registry.find((e) => e.tabId === tabId);
  if (existing) {
    existing.url = url;
    existing.title = title;
    existing.purpose = purpose;
    existing.status = 'active';
  } else {
    registry.push({ tabId, url, title, purpose, status: 'active' });
  }
  await setRegistry(registry);
}

export async function deregisterTab(tabId: number): Promise<void> {
  const registry = await getRegistry();
  const filtered = registry.filter((e) => e.tabId !== tabId);
  await setRegistry(filtered);
}

export async function getTabRegistry(): Promise<TabEntry[]> {
  return getRegistry();
}

export async function updateTabInfo(
  tabId: number,
  updates: Partial<Pick<TabEntry, 'url' | 'title' | 'status'>>,
): Promise<void> {
  const registry = await getRegistry();
  const entry = registry.find((e) => e.tabId === tabId);
  if (entry) {
    if (updates.url !== undefined) entry.url = updates.url;
    if (updates.title !== undefined) entry.title = updates.title;
    if (updates.status !== undefined) entry.status = updates.status;
    await setRegistry(registry);
  }
}

export async function openNewTab(url: string, purpose: string): Promise<number> {
  const tab = await chrome.tabs.create({ url, active: false });
  if (!tab.id) throw new Error('Failed to create tab');
  await registerTab(tab.id, url, tab.title || '', purpose);
  return tab.id;
}

export async function switchToTab(tabId: number): Promise<void> {
  const tab = await chrome.tabs.update(tabId, { active: true });
  if (tab && tab.windowId) {
    await chrome.windows.update(tab.windowId, { focused: true });
  }
}

export async function readTabTree(tabId: number): Promise<string> {
  // Ensure content script is injected
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content/content-script.js'],
    });
  } catch {
    // May already be injected
  }

  // Wait a moment for script to initialize
  await new Promise((r) => setTimeout(r, 500));

  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, { type: 'GET_A11Y_TREE' }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else if (!response || !response.tree) {
        reject(new Error('Empty response from tab'));
      } else {
        resolve(
          `Tab ${tabId} - "${response.title}" (${response.url})\n\n${response.tree}`,
        );
      }
    });
  });
}

export async function closeTab(tabId: number): Promise<void> {
  await chrome.tabs.remove(tabId);
  await deregisterTab(tabId);
}

export function getTabContext(registry: TabEntry[]): string {
  if (registry.length === 0) return 'No tracked tabs.';

  const lines = ['Open tabs:'];
  for (const entry of registry) {
    lines.push(
      `  [Tab ${entry.tabId}] ${entry.title || 'Untitled'} (${entry.url}) - ${entry.purpose} [${entry.status}]`,
    );
  }
  return lines.join('\n');
}

// ---- Event listeners (call initTabListeners at top level of service worker) ----

export function initTabListeners(): void {
  chrome.tabs.onRemoved.addListener((tabId) => {
    deregisterTab(tabId);
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    const updates: Partial<Pick<TabEntry, 'url' | 'title' | 'status'>> = {};
    if (changeInfo.url) updates.url = changeInfo.url;
    if (changeInfo.title) updates.title = changeInfo.title;
    if (changeInfo.status === 'loading') updates.status = 'loading';
    if (changeInfo.status === 'complete') updates.status = 'active';

    if (Object.keys(updates).length > 0) {
      updateTabInfo(tabId, updates);
    }
  });
}
