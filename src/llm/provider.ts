import { LLMProvider, HeySurfSettings } from '../shared/types';
import { OpenAIProvider } from './providers/openai';
import { AnthropicProvider } from './providers/anthropic';
import { GeminiProvider } from './providers/gemini';

export function createProvider(settings: HeySurfSettings['llm']): LLMProvider {
  switch (settings.provider) {
    case 'openai':
      return new OpenAIProvider(settings.apiKey, settings.model);
    case 'anthropic':
      return new AnthropicProvider(settings.apiKey, settings.model);
    case 'gemini':
      return new GeminiProvider(settings.apiKey, settings.model);
    default:
      throw new Error(`Unknown LLM provider: ${settings.provider}`);
  }
}
