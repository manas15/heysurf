import { LLMProvider, ChatRequest, ChatResponse } from '../../shared/types';

/**
 * Base provider for any OpenAI-compatible API (Groq, Mistral, DeepSeek, xAI, Together, OpenRouter).
 * These all use the same request/response format as OpenAI, just with a different base URL.
 */
export class OpenAICompatibleProvider implements LLMProvider {
  constructor(
    public name: string,
    private apiKey: string,
    private model: string,
    private baseUrl: string,
    private extraHeaders: Record<string, string> = {},
  ) {}

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const messages: Array<Record<string, unknown>> = [
      { role: 'system', content: request.systemPrompt },
    ];

    for (const msg of request.messages) {
      if (msg.tool_calls) {
        messages.push({
          role: 'assistant',
          content: msg.content || null,
          tool_calls: msg.tool_calls,
        });
      } else if (msg.role === 'tool') {
        messages.push({
          role: 'tool',
          content: msg.content,
          tool_call_id: msg.tool_call_id,
        });
      } else {
        messages.push({ role: msg.role, content: msg.content });
      }
    }

    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      temperature: request.temperature ?? 0.2,
      max_tokens: request.maxTokens ?? 4096,
    };

    if (request.tools.length > 0) {
      body.tools = request.tools;
      body.tool_choice = 'auto';
    }

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
        ...this.extraHeaders,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`${this.name} API error (${res.status}): ${err}`);
    }

    const data = await res.json();
    const choice = data.choices[0];

    if (choice.message.tool_calls && choice.message.tool_calls.length > 0) {
      const tc = choice.message.tool_calls[0];
      return {
        type: 'tool_call',
        toolCall: {
          id: tc.id,
          name: tc.function.name,
          arguments: JSON.parse(tc.function.arguments),
        },
      };
    }

    return {
      type: 'text',
      text: choice.message.content || '',
    };
  }
}
