import { Message, AgentAction, AgentUpdate, ChatResponse } from '../shared/types';
import { getSettings } from '../shared/storage';
import { createProvider } from '../llm/provider';
import { AGENT_TOOLS } from '../llm/tools';
import { SYSTEM_PROMPT, formatPageContext } from '../llm/prompts';

type UpdateCallback = (update: AgentUpdate) => void;

export class AgentLoop {
  private running = false;
  private abortController: AbortController | null = null;

  async run(tabId: number, task: string, onUpdate: UpdateCallback): Promise<void> {
    this.running = true;
    this.abortController = new AbortController();

    const settings = await getSettings();
    if (!settings.llm.apiKey) {
      onUpdate({ kind: 'error', message: 'No API key configured. Open HeySurf settings to add your key.' });
      return;
    }

    const provider = createProvider(settings.llm);
    const messages: Message[] = [];
    const maxSteps = settings.agent.maxSteps;

    onUpdate({ kind: 'thinking', message: 'Reading page...' });

    for (let step = 0; step < maxSteps; step++) {
      if (!this.running) {
        onUpdate({ kind: 'error', message: 'Task cancelled.' });
        return;
      }

      // 1. Get the page tree
      let pageState: { tree: string; url: string; title: string };
      try {
        pageState = await this.getPageState(tabId);
      } catch (err) {
        onUpdate({
          kind: 'error',
          message: `Cannot read page. Make sure you're on a webpage and refresh if needed.`,
        });
        return;
      }

      // 2. Build user message
      const context = formatPageContext(pageState.url, pageState.title, pageState.tree);
      const userContent =
        step === 0
          ? `${context}User task: ${task}`
          : `${context}The action was executed. Here's the updated page. Continue with the task: ${task}`;

      messages.push({ role: 'user', content: userContent });

      // 3. Call LLM
      onUpdate({ kind: 'thinking', message: 'Thinking...' });

      let response: ChatResponse;
      try {
        response = await provider.chat({
          model: settings.llm.model,
          systemPrompt: SYSTEM_PROMPT,
          messages,
          tools: AGENT_TOOLS,
          temperature: 0.2,
        });
      } catch (err) {
        onUpdate({
          kind: 'error',
          message: `LLM error: ${err instanceof Error ? err.message : String(err)}`,
        });
        return;
      }

      // 4. Handle text response (done or clarification needed)
      if (response.type === 'text') {
        messages.push({ role: 'assistant', content: response.text! });
        onUpdate({ kind: 'speaking', text: response.text! });
        onUpdate({ kind: 'done', summary: response.text! });
        return;
      }

      // 5. Handle tool call
      if (response.type === 'tool_call' && response.toolCall) {
        const { id, name, arguments: args } = response.toolCall;
        const action = { name, args } as AgentAction;

        // Add assistant message with tool call to history
        messages.push({
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id,
              type: 'function',
              function: {
                name,
                arguments: JSON.stringify(args),
              },
            },
          ],
        });

        // Handle 'done' action
        if (name === 'done') {
          const summary = (args as { summary: string }).summary;
          onUpdate({ kind: 'done', summary });
          onUpdate({ kind: 'speaking', text: summary });

          messages.push({
            role: 'tool',
            content: JSON.stringify({ success: true, message: summary }),
            tool_call_id: id,
          });
          return;
        }

        // Highlight target element if applicable
        if (settings.agent.highlightActions && 'target' in args) {
          try {
            await chrome.tabs.sendMessage(tabId, {
              type: 'HIGHLIGHT_ELEMENT',
              target: (args as { target: string }).target,
              index: (args as { index?: number }).index,
            });
          } catch {
            // Highlight is best-effort
          }
        }

        // Describe the action
        const description = describeAction(action);
        onUpdate({ kind: 'action', action, description });

        // Execute the action
        let result: { success: boolean; message: string };
        try {
          const response = await chrome.tabs.sendMessage(tabId, {
            type: 'EXECUTE_ACTION',
            action,
          });
          result = { success: response.success, message: response.message };
        } catch (err) {
          result = {
            success: false,
            message: `Failed to execute: ${err instanceof Error ? err.message : String(err)}`,
          };
        }

        onUpdate({ kind: 'action_result', success: result.success, message: result.message });

        // Add tool result to history
        messages.push({
          role: 'tool',
          content: JSON.stringify(result),
          tool_call_id: id,
        });

        // Clear highlights
        try {
          await chrome.tabs.sendMessage(tabId, { type: 'CLEAR_HIGHLIGHTS' });
        } catch {
          // best-effort
        }

        // Wait for page to settle after actions
        if (name === 'click' || name === 'navigate') {
          // These may cause navigation — wait for page load
          await new Promise((r) => setTimeout(r, 1500));
          await this.waitForPageLoad(tabId);
          await this.injectContentScript(tabId);
          await new Promise((r) => setTimeout(r, 500));
        } else if (name !== 'wait' && name !== 'read_page') {
          await new Promise((r) => setTimeout(r, 800));
        }
      }
    }

    onUpdate({
      kind: 'error',
      message: `Reached maximum steps (${maxSteps}). The task may be too complex or the page isn't responding as expected.`,
    });
  }

  stop() {
    this.running = false;
    this.abortController?.abort();
  }

  private async injectContentScript(tabId: number): Promise<void> {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content/content-script.js'],
      });
    } catch {
      // May fail if page isn't ready yet, that's okay
    }
  }

  private async waitForPageLoad(tabId: number): Promise<void> {
    // Wait for the tab to finish loading
    for (let i = 0; i < 20; i++) {
      const tab = await chrome.tabs.get(tabId);
      if (tab.status === 'complete') return;
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  private async getPageState(
    tabId: number,
  ): Promise<{ tree: string; url: string; title: string }> {
    // Retry up to 5 times, re-injecting content script if needed
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        return await new Promise((resolve, reject) => {
          chrome.tabs.sendMessage(tabId, { type: 'GET_A11Y_TREE' }, (response) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
              return;
            }
            if (!response) {
              reject(new Error('No response from content script'));
              return;
            }
            resolve({
              tree: response.tree,
              url: response.url,
              title: response.title,
            });
          });
        });
      } catch {
        // Content script likely gone after navigation — wait for page load and re-inject
        await this.waitForPageLoad(tabId);
        await this.injectContentScript(tabId);
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    throw new Error('Could not communicate with page after multiple attempts');
  }
}

function describeAction(action: AgentAction): string {
  switch (action.name) {
    case 'click':
      return `Clicking "${action.args.target}"`;
    case 'type':
      return `Typing "${action.args.text}" into "${action.args.target}"`;
    case 'select':
      return `Selecting "${action.args.option}" in "${action.args.target}"`;
    case 'scroll':
      return `Scrolling ${action.args.direction}`;
    case 'navigate':
      return `Navigating to ${action.args.url}`;
    case 'read_page':
      return `Reading page for: ${action.args.query}`;
    case 'wait':
      return `Waiting ${action.args.milliseconds ?? 2000}ms`;
    case 'done':
      return action.args.summary;
    default:
      return 'Unknown action';
  }
}
