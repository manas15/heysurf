import { AgentUpdate, HeySurfSettings, DEFAULT_SETTINGS } from '../shared/types';
import { getSettings, saveSettings } from '../shared/storage';
import {
  startRecording,
  stopRecording,
  speakWithSettings,
  stopSpeaking,
  onStateChange,
  VoiceState,
} from './voice';

// ---- DOM References ----

const messagesEl = document.getElementById('messages')!;
const textInput = document.getElementById('text-input') as HTMLInputElement;
const micBtn = document.getElementById('mic-btn')!;
const sendBtn = document.getElementById('send-btn')!;
const stopBtn = document.getElementById('stop-btn')!;
const settingsBtn = document.getElementById('settings-btn')!;
const settingsPanel = document.getElementById('settings-panel')!;
const settingsClose = document.getElementById('settings-close')!;
const settingsSave = document.getElementById('settings-save')!;

// Settings inputs
const providerSelect = document.getElementById('setting-provider') as HTMLSelectElement;
const apiKeyInput = document.getElementById('setting-api-key') as HTMLInputElement;
const modelInput = document.getElementById('setting-model') as HTMLInputElement;
const modelHint = document.getElementById('model-hint')!;
const voiceInputToggle = document.getElementById('setting-voice-input') as HTMLInputElement;
const voiceOutputToggle = document.getElementById('setting-voice-output') as HTMLInputElement;
const voiceRateSlider = document.getElementById('setting-voice-rate') as HTMLInputElement;
const rateValue = document.getElementById('rate-value')!;
const maxStepsInput = document.getElementById('setting-max-steps') as HTMLInputElement;
const confirmDestructiveToggle = document.getElementById('setting-confirm-destructive') as HTMLInputElement;
const highlightToggle = document.getElementById('setting-highlight') as HTMLInputElement;

// ---- State ----

let isAgentRunning = false;
let currentSettings: HeySurfSettings = { ...DEFAULT_SETTINGS };

// ---- Model Hints ----

