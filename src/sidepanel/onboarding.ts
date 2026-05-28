import { UserProfile } from '../shared/types';
import { getUserProfile, saveUserProfile, getSettings, saveSettings } from '../shared/storage';
import { PROVIDER_INFO } from '../llm/provider';

// ---- Exports ----

export async function isOnboardingNeeded(): Promise<boolean> {
  const profile = await getUserProfile();
  return !profile || !profile.onboardingComplete;
}

export async function showOnboarding(): Promise<void> {
  const container = document.getElementById('onboarding')!;
  const chatArea = document.getElementById('chat-area')!;
  const inputArea = document.getElementById('input-area')!;
  const statusBar = document.getElementById('status-bar')!;

  container.classList.remove('hidden');
  chatArea.classList.add('hidden');
  inputArea.classList.add('hidden');
  statusBar.classList.add('hidden');

  return new Promise<void>((resolve) => {
    runOnboardingFlow(container, () => {
      container.classList.add('hidden');
      chatArea.classList.remove('hidden');
      inputArea.classList.remove('hidden');
      statusBar.classList.remove('hidden');
      resolve();
    });
  });
}

// ---- Internal State ----

interface OnboardingState {
  provider: string;
  apiKey: string;
  model: string;
  name: string;
  email: string;
  role: string;
  preferredSites: string[];
}

const state: OnboardingState = {
  provider: '',
  apiKey: '',
  model: '',
  name: '',
  email: '',
  role: '',
  preferredSites: [],
};

// ---- Flow ----

function runOnboardingFlow(container: HTMLElement, onComplete: () => void) {
  renderStep0(container, onComplete);
}

// ---- Step 0: API Key Setup ----

function renderStep0(container: HTMLElement, onComplete: () => void) {
  const providers = Object.entries(PROVIDER_INFO);

  container.innerHTML = `
    <div class="onboarding-inner">
      <div class="onboarding-header">
        <span class="onboarding-logo">🏄</span>
        <h2>Welcome to HeySurf</h2>
        <p class="onboarding-subtitle">Let's get you set up in under a minute.</p>
      </div>

      <div class="progress-dots">
        <span class="dot active"></span>
        <span class="dot"></span>
        <span class="dot"></span>
        <span class="dot"></span>
        <span class="dot"></span>
      </div>

      <div class="step-content">
        <h3 class="step-title">Choose your AI provider</h3>
        <div class="provider-grid">
          ${providers
            .map(
              ([key, info]) => `
            <button class="provider-card" data-provider="${key}">
              <span class="provider-name">${info.name}</span>
              <span class="provider-model">${info.defaultModel}</span>
            </button>
          `,
            )
            .join('')}
        </div>

        <div id="api-key-section" class="hidden api-key-section">
          <div class="selected-provider-banner" id="selected-provider-banner"></div>

          <div class="api-key-input-group">
            <label for="onboard-api-key">API Key</label>
            <input type="password" id="onboard-api-key" placeholder="Paste your API key..." autocomplete="off">
            <div id="key-format-hint" class="setting-hint"></div>
          </div>

          <div class="api-key-actions">
            <button id="test-connection-btn" class="secondary-btn">Test Connection</button>
            <a id="get-key-link" href="#" target="_blank" class="get-key-link">Get API Key &rarr;</a>
          </div>

          <div id="connection-status" class="connection-status hidden"></div>

          <button id="continue-to-profile" class="primary-btn continue-btn hidden">Continue</button>
        </div>
      </div>
    </div>
  `;

  // Bind provider card clicks
  const cards = container.querySelectorAll('.provider-card');
  const apiKeySection = container.querySelector('#api-key-section')!;
  const apiKeyInput = container.querySelector('#onboard-api-key') as HTMLInputElement;
  const formatHint = container.querySelector('#key-format-hint')!;
  const testBtn = container.querySelector('#test-connection-btn')!;
  const getKeyLink = container.querySelector('#get-key-link') as HTMLAnchorElement;
  const connectionStatus = container.querySelector('#connection-status')!;
  const continueBtn = container.querySelector('#continue-to-profile')!;
  const providerBanner = container.querySelector('#selected-provider-banner')!;

  cards.forEach((card) => {
    card.addEventListener('click', () => {
      cards.forEach((c) => c.classList.remove('selected'));
      card.classList.add('selected');

      const providerKey = (card as HTMLElement).dataset.provider!;
      const info = PROVIDER_INFO[providerKey];
      state.provider = providerKey;
      state.model = info.defaultModel;

      providerBanner.textContent = `${info.name} — ${info.hint}`;
      formatHint.textContent = info.keyPrefix
        ? `Key should start with "${info.keyPrefix}"`
        : 'Paste your full API key';
      getKeyLink.href = info.keyUrl;

      apiKeySection.classList.remove('hidden');
      connectionStatus.classList.add('hidden');
      continueBtn.classList.add('hidden');
      apiKeyInput.value = '';
      apiKeyInput.focus();
    });
  });

  // Test connection
  testBtn.addEventListener('click', async () => {
    const key = apiKeyInput.value.trim();
    if (!key) {
      showConnectionStatus(connectionStatus, false, 'Please enter an API key.');
      return;
    }

    const info = PROVIDER_INFO[state.provider];
    if (info.keyPrefix && !key.startsWith(info.keyPrefix)) {
      showConnectionStatus(
        connectionStatus,
        false,
        `Key should start with "${info.keyPrefix}". Check that you copied the full key.`,
      );
      return;
    }

    state.apiKey = key;
    testBtn.textContent = 'Testing...';
    (testBtn as HTMLButtonElement).disabled = true;

    try {
      const ok = await testApiKey(state.provider, key, state.model);
      if (ok) {
        showConnectionStatus(connectionStatus, true, 'Connected! Your key works.');
        continueBtn.classList.remove('hidden');
      } else {
        showConnectionStatus(connectionStatus, false, 'Could not connect. Check your key and try again.');
      }
    } catch (err: any) {
      showConnectionStatus(connectionStatus, false, err.message || 'Connection failed.');
    } finally {
      testBtn.textContent = 'Test Connection';
      (testBtn as HTMLButtonElement).disabled = false;
    }
  });

  // Continue to profile questions
  continueBtn.addEventListener('click', async () => {
    // Save settings now so the key is persisted
    const settings = await getSettings();
    settings.llm.provider = state.provider as any;
    settings.llm.apiKey = state.apiKey;
    settings.llm.model = state.model;
    await saveSettings(settings);

    renderProfileQuestions(container, onComplete);
  });
}

