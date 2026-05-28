import { HeySurfSettings, DEFAULT_SETTINGS } from './types';

export async function getSettings(): Promise<HeySurfSettings> {
  const result = await chrome.storage.local.get('settings');
  if (!result.settings) return { ...DEFAULT_SETTINGS };
  return { ...DEFAULT_SETTINGS, ...result.settings };
}

export async function saveSettings(settings: HeySurfSettings): Promise<void> {
  await chrome.storage.local.set({ settings });
}

export async function getApiKey(): Promise<string> {
  const settings = await getSettings();
  return settings.llm.apiKey;
}
