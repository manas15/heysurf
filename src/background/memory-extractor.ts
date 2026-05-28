import { Memory } from '../shared/types';
import { getSettings } from '../shared/storage';
import { createProvider } from '../llm/provider';
import { MEMORY_EXTRACTION_PROMPT } from '../llm/prompts';

export async function extractMemories(
  conversationTranscript: string,
  existingMemories: Memory[],
): Promise<Memory[]> {
  const settings = await getSettings();
  const provider = createProvider(settings.llm);

  const existingFacts =
    existingMemories.length > 0
      ? existingMemories.map((m) => `- [${m.category}] ${m.fact}`).join('\n')
      : 'None';

  const prompt = MEMORY_EXTRACTION_PROMPT
    .replace('{{EXISTING_MEMORIES}}', existingFacts)
    .replace('{{TRANSCRIPT}}', conversationTranscript);

  let response;
  try {
    response = await provider.chat({
      model: settings.llm.model,
      systemPrompt: 'You are a memory extraction assistant. Respond only with valid JSON.',
      messages: [{ role: 'user', content: prompt }],
      tools: [],
      temperature: 0.2,
    });
  } catch {
    // If LLM call fails, just return empty — memory extraction is best-effort
    return [];
  }

  const text = response.text || '';

  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : text);

    if (!parsed.memories || !Array.isArray(parsed.memories)) {
      return [];
    }

    const now = Date.now();
    return parsed.memories
      .filter((m: any) => m.fact && m.category)
      .map((m: any) => ({
        id: `mem_${now}_${Math.random().toString(36).slice(2, 8)}`,
        fact: m.fact,
        category: m.category,
        source: 'conversation' as const,
        confidence: 0.7,
        createdAt: now,
        lastUsedAt: now,
        usageCount: 0,
      }));
  } catch {
    return [];
  }
}
