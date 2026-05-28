import { LLMProvider, ChatRequest, ChatResponse, Message } from '../../shared/types';

export class OpenAIProvider implements LLMProvider {
  name = 'openai';

  constructor(
    private apiKey: string,
    private model: string,
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

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`OpenAI API error (${res.status}): ${err}`);
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
