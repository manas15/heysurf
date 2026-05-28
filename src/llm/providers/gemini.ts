import { LLMProvider, ChatRequest, ChatResponse } from '../../shared/types';

export class GeminiProvider implements LLMProvider {
  name = 'gemini';

  constructor(
    private apiKey: string,
    private model: string,
  ) {}

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const contents: Array<Record<string, unknown>> = [];

    // Gemini uses a different message format
    for (const msg of request.messages) {
      if (msg.role === 'system') continue;

      if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
        const parts: Array<Record<string, unknown>> = [];
        if (msg.content) {
          parts.push({ text: msg.content });
        }
        for (const tc of msg.tool_calls) {
          parts.push({
            functionCall: {
              name: tc.function.name,
              args: JSON.parse(tc.function.arguments),
            },
          });
        }
        contents.push({ role: 'model', parts });
      } else if (msg.role === 'tool') {
        contents.push({
          role: 'user',
          parts: [
            {
              functionResponse: {
                name: 'tool_result',
                response: { result: msg.content },
              },
            },
          ],
        });
      } else if (msg.role === 'user') {
        contents.push({ role: 'user', parts: [{ text: msg.content }] });
      } else if (msg.role === 'assistant') {
        contents.push({ role: 'model', parts: [{ text: msg.content }] });
      }
    }

    const tools = request.tools.map((t) => ({
      name: t.function.name,
      description: t.function.description,
      parameters: t.function.parameters,
    }));

    const body: Record<string, unknown> = {
      contents,
      systemInstruction: {
        parts: [{ text: request.systemPrompt }],
      },
      generationConfig: {
        temperature: request.temperature ?? 0.2,
        maxOutputTokens: request.maxTokens ?? 4096,
      },
    };

    if (tools.length > 0) {
      body.tools = [{ functionDeclarations: tools }];
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Gemini API error (${res.status}): ${err}`);
    }

    const data = await res.json();
    const candidate = data.candidates?.[0];
    if (!candidate) throw new Error('No response from Gemini');

    const parts = candidate.content?.parts || [];
    const fnCall = parts.find((p: Record<string, unknown>) => p.functionCall);

    if (fnCall) {
      return {
        type: 'tool_call',
        toolCall: {
          id: `gemini-${Date.now()}`,
          name: fnCall.functionCall.name,
          arguments: fnCall.functionCall.args || {},
        },
      };
    }

    const textPart = parts.find((p: Record<string, unknown>) => p.text);
    return {
      type: 'text',
      text: textPart?.text || '',
    };
  }
}
