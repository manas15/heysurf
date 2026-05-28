import { AgentUpdate, HeySurfSettings, DEFAULT_SETTINGS, TaskPlan } from '../shared/types';
import { getSettings, saveSettings } from '../shared/storage';
import { PROVIDER_INFO } from '../llm/provider';
import {
  startRecording,
  stopRecording,
  speakWithSettings,
  stopSpeaking,
  onStateChange,
  VoiceState,
} from './voice';
import { isOnboardingNeeded, showOnboarding } from './onboarding';
import { showMemoryViewer, hideMemoryViewer } from './memory-viewer';

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
const statusBar = document.getElementById('status-bar')!;
const planDisplay = document.getElementById('plan-display')!;
const planSteps = document.getElementById('plan-steps')!;
const planTitle = document.getElementById('plan-title')!;
const planToggle = document.getElementById('plan-toggle')!;
const memoryViewerBtn = document.getElementById('memory-viewer-btn')!;
const memoryViewerEl = document.getElementById('memory-viewer')!;
const settingsGetKeyLink = document.getElementById('settings-get-key-link') as HTMLAnchorElement;

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
let currentPlan: TaskPlan | null = null;
let planCollapsed = false;

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

// ---- Status Bar ----

function setStatus(text: string) {
  statusBar.textContent = text;
}

// ---- Plan Display ----

function showPlan(plan: TaskPlan) {
  currentPlan = plan;
  planDisplay.classList.remove('hidden');
  planTitle.textContent = `Plan: ${plan.goal}`;
  renderPlanSteps();
}

function renderPlanSteps() {
  if (!currentPlan) return;

  planSteps.innerHTML = currentPlan.steps
    .map((step, i) => {
      let statusIcon = '';
      let statusClass = '';

      switch (step.status) {
        case 'complete':
          statusIcon = '<span class="step-icon step-complete">&#10003;</span>';
          statusClass = 'step-done';
          break;
        case 'failed':
          statusIcon = '<span class="step-icon step-failed">&#10007;</span>';
          statusClass = 'step-error';
          break;
        case 'active':
          statusIcon = '<span class="step-icon step-active"><span class="spinner"></span></span>';
          statusClass = 'step-running';
          break;
        default:
          statusIcon = '<span class="step-icon step-pending">' + (i + 1) + '</span>';
          statusClass = 'step-waiting';
      }

      return `<div class="plan-step ${statusClass}">${statusIcon}<span class="step-desc">${escapeHtml(step.description)}</span></div>`;
    })
    .join('');
}

function hidePlan() {
  planDisplay.classList.add('hidden');
  currentPlan = null;
}

// ---- Voice ----

function initVoice() {
  onStateChange((state: VoiceState) => {
    updateMicButtonState(state);
  });
}

function updateMicButtonState(state: VoiceState) {
  micBtn.classList.remove('listening', 'transcribing');

  switch (state) {
    case 'recording':
      micBtn.classList.add('listening');
      textInput.placeholder = 'Recording...';
      textInput.value = '';
      setStatus('Listening...');
      break;
    case 'transcribing':
      micBtn.classList.add('transcribing');
      textInput.placeholder = 'Transcribing...';
      setStatus('Transcribing...');
      break;
    case 'speaking':
    case 'idle':
      textInput.placeholder = 'Type a command...';
      if (!isAgentRunning) setStatus('Ready');
      break;
  }
}

async function handleMicClick() {
  if (!currentSettings.voice.inputEnabled) return;

  const isRecording = micBtn.classList.contains('listening');

  if (isRecording) {
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
    const icon = extra === 'error' ? '&#10007;' : extra === 'success' ? '&#10003;' : '&rarr;';
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
  setStatus('Planning...');
  hidePlan();

  chrome.runtime.sendMessage({ type: 'START_AGENT', task });
}

function stopAgent() {
  chrome.runtime.sendMessage({ type: 'STOP_AGENT' });
  isAgentRunning = false;
  stopBtn.classList.add('hidden');
  setStatus('Ready');
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

    case 'plan_created':
      showPlan(update.plan);
      setStatus(`Executing Step 1/${update.plan.steps.length}...`);
      break;

    case 'step_started':
      if (currentPlan) {
        // Reset all to pending/complete, mark this one active
        currentPlan.steps.forEach((s, i) => {
          if (i === update.stepIndex) s.status = 'active';
        });
        renderPlanSteps();
        setStatus(`Executing Step ${update.stepIndex + 1}/${currentPlan.steps.length}...`);
      }
      break;

    case 'step_complete':
      if (currentPlan && currentPlan.steps[update.stepIndex]) {
        currentPlan.steps[update.stepIndex].status = 'complete';
        currentPlan.steps[update.stepIndex].result = update.result;
        renderPlanSteps();
      }
      break;

    case 'step_failed':
      if (currentPlan && currentPlan.steps[update.stepIndex]) {
        currentPlan.steps[update.stepIndex].status = 'failed';
        renderPlanSteps();
      }
      break;

    case 'replanning':
      setStatus('Replanning...');
      addMessage('thinking', `Replanning: ${update.reason}`);
      break;

    case 'done':
      isAgentRunning = false;
      stopBtn.classList.add('hidden');
      setStatus('Done');
      const thinkingDone = messagesEl.querySelector('.message.thinking');
      if (thinkingDone) thinkingDone.remove();
      const lastMsg = messagesEl.lastElementChild;
      if (!lastMsg?.classList.contains('speaking') || lastMsg.textContent !== update.summary) {
        addMessage('assistant', update.summary);
      }
      // Reset status after a moment
      setTimeout(() => {
        if (!isAgentRunning) setStatus('Ready');
      }, 3000);
      break;

    case 'error':
      isAgentRunning = false;
      stopBtn.classList.add('hidden');
      setStatus('Error');
      const thinkingErr = messagesEl.querySelector('.message.thinking');
      if (thinkingErr) thinkingErr.remove();
      addMessage('action', update.message, 'error');
      setTimeout(() => {
        if (!isAgentRunning) setStatus('Ready');
      }, 3000);
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
  updateGetKeyLink();
}

function updateModelHint() {
  const hint = MODEL_HINTS[providerSelect.value];
  if (hint) {
    modelHint.textContent = hint.hint;
  }
}

function updateGetKeyLink() {
  const info = PROVIDER_INFO[providerSelect.value];
  if (info) {
    settingsGetKeyLink.href = info.keyUrl;
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
  updateGetKeyLink();
});

voiceRateSlider.addEventListener('input', () => {
  rateValue.textContent = parseFloat(voiceRateSlider.value).toFixed(1);
});

// Plan toggle (collapse/expand)
planToggle.addEventListener('click', () => {
  planCollapsed = !planCollapsed;
  planSteps.classList.toggle('collapsed', planCollapsed);
  planToggle.querySelector('.plan-chevron')!.classList.toggle('rotated', planCollapsed);
});

// Memory viewer
memoryViewerBtn.addEventListener('click', () => {
  settingsPanel.classList.add('hidden');
  showMemoryViewer(memoryViewerEl);
});

// ---- Init ----

async function init() {
  await loadSettings();
  initVoice();

  const needsOnboarding = await isOnboardingNeeded();
  if (needsOnboarding) {
    await showOnboarding();
    // Reload settings after onboarding (API key was set)
    await loadSettings();
  }
}

init();