function showConnectionStatus(el: Element, success: boolean, message: string) {
  el.classList.remove('hidden', 'status-success', 'status-error');
  el.classList.add(success ? 'status-success' : 'status-error');
  el.innerHTML = `<span class="status-icon">${success ? '&#10003;' : '&#10007;'}</span> ${escapeHtml(message)}`;
}

async function testApiKey(provider: string, apiKey: string, model: string): Promise<boolean> {
  // Minimal test: send a tiny chat completion request
  // We build a simple fetch to the provider's API
  const endpoints: Record<string, { url: string; buildBody: () => any; headers: Record<string, string> }> = {
    openai: {
      url: 'https://api.openai.com/v1/chat/completions',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      buildBody: () => ({ model, messages: [{ role: 'user', content: 'Hi' }], max_tokens: 1 }),
    },
    anthropic: {
      url: 'https://api.anthropic.com/v1/messages',
      headers: {
        'x-api-key': apiKey,
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      buildBody: () => ({ model, messages: [{ role: 'user', content: 'Hi' }], max_tokens: 1 }),
    },
    gemini: {
      url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      headers: { 'Content-Type': 'application/json' },
      buildBody: () => ({ contents: [{ parts: [{ text: 'Hi' }] }], generationConfig: { maxOutputTokens: 1 } }),
    },
    groq: {
      url: 'https://api.groq.com/openai/v1/chat/completions',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      buildBody: () => ({ model, messages: [{ role: 'user', content: 'Hi' }], max_tokens: 1 }),
    },
    mistral: {
      url: 'https://api.mistral.ai/v1/chat/completions',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      buildBody: () => ({ model, messages: [{ role: 'user', content: 'Hi' }], max_tokens: 1 }),
    },
    deepseek: {
      url: 'https://api.deepseek.com/v1/chat/completions',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      buildBody: () => ({ model, messages: [{ role: 'user', content: 'Hi' }], max_tokens: 1 }),
    },
    xai: {
      url: 'https://api.x.ai/v1/chat/completions',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      buildBody: () => ({ model, messages: [{ role: 'user', content: 'Hi' }], max_tokens: 1 }),
    },
    together: {
      url: 'https://api.together.xyz/v1/chat/completions',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      buildBody: () => ({ model, messages: [{ role: 'user', content: 'Hi' }], max_tokens: 1 }),
    },
    openrouter: {
      url: 'https://openrouter.ai/api/v1/chat/completions',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://heysurf.app',
        'X-Title': 'HeySurf',
      },
      buildBody: () => ({ model, messages: [{ role: 'user', content: 'Hi' }], max_tokens: 1 }),
    },
  };

  const config = endpoints[provider];
  if (!config) return false;

  const resp = await fetch(config.url, {
    method: 'POST',
    headers: config.headers,
    body: JSON.stringify(config.buildBody()),
  });

  // 200 or 201 = success. Some providers return 200 even for short replies.
  return resp.ok;
}

// ---- Steps 1-4: Profile Questions ----

