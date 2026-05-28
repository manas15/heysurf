import { LLMProvider, HeySurfSettings } from '../shared/types';
import { OpenAIProvider } from './providers/openai';
import { AnthropicProvider } from './providers/anthropic';
import { GeminiProvider } from './providers/gemini';
import { OpenAICompatibleProvider } from './providers/openai-compatible';

const PROVIDER_CONFIGS: Record<
  string,
  { baseUrl: string; defaultModel: string; extraHeaders?: Record<string, string> }
> = {
  groq: {
    baseUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.3-70b-versatile',
  },
  mistral: {
    baseUrl: 'https://api.mistral.ai/v1',
    defaultModel: 'mistral-large-latest',
  },
  deepseek: {
    baseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
  },
  xai: {
    baseUrl: 'https://api.x.ai/v1',
    defaultModel: 'grok-3-mini',
  },
  together: {
    baseUrl: 'https://api.together.xyz/v1',
    defaultModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
  },
  openrouter: {
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'openai/gpt-4o',
    extraHeaders: {
      'HTTP-Referer': 'https://heysurf.app',
      'X-Title': 'HeySurf',
    },
  },
};

export function createProvider(settings: HeySurfSettings['llm']): LLMProvider {
  switch (settings.provider) {
    case 'openai':
      return new OpenAIProvider(settings.apiKey, settings.model);
    case 'anthropic':
      return new AnthropicProvider(settings.apiKey, settings.model);
    case 'gemini':
      return new GeminiProvider(settings.apiKey, settings.model);
    default: {
      const config = PROVIDER_CONFIGS[settings.provider];
      if (config) {
        return new OpenAICompatibleProvider(
          settings.provider,
          settings.apiKey,
          settings.model || config.defaultModel,
          config.baseUrl,
          config.extraHeaders,
        );
      }
      throw new Error(`Unknown LLM provider: ${settings.provider}`);
    }
  }
}

/** Provider metadata for UI display */
export const PROVIDER_INFO: Record<
  string,
  { name: string; defaultModel: string; hint: string; keyPrefix?: string; keyUrl: string }
> = {
  openai: {
    name: 'OpenAI',
    defaultModel: 'gpt-4o',
    hint: 'gpt-4o, gpt-4o-mini, o3-mini',
    keyPrefix: 'sk-',
    keyUrl: 'https://platform.openai.com/api-keys',
  },
  anthropic: {
    name: 'Anthropic (Claude)',
    defaultModel: 'claude-sonnet-4-6-20250514',
    hint: 'claude-sonnet-4-6, claude-haiku-4-5',
    keyPrefix: 'sk-ant-',
    keyUrl: 'https://console.anthropic.com/settings/keys',
  },
  gemini: {
    name: 'Google Gemini',
    defaultModel: 'gemini-2.0-flash',
    hint: 'gemini-2.0-flash, gemini-2.5-pro',
    keyUrl: 'https://aistudio.google.com/apikey',
  },
  groq: {
    name: 'Groq',
    defaultModel: 'llama-3.3-70b-versatile',
    hint: 'llama-3.3-70b, mixtral-8x7b (ultra fast)',
    keyPrefix: 'gsk_',
    keyUrl: 'https://console.groq.com/keys',
  },
  mistral: {
    name: 'Mistral',
    defaultModel: 'mistral-large-latest',
    hint: 'mistral-large, mistral-small',
    keyUrl: 'https://console.mistral.ai/api-keys',
  },
  deepseek: {
    name: 'DeepSeek',
    defaultModel: 'deepseek-chat',
    hint: 'deepseek-chat, deepseek-reasoner',
    keyPrefix: 'sk-',
    keyUrl: 'https://platform.deepseek.com/api_keys',
  },
  xai: {
    name: 'xAI (Grok)',
    defaultModel: 'grok-3-mini',
    hint: 'grok-3, grok-3-mini',
    keyPrefix: 'xai-',
    keyUrl: 'https://console.x.ai/team/default/api-keys',
  },
  together: {
    name: 'Together AI',
    defaultModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    hint: 'Llama 3.3 70B, Qwen, Mixtral',
    keyUrl: 'https://api.together.ai/settings/api-keys',
  },
  openrouter: {
    name: 'OpenRouter',
    defaultModel: 'openai/gpt-4o',
    hint: 'Any model — one key for everything',
    keyPrefix: 'sk-or-',
    keyUrl: 'https://openrouter.ai/keys',
  },
};
