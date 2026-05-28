import { LLMProvider, ChatRequest, ChatResponse } from '../../shared/types';

export class AnthropicProvider implements LLMProvider {
  name = 'anthropic';

  constructor(
    private apiKey: string,
    private model: string,
  ) {}

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const messages: Array<Record<string, unknown>> = [];

    for (const msg of request.messages) {
      if (msg.role === 'system') continue;

      if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
        const content: Array<Record<string, unknown>> = [];
        if (msg.content) {
          content.push({ type: 'text', text: msg.content });
        }
        for (const tc of msg.tool_calls) {
          content.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.function.name,
            input: JSON.parse(tc.function.arguments),
          });
        }
        messages.push({ role: 'assistant', content });
      } else if (msg.role === 'tool') {
        messages.push({
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: msg.tool_call_id,
              content: msg.content,
            },
          ],
        });
      } else {
        messages.push({ role: msg.role, content: msg.content });
      }
    }

    const tools = request.tools.map((t) => ({
      name: t.function.name,
      description: t.function.description,
      input_schema: t.function.parameters,
    }));

    const body: Record<string, unknown> = {
      model: this.model,
      system: request.systemPrompt,
      messages,
      max_tokens: request.maxTokens ?? 4096,
      temperature: request.temperature ?? 0.2,
    };

    if (tools.length > 0) {
      body.tools = tools;
    }

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Anthropic API error (${res.status}): ${err}`);
    }

    const data = await res.json();

    const toolUse = data.content.find((b: Record<string, unknown>) => b.type === 'tool_use');
    if (toolUse) {
      return {
        type: 'tool_call',
        toolCall: {
          id: toolUse.id,
          name: toolUse.name,
          arguments: toolUse.input,
        },
      };
    }

    const textBlock = data.content.find((b: Record<string, unknown>) => b.type === 'text');
    return {
      type: 'text',
      text: textBlock?.text || '',
    };
  }
}