const PROFILE_QUESTIONS = [
  {
    key: 'name' as const,
    question: "What should I call you?",
    placeholder: 'Your name...',
    suggestions: [] as string[],
  },
  {
    key: 'email' as const,
    question: "What email do you use most for signups?",
    placeholder: 'you@example.com',
    suggestions: [] as string[],
  },
  {
    key: 'role' as const,
    question: "What do you do?",
    placeholder: 'Your role...',
    suggestions: ['Developer', 'Designer', 'PM', 'Founder', 'Student', 'Other'],
  },
  {
    key: 'sites' as const,
    question: "What sites will you use me on most?",
    placeholder: 'e.g., gmail.com, github.com, twitter.com',
    suggestions: ['Gmail', 'GitHub', 'Twitter/X', 'LinkedIn', 'Amazon', 'Google Docs'],
  },
];

function renderProfileQuestions(container: HTMLElement, onComplete: () => void) {
  let currentStep = 0;

  container.innerHTML = `
    <div class="onboarding-inner">
      <div class="onboarding-header compact">
        <span class="onboarding-logo">🏄</span>
        <h2>HeySurf</h2>
      </div>
      <div class="progress-dots" id="profile-progress"></div>
      <div class="chat-conversation" id="onboard-conversation"></div>
      <div class="onboard-input-area" id="onboard-input-area"></div>
    </div>
  `;

  const conversation = container.querySelector('#onboard-conversation')!;
  const inputArea = container.querySelector('#onboard-input-area')!;

  function updateProgress() {
    const progress = container.querySelector('#profile-progress')!;
    progress.innerHTML = '';
    for (let i = 0; i < 5; i++) {
      const dot = document.createElement('span');
      dot.className = 'dot' + (i <= currentStep + 1 ? ' active' : '');
      // Step 0 (API key) is done, so offset by 1
      if (i < currentStep + 1) dot.classList.add('completed');
      progress.appendChild(dot);
    }
  }

  function addBubble(text: string, type: 'agent' | 'user') {
    const bubble = document.createElement('div');
    bubble.className = `onboard-bubble ${type}`;
    bubble.textContent = text;
    // Small entry animation
    bubble.style.opacity = '0';
    bubble.style.transform = 'translateY(8px)';
    conversation.appendChild(bubble);

    // Trigger reflow then animate in
    requestAnimationFrame(() => {
      bubble.style.transition = 'opacity 0.3s, transform 0.3s';
      bubble.style.opacity = '1';
      bubble.style.transform = 'translateY(0)';
    });

    conversation.scrollTop = conversation.scrollHeight;
  }

  function askQuestion() {
    if (currentStep >= PROFILE_QUESTIONS.length) {
      finishOnboarding();
      return;
    }

    const q = PROFILE_QUESTIONS[currentStep];
    updateProgress();

    // Add agent question bubble after a small delay for effect
    setTimeout(() => {
      addBubble(q.question, 'agent');

      // Show input
      inputArea.innerHTML = `
        <div class="onboard-input-row">
          <input type="text" id="onboard-answer" placeholder="${q.placeholder}" autocomplete="off">
          <button id="onboard-submit" class="send-btn" title="Submit">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
            </svg>
          </button>
        </div>
        ${
          q.suggestions.length
            ? `<div class="suggestion-chips">${q.suggestions.map((s) => `<button class="chip">${s}</button>`).join('')}</div>`
            : ''
        }
        <button class="skip-btn">Skip</button>
      `;

      const input = inputArea.querySelector('#onboard-answer') as HTMLInputElement;
      const submitBtn = inputArea.querySelector('#onboard-submit')!;
      const skipBtn = inputArea.querySelector('.skip-btn')!;
      const chips = inputArea.querySelectorAll('.chip');

      input.focus();

      function submit() {
        const value = input.value.trim();
        if (!value) return;

        addBubble(value, 'user');
        saveAnswer(q.key, value);
        currentStep++;
        askQuestion();
      }

      submitBtn.addEventListener('click', submit);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          submit();
        }
      });

      skipBtn.addEventListener('click', () => {
        addBubble('(skipped)', 'user');
        currentStep++;
        askQuestion();
      });

      chips.forEach((chip) => {
        chip.addEventListener('click', () => {
          const val = chip.textContent!;
          // For sites, append rather than replace
          if (q.key === 'sites') {
            const current = input.value.trim();
            input.value = current ? `${current}, ${val}` : val;
          } else {
            input.value = val;
          }
          input.focus();
        });
      });
    }, 300);
  }

  function saveAnswer(key: string, value: string) {
    switch (key) {
      case 'name':
        state.name = value;
        break;
      case 'email':
        state.email = value;
        break;
      case 'role':
        state.role = value;
        break;
      case 'sites':
        state.preferredSites = value
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        break;
    }
  }

  async function finishOnboarding() {
    updateProgress();
    inputArea.innerHTML = '';

    const displayName = state.name || 'friend';

    addBubble(`All set! Let's go, ${displayName}!`, 'agent');

    const profile: UserProfile = {
      name: state.name,
      email: state.email,
      role: state.role,
      preferredSites: state.preferredSites,
      customFacts: {},
      onboardingComplete: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await saveUserProfile(profile);

    // Brief pause then transition
    setTimeout(() => {
      onComplete();
    }, 1500);
  }

  // Kick off
  askQuestion();
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
