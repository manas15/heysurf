import { Message, AgentAction, AgentUpdate, ChatResponse } from '../shared/types';
import { getSettings } from '../shared/storage';
import { createProvider } from '../llm/provider';
import { AGENT_TOOLS } from '../llm/tools';
import { SYSTEM_PROMPT, formatPageContext } from '../llm/prompts';

type UpdateCallback = (update: AgentUpdate) => void;

export class AgentLoop {
  private running = false;

  async run(tabId: number, task: string, onUpdate: UpdateCallback): Promise<void> {
    this.running = true;

    const settings = await getSettings();
    if (!settings.llm.apiKey) {
      onUpdate({ kind: 'error', message: 'No API key configured. Open HeySurf settings to add your key.' });
      return;
    }

    const provider = createProvider(settings.llm);
    const messages: Message[] = [];
    const maxSteps = settings.agent.maxSteps;

    onUpdate({ kind: 'thinking', message: 'Reading page...' });

    // Make sure content script is alive before starting
    const alive = await this.ensureContentScript(tabId);
    if (!alive) {
      onUpdate({ kind: 'error', message: 'Cannot connect to page. Try refreshing the page and try again.' });
      return;
    }

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
          message: `Cannot read page: ${err instanceof Error ? err.message : String(err)}`,
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
            await this.sendToTab(tabId, {
              type: 'HIGHLIGHT_ELEMENT',
              target: (args as { target: string }).target,
              index: (args as { index?: number }).index,
            });
          } catch {
            // best-effort
          }
        }

        // Describe the action
        const description = describeAction(action);
        onUpdate({ kind: 'action', action, description });

        // Execute the action
        let result: { success: boolean; message: string };
        try {
          const resp = await this.sendToTab(tabId, {
            type: 'EXECUTE_ACTION',
            action,
          });
          result = { success: resp.success, message: resp.message };
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

        // Clear highlights (best-effort)
        try {
          await this.sendToTab(tabId, { type: 'CLEAR_HIGHLIGHTS' });
        } catch {
          // ignore
        }

        // After click/navigate — page may have changed. Wait and re-establish connection.
        if (name === 'click' || name === 'navigate') {
          await this.sleep(2000);
          await this.ensureContentScript(tabId);
        } else if (name !== 'wait' && name !== 'read_page') {
          await this.sleep(500);
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
  }

  // ---- Helpers ----

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  private sendToTab(tabId: number, message: any): Promise<any> {
    return new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tabId, message, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(response);
        }
      });
    });
  }

  private async ping(tabId: number): Promise<boolean> {
    try {
      const resp = await this.sendToTab(tabId, { type: 'PING' });
      return resp?.type === 'PONG';
    } catch {
      return false;
    }
  }

  private async injectContentScript(tabId: number): Promise<void> {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content/content-script.js'],
      });
    } catch {
      // ignore — page might not be ready
    }
  }

  private async waitForTabLoad(tabId: number, timeoutMs = 15000): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const tab = await chrome.tabs.get(tabId);
        if (tab.status === 'complete') return;
      } catch {
        // tab might be mid-navigation
      }
      await this.sleep(300);
    }
  }

  private async ensureContentScript(tabId: number): Promise<boolean> {
    // Try pinging the content script up to 10 times
    for (let attempt = 0; attempt < 10; attempt++) {
      if (await this.ping(tabId)) return true;

      // Wait for page to load, then inject
      await this.waitForTabLoad(tabId, 5000);
      await this.injectContentScript(tabId);
      await this.sleep(600);
    }
    return false;
  }

  private async getPageState(
    tabId: number,
  ): Promise<{ tree: string; url: string; title: string }> {
    // Ensure content script is alive
    const alive = await this.ensureContentScript(tabId);
    if (!alive) {
      throw new Error('Content script not responding. Try refreshing the page.');
    }

    const response = await this.sendToTab(tabId, { type: 'GET_A11Y_TREE' });
    if (!response || !response.tree) {
      throw new Error('Empty response from content script');
    }
    return {
      tree: response.tree,
      url: response.url,
      title: response.title,
    };
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
