import { UserProfile } from '../shared/types';
import { getUserProfile, saveUserProfile, getSettings, saveSettings } from '../shared/storage';
import { PROVIDER_INFO } from '../llm/provider';

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
    renderOnboarding(container, () => {
      container.classList.add('hidden');
      chatArea.classList.remove('hidden');
      inputArea.classList.remove('hidden');
      statusBar.classList.remove('hidden');
      resolve();
    });
  });
}

// ---- State ----

let selectedProvider = '';
let selectedModel = '';

// ---- Render ----

function renderOnboarding(container: HTMLElement, onComplete: () => void) {
  const providers = Object.entries(PROVIDER_INFO);

  container.innerHTML = `
    <div class="onboarding-inner">
      <div class="onboarding-header">
        <span class="onboarding-logo">🏄</span>
        <h2>HeySurf</h2>
        <p class="onboarding-subtitle">Your voice copilot for the web</p>
      </div>

      <div class="step-content">
        <p class="step-label">Connect an AI provider to get started</p>
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

          <input type="password" id="onboard-api-key" class="onboard-key-input" placeholder="Paste your API key..." autocomplete="off">
          <div id="key-format-hint" class="setting-hint"></div>

          <div class="api-key-actions">
            <button id="test-connection-btn" class="secondary-btn">Test Connection</button>
            <a id="get-key-link" href="#" target="_blank" class="get-key-link">Get API Key &rarr;</a>
          </div>

          <div id="connection-status" class="connection-status hidden"></div>

          <button id="start-surfing-btn" class="primary-btn start-btn hidden">Start Surfing</button>
        </div>

        <p class="onboard-footer-note" id="footer-note">
          I'll learn your name, preferences, and workflows<br>naturally as we work together.
        </p>
      </div>
    </div>
  `;

  // Bind events
  const cards = container.querySelectorAll('.provider-card');
  const apiKeySection = container.querySelector('#api-key-section')!;
  const apiKeyInput = container.querySelector('#onboard-api-key') as HTMLInputElement;
  const formatHint = container.querySelector('#key-format-hint')!;
  const testBtn = container.querySelector('#test-connection-btn') as HTMLButtonElement;
  const getKeyLink = container.querySelector('#get-key-link') as HTMLAnchorElement;
  const connectionStatus = container.querySelector('#connection-status')!;
  const startBtn = container.querySelector('#start-surfing-btn')!;
  const providerBanner = container.querySelector('#selected-provider-banner')!;

  cards.forEach((card) => {
    card.addEventListener('click', () => {
      cards.forEach((c) => c.classList.remove('selected'));
      card.classList.add('selected');

      const providerKey = (card as HTMLElement).dataset.provider!;
      const info = PROVIDER_INFO[providerKey];
      selectedProvider = providerKey;
      selectedModel = info.defaultModel;

      providerBanner.textContent = info.name;
      formatHint.textContent = info.keyPrefix
        ? `Starts with "${info.keyPrefix}"`
        : '';
      getKeyLink.href = info.keyUrl;

      apiKeySection.classList.remove('hidden');
      connectionStatus.classList.add('hidden');
      startBtn.classList.add('hidden');
      apiKeyInput.value = '';
      apiKeyInput.focus();
    });
  });

  testBtn.addEventListener('click', async () => {
    const key = apiKeyInput.value.trim();
    if (!key) {
      showStatus(connectionStatus, false, 'Paste your API key first.');
      return;
    }

    const info = PROVIDER_INFO[selectedProvider];
    if (info.keyPrefix && !key.startsWith(info.keyPrefix)) {
      showStatus(connectionStatus, false, `Key should start with "${info.keyPrefix}"`);
      return;
    }

    testBtn.textContent = 'Testing...';
    testBtn.disabled = true;

    try {
      const ok = await testApiKey(selectedProvider, key, selectedModel);
      if (ok) {
        showStatus(connectionStatus, true, 'Connected!');
        startBtn.classList.remove('hidden');
      } else {
        showStatus(connectionStatus, false, 'Invalid key. Check and try again.');
      }
    } catch (err: any) {
      showStatus(connectionStatus, false, err.message || 'Connection failed.');
    } finally {
      testBtn.textContent = 'Test Connection';
      testBtn.disabled = false;
    }
  });

  // Allow Enter key in the input to trigger test
  apiKeyInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      testBtn.click();
    }
  });

  startBtn.addEventListener('click', async () => {
    // Save LLM settings
    const settings = await getSettings();
    settings.llm.provider = selectedProvider as any;
    settings.llm.apiKey = apiKeyInput.value.trim();
    settings.llm.model = selectedModel;
    await saveSettings(settings);

    // Save a minimal profile — everything else is learned naturally
    const profile: UserProfile = {
      name: '',
      email: '',
      role: '',
      preferredSites: [],
      customFacts: {},
      onboardingComplete: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await saveUserProfile(profile);

    onComplete();
  });
}

function showStatus(el: Element, success: boolean, message: string) {
  el.classList.remove('hidden', 'status-success', 'status-error');
  el.classList.add(success ? 'status-success' : 'status-error');
  el.innerHTML = `<span class="status-icon">${success ? '&#10003;' : '&#10007;'}</span> ${message}`;
}

async function testApiKey(provider: string, apiKey: string, model: string): Promise<boolean> {
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
  };

  // All OpenAI-compatible providers
  for (const p of ['groq', 'mistral', 'deepseek', 'xai', 'together', 'openrouter']) {
    const baseUrls: Record<string, string> = {
      groq: 'https://api.groq.com/openai/v1',
      mistral: 'https://api.mistral.ai/v1',
      deepseek: 'https://api.deepseek.com/v1',
      xai: 'https://api.x.ai/v1',
      together: 'https://api.together.xyz/v1',
      openrouter: 'https://openrouter.ai/api/v1',
    };
    endpoints[p] = {
      url: `${baseUrls[p]}/chat/completions`,
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      buildBody: () => ({ model, messages: [{ role: 'user', content: 'Hi' }], max_tokens: 1 }),
    };
  }

  const config = endpoints[provider];
  if (!config) return false;

  const resp = await fetch(config.url, {
    method: 'POST',
    headers: config.headers,
    body: JSON.stringify(config.buildBody()),
  });

  return resp.ok;
}