const MODEL_HINTS: Record<string, { model: string; hint: string }> = {
  openai: { model: 'gpt-4o', hint: 'gpt-4o, gpt-4o-mini, o3-mini' },
  anthropic: { model: 'claude-sonnet-4-6-20250514', hint: 'claude-sonnet-4-6, claude-haiku-4-5' },
  gemini: { model: 'gemini-2.0-flash', hint: 'gemini-2.0-flash, gemini-2.5-pro' },
  groq: { model: 'llama-3.3-70b-versatile', hint: 'llama-3.3-70b, mixtral-8x7b (ultra fast)' },
  mistral: { model: 'mistral-large-latest', hint: 'mistral-large, mistral-small' },
  deepseek: { model: 'deepseek-chat', hint: 'deepseek-chat, deepseek-reasoner (cheapest)' },
  xai: { model: 'grok-3-mini', hint: 'grok-3, grok-3-mini' },
  together: { model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', hint: 'Llama 3.3, Qwen, Mixtral' },
  openrouter: { model: 'openai/gpt-4o', hint: 'Any model — one key for all providers' },
};

// ---- Voice ----

function initVoice() {
  // Update mic button and input placeholder based on voice state changes
  onStateChange((state: VoiceState) => {
    updateMicButtonState(state);
  });
}

function updateMicButtonState(state: VoiceState) {
  // Remove all voice-state classes
  micBtn.classList.remove('listening', 'transcribing');

  switch (state) {
    case 'recording':
      micBtn.classList.add('listening');
      textInput.placeholder = 'Recording...';
      textInput.value = '';
      break;
    case 'transcribing':
      micBtn.classList.add('transcribing');
      textInput.placeholder = 'Transcribing...';
      break;
    case 'speaking':
    case 'idle':
      textInput.placeholder = 'Type a command...';
      break;
  }
}

async function handleMicClick() {
  if (!currentSettings.voice.inputEnabled) return;

  // Get voice module's current state from the button classes
  const isRecording = micBtn.classList.contains('listening');

  if (isRecording) {
    // Stop recording and get transcript
    try {
      const transcript = await stopRecording();
      if (transcript.trim()) {
        textInput.value = transcript;
        submitTask(transcript.trim());
      }
    } catch (err: any) {
      addMessage('system', `Voice error: ${err.message || 'Failed to transcribe'}`);
    }
  } else {
    // Start recording
    try {
      await startRecording();
    } catch (err: any) {
      addMessage('system', `Mic error: ${err.message || 'Could not access microphone'}`);
    }
  }
}

function speak(text: string) {
  if (!currentSettings.voice.outputEnabled) return;
  speakWithSettings(text, currentSettings.voice.rate, currentSettings.voice.voiceURI);
}

// ---- Messages ----

function addMessage(
  type: 'user' | 'assistant' | 'system' | 'action' | 'thinking' | 'speaking',
  text: string,
  extra?: string,
) {
  const div = document.createElement('div');
  div.className = `message ${type}`;

  if (extra) {
    div.classList.add(extra);
  }

  if (type === 'action') {
    const icon = extra === 'error' ? '✗' : extra === 'success' ? '✓' : '→';
    div.innerHTML = `<span class="action-icon">${icon}</span> ${escapeHtml(text)}`;
  } else {
    div.textContent = text;
  }

  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return div;
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ---- Agent Control ----

function submitTask(task: string) {
  if (!task.trim() || isAgentRunning) return;

  addMessage('user', task);
  textInput.value = '';
  isAgentRunning = true;
  stopBtn.classList.remove('hidden');

  chrome.runtime.sendMessage({ type: 'START_AGENT', task });
}

function stopAgent() {
  chrome.runtime.sendMessage({ type: 'STOP_AGENT' });
  isAgentRunning = false;
  stopBtn.classList.add('hidden');
  addMessage('system', 'Agent stopped.');
}

// ---- Handle Agent Updates ----

chrome.runtime.onMessage.addListener((message) => {
  if (message.type !== 'AGENT_UPDATE') return;

  const update: AgentUpdate = message.update;

  switch (update.kind) {
    case 'thinking':
      // Remove previous thinking message
      const prev = messagesEl.querySelector('.message.thinking');
      if (prev) prev.remove();
      addMessage('thinking', update.message);
      break;

    case 'action':
      addMessage('action', update.description);
      break;

    case 'action_result':
      if (!update.success) {
        addMessage('action', update.message, 'error');
      }
      break;

    case 'speaking':
      // Remove thinking message
      const thinking = messagesEl.querySelector('.message.thinking');
      if (thinking) thinking.remove();
      addMessage('speaking', update.text);
      speak(update.text);
      break;

    case 'done':
      isAgentRunning = false;
      stopBtn.classList.add('hidden');
      // Remove thinking message
      const thinkingDone = messagesEl.querySelector('.message.thinking');
      if (thinkingDone) thinkingDone.remove();
      // Only add done message if it's different from the last speaking message
      const lastMsg = messagesEl.lastElementChild;
      if (!lastMsg?.classList.contains('speaking') || lastMsg.textContent !== update.summary) {
        addMessage('assistant', update.summary);
      }
      break;

    case 'error':
      isAgentRunning = false;
      stopBtn.classList.add('hidden');
      const thinkingErr = messagesEl.querySelector('.message.thinking');
      if (thinkingErr) thinkingErr.remove();
      addMessage('action', update.message, 'error');
      break;
  }
});

// ---- Settings ----

async function loadSettings() {
  currentSettings = await getSettings();

  providerSelect.value = currentSettings.llm.provider;
  apiKeyInput.value = currentSettings.llm.apiKey;
  modelInput.value = currentSettings.llm.model;
  voiceInputToggle.checked = currentSettings.voice.inputEnabled;
  voiceOutputToggle.checked = currentSettings.voice.outputEnabled;
  voiceRateSlider.value = String(currentSettings.voice.rate);
  rateValue.textContent = String(currentSettings.voice.rate);
  maxStepsInput.value = String(currentSettings.agent.maxSteps);
  confirmDestructiveToggle.checked = currentSettings.agent.confirmDestructive;
  highlightToggle.checked = currentSettings.agent.highlightActions;
  updateModelHint();
}

function updateModelHint() {
  const hint = MODEL_HINTS[providerSelect.value];
  if (hint) {
    modelHint.textContent = hint.hint;
  }
}

async function handleSaveSettings() {
  const hint = MODEL_HINTS[providerSelect.value];

  currentSettings = {
    llm: {
      provider: providerSelect.value as HeySurfSettings['llm']['provider'],
      apiKey: apiKeyInput.value.trim(),
      model: modelInput.value.trim() || hint?.model || 'gpt-4o',
    },
    voice: {
      inputEnabled: voiceInputToggle.checked,
      outputEnabled: voiceOutputToggle.checked,
      language: currentSettings.voice.language,
      voiceURI: currentSettings.voice.voiceURI,
      rate: parseFloat(voiceRateSlider.value),
    },
    agent: {
      maxSteps: parseInt(maxStepsInput.value) || 15,
      confirmDestructive: confirmDestructiveToggle.checked,
      autoScroll: true,
      highlightActions: highlightToggle.checked,
    },
  };

  await saveSettings(currentSettings);
  settingsPanel.classList.add('hidden');
  addMessage('system', 'Settings saved.');
}

// ---- Event Listeners ----

micBtn.addEventListener('click', handleMicClick);

sendBtn.addEventListener('click', () => {
  submitTask(textInput.value);
});

textInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    submitTask(textInput.value);
  }
});

stopBtn.addEventListener('click', stopAgent);

settingsBtn.addEventListener('click', () => {
  settingsPanel.classList.remove('hidden');
});

settingsClose.addEventListener('click', () => {
  settingsPanel.classList.add('hidden');
});

settingsSave.addEventListener('click', handleSaveSettings);

providerSelect.addEventListener('change', () => {
  const hint = MODEL_HINTS[providerSelect.value];
  if (hint) {
    modelInput.value = hint.model;
    updateModelHint();
  }
});

voiceRateSlider.addEventListener('input', () => {
  rateValue.textContent = parseFloat(voiceRateSlider.value).toFixed(1);
});

// ---- Init ----

loadSettings().then(() => {
  initVoice();
});
