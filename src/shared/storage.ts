import { HeySurfSettings, DEFAULT_SETTINGS, UserProfile, Memory, TaskRecord } from './types';

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

// ---- User Profile ----

export async function getUserProfile(): Promise<UserProfile | null> {
  const result = await chrome.storage.local.get('userProfile');
  return (result.userProfile as UserProfile | undefined) ?? null;
}

export async function saveUserProfile(profile: UserProfile): Promise<void> {
  await chrome.storage.local.set({ userProfile: profile });
}

// ---- Memories ----

export async function getMemories(): Promise<Memory[]> {
  const result = await chrome.storage.local.get('memories');
  return (result.memories as Memory[] | undefined) ?? [];
}

export async function addMemory(memory: Memory): Promise<void> {
  const memories = await getMemories();
  memories.push(memory);
  await chrome.storage.local.set({ memories });
}

export async function deleteMemory(id: string): Promise<void> {
  const memories = await getMemories();
  const filtered = memories.filter((m) => m.id !== id);
  await chrome.storage.local.set({ memories: filtered });
}

export async function clearAllMemories(): Promise<void> {
  await chrome.storage.local.set({ memories: [] });
}

// ---- Task History ----

export async function getTaskHistory(): Promise<TaskRecord[]> {
  const result = await chrome.storage.local.get('taskHistory');
  return (result.taskHistory as TaskRecord[] | undefined) ?? [];
}

export async function addTaskRecord(record: TaskRecord): Promise<void> {
  const history = await getTaskHistory();
  history.push(record);
  // Keep last 100 records
  if (history.length > 100) {
    history.splice(0, history.length - 100);
  }
  await chrome.storage.local.set({ taskHistory: history });
}
