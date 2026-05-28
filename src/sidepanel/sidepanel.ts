import { AgentUpdate, HeySurfSettings, DEFAULT_SETTINGS } from '../shared/types';
import { getSettings, saveSettings } from '../shared/storage';

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

let isListening = false;
let isAgentRunning = false;
let recognition: any = null;
let currentSettings: HeySurfSettings = { ...DEFAULT_SETTINGS };

// ---- Model Hints ----

const MODEL_HINTS: Record<string, { model: string; hint: string }> = {
  openai: { model: 'gpt-4o', hint: 'Recommended: gpt-4o, gpt-4o-mini (cheaper)' },
  anthropic: { model: 'claude-sonnet-4-6-20250514', hint: 'Recommended: claude-sonnet-4-6-20250514' },
  gemini: { model: 'gemini-2.0-flash', hint: 'Recommended: gemini-2.0-flash, gemini-2.5-pro' },
};

// ---- Voice ----

function initVoice() {
  const SpeechRecognition =
    (window as any).SpeechRecognition ||
    (window as any).webkitSpeechRecognition;

  if (!SpeechRecognition) {
    micBtn.style.display = 'none';
    return;
  }

  recognition = new SpeechRecognition();
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.lang = currentSettings.voice.language;

  recognition.onresult = (event: any) => {
    let transcript = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      transcript += event.results[i][0].transcript;
    }
    textInput.value = transcript;

    // If final result, submit
    if (event.results[event.results.length - 1].isFinal) {
      stopListening();
      if (transcript.trim()) {
        submitTask(transcript.trim());
      }
    }
  };

  recognition.onerror = () => {
    stopListening();
  };

  recognition.onend = () => {
    stopListening();
  };
}

function startListening() {
  if (!recognition || !currentSettings.voice.inputEnabled) return;
  isListening = true;
  micBtn.classList.add('listening');
  textInput.placeholder = 'Listening...';
  textInput.value = '';
  recognition.start();
}

function stopListening() {
  isListening = false;
  micBtn.classList.remove('listening');
  textInput.placeholder = 'Type a command...';
  try {
    recognition?.stop();
  } catch {
    // may already be stopped
  }
}

function speak(text: string) {
  if (!currentSettings.voice.outputEnabled) return;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = currentSettings.voice.rate;
  if (currentSettings.voice.voiceURI) {
    const voices = speechSynthesis.getVoices();
    const voice = voices.find((v) => v.voiceURI === currentSettings.voice.voiceURI);
    if (voice) utterance.voice = voice;
  }
  speechSynthesis.speak(utterance);
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

micBtn.addEventListener('click', () => {
  if (isListening) {
    stopListening();
  } else {
    startListening();
  }
});

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
