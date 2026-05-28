import {
  Message,
  AgentAction,
  AgentUpdate,
  ChatResponse,
  TaskPlan,
  TaskRecord,
} from '../shared/types';
import {
  getSettings,
  getUserProfile,
  getMemories,
  addMemory,
  addTaskRecord,
} from '../shared/storage';
import { createProvider } from '../llm/provider';
import { AGENT_TOOLS } from '../llm/tools';
import { SYSTEM_PROMPT, formatPageContext } from '../llm/prompts';
import {
  createPlan,
  verifyStepCompletion,
  replan,
  buildExecutionPrompt,
} from './planner';
import {
  registerTab,
  openNewTab,
  switchToTab,
  readTabTree,
  closeTab as closeTabById,
  getTabRegistry,
  getTabContext,
} from './tab-manager';
import { extractMemories } from './memory-extractor';

type UpdateCallback = (update: AgentUpdate) => void;

export class AgentLoop {
  private running = false;
  private conversationLog: string[] = [];

  async run(tabId: number, task: string, onUpdate: UpdateCallback): Promise<void> {
    this.running = true;
    this.conversationLog = [];
    const startTime = Date.now();

    const settings = await getSettings();
    if (!settings.llm.apiKey) {
      onUpdate({ kind: 'error', message: 'No API key configured. Open HeySurf settings to add your key.' });
      return;
    }

    const provider = createProvider(settings.llm);
    const messages: Message[] = [];
    const maxSteps = settings.agent.maxSteps;

    // Load user profile and memories
    const userProfile = await getUserProfile();
    const memories = await getMemories();

    onUpdate({ kind: 'thinking', message: 'Reading page...' });

    // Send INIT_OVERLAY to content script
    try {
      await this.sendToTab(tabId, { type: 'INIT_OVERLAY' });
    } catch {
      // best-effort
    }

    // Ensure content script is alive before starting
    const alive = await this.ensureContentScript(tabId);
    if (!alive) {
      onUpdate({ kind: 'error', message: 'Cannot connect to page. Try refreshing the page and try again.' });
      this.sendDestroyOverlay(tabId);
      return;
    }

    // Register the active tab
    try {
      const tab = await chrome.tabs.get(tabId);
      await registerTab(tabId, tab.url || '', tab.title || '', 'Primary task tab');
    } catch {
      // best-effort
    }

    // Read initial page state
    let pageState: { tree: string; url: string; title: string };
    try {
      pageState = await this.getPageState(tabId);
    } catch (err) {
      onUpdate({
        kind: 'error',
        message: `Cannot read page: ${err instanceof Error ? err.message : String(err)}`,
      });
      this.sendDestroyOverlay(tabId);
      return;
    }

    // Create a task plan
    onUpdate({ kind: 'thinking', message: 'Creating a plan...' });
    let plan: TaskPlan;
    try {
      const pageContext = formatPageContext(pageState.url, pageState.title, pageState.tree);
      plan = await createPlan(task, pageContext, userProfile, memories);
    } catch (err) {
      onUpdate({
        kind: 'error',
        message: `Planning failed: ${err instanceof Error ? err.message : String(err)}`,
      });
      this.sendDestroyOverlay(tabId);
      return;
    }

    onUpdate({ kind: 'plan_created', plan });
    this.conversationLog.push(`User goal: ${task}`);

    // Execute each step in the plan
    let totalActions = 0;

    for (
      let stepIdx = plan.currentStepIndex;
      stepIdx < plan.steps.length && this.running;
      stepIdx++
    ) {
      plan.currentStepIndex = stepIdx;
      const step = plan.steps[stepIdx];
      step.status = 'active';

      onUpdate({
        kind: 'step_started',
        stepIndex: stepIdx,
        description: step.description,
      });

      let stepComplete = false;

      for (let attempt = 0; attempt < step.maxAttempts && !stepComplete && this.running; attempt++) {
        step.attempts = attempt + 1;

        if (totalActions >= maxSteps) {
          onUpdate({
            kind: 'error',
            message: `Reached maximum actions (${maxSteps}). The task may be too complex.`,
          });
          this.sendDestroyOverlay(tabId);
          await this.saveTaskRecord(task, 'failed', startTime, totalActions, 'Max steps reached');
          return;
        }

        // Read page state
        try {
          pageState = await this.getPageState(tabId);
        } catch (err) {
          // Try to re-establish connection
          const reconnected = await this.ensureContentScript(tabId);
          if (!reconnected) {
            onUpdate({
              kind: 'error',
              message: `Lost connection to page: ${err instanceof Error ? err.message : String(err)}`,
            });
            this.sendDestroyOverlay(tabId);
            await this.saveTaskRecord(task, 'failed', startTime, totalActions, 'Lost connection');
            return;
          }
          try {
            pageState = await this.getPageState(tabId);
          } catch (err2) {
            onUpdate({
              kind: 'error',
              message: `Cannot read page: ${err2 instanceof Error ? err2.message : String(err2)}`,
            });
            this.sendDestroyOverlay(tabId);
            await this.saveTaskRecord(task, 'failed', startTime, totalActions, 'Cannot read page');
            return;
          }
        }

        // Build execution prompt with plan context
        const pageContext = formatPageContext(pageState.url, pageState.title, pageState.tree);
        const tabRegistry = await getTabRegistry();
        const tabContext = getTabContext(tabRegistry);

        const executionPrompt = buildExecutionPrompt(plan, pageContext, userProfile, memories);
        const userContent =
          messages.length === 0
            ? `${executionPrompt}\n\n${tabContext}\n\nExecute the current step.`
            : `${executionPrompt}\n\n${tabContext}\n\nThe action was executed. Here's the updated page. Continue with the current step.`;

        messages.push({ role: 'user', content: userContent });

        // Call LLM
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
          this.sendDestroyOverlay(tabId);
          await this.saveTaskRecord(task, 'failed', startTime, totalActions, 'LLM error');
          return;
        }

        // Handle text response (clarification or done)
        if (response.type === 'text') {
          messages.push({ role: 'assistant', content: response.text! });
          this.conversationLog.push(`Agent: ${response.text}`);
          onUpdate({ kind: 'speaking', text: response.text! });

          // If text response, assume it's a clarification — mark step as in progress and stop
          // The user will need to send a new message to continue
          onUpdate({ kind: 'done', summary: response.text! });
          this.sendDestroyOverlay(tabId);
          return;
        }

        // Handle tool call
        if (response.type === 'tool_call' && response.toolCall) {
          totalActions++;
          const { id, name, arguments: args } = response.toolCall;
          const action = { name, args } as AgentAction;

          // Add assistant message with tool call
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
            step.status = 'complete';
            step.result = summary;
            plan.status = 'complete';

            // Mark remaining steps as skipped
            for (let i = stepIdx + 1; i < plan.steps.length; i++) {
              plan.steps[i].status = 'skipped';
            }

            messages.push({
              role: 'tool',
              content: JSON.stringify({ success: true, message: summary }),
              tool_call_id: id,
            });

            this.conversationLog.push(`Task completed: ${summary}`);
            onUpdate({ kind: 'step_complete', stepIndex: stepIdx, result: summary });
            onUpdate({ kind: 'done', summary });
            onUpdate({ kind: 'speaking', text: summary });

            // Extract memories from conversation
            await this.extractAndSaveMemories(memories);

            await this.saveTaskRecord(task, 'complete', startTime, totalActions, summary);
            this.sendDestroyOverlay(tabId);
            return;
          }

          // Handle multi-tab tool calls
          let result: { success: boolean; message: string };

          if (name === 'open_tab') {
            const { url, purpose } = args as { url: string; purpose: string };
            const description = `Opening new tab: ${url}`;
            onUpdate({ kind: 'action', action, description });
            try {
              const newTabId = await openNewTab(url, purpose);
              result = { success: true, message: `Opened tab ${newTabId} with ${url}` };
            } catch (err) {
              result = { success: false, message: `Failed to open tab: ${err instanceof Error ? err.message : String(err)}` };
            }
            onUpdate({ kind: 'action_result', success: result.success, message: result.message });
          } else if (name === 'switch_tab') {
            const targetTabId = (args as { tabId: number }).tabId;
            const description = `Switching to tab ${targetTabId}`;
            onUpdate({ kind: 'action', action, description });
            try {
              await switchToTab(targetTabId);
              tabId = targetTabId; // Update active tabId for subsequent actions
              result = { success: true, message: `Switched to tab ${targetTabId}` };
            } catch (err) {
              result = { success: false, message: `Failed to switch tab: ${err instanceof Error ? err.message : String(err)}` };
            }
            onUpdate({ kind: 'action_result', success: result.success, message: result.message });
          } else if (name === 'read_tab') {
            const targetTabId = (args as { tabId: number }).tabId;
            const description = `Reading tab ${targetTabId}`;
            onUpdate({ kind: 'action', action, description });
            try {
              const tree = await readTabTree(targetTabId);
              result = { success: true, message: tree };
            } catch (err) {
              result = { success: false, message: `Failed to read tab: ${err instanceof Error ? err.message : String(err)}` };
            }
            onUpdate({ kind: 'action_result', success: result.success, message: result.message });
          } else if (name === 'close_tab') {
            const targetTabId = (args as { tabId: number }).tabId;
            const description = `Closing tab ${targetTabId}`;
            onUpdate({ kind: 'action', action, description });
            try {
              await closeTabById(targetTabId);
              result = { success: true, message: `Closed tab ${targetTabId}` };
            } catch (err) {
              result = { success: false, message: `Failed to close tab: ${err instanceof Error ? err.message : String(err)}` };
            }
            onUpdate({ kind: 'action_result', success: result.success, message: result.message });
          } else {
            // Standard page actions (click, type, select, scroll, navigate, read_page, wait)

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

            const description = describeAction(action);
            onUpdate({ kind: 'action', action, description });

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

            // Clear highlights
            try {
              await this.sendToTab(tabId, { type: 'CLEAR_HIGHLIGHTS' });
            } catch {
              // ignore
            }

            // After click/navigate, wait for page changes
            if (name === 'click' || name === 'navigate') {
              await this.sleep(2000);
              await this.ensureContentScript(tabId);
            } else if (name !== 'wait' && name !== 'read_page') {
              await this.sleep(500);
            }
          }

          this.conversationLog.push(`Action: ${name} -> ${result!.message}`);

          // Add tool result to history
          messages.push({
            role: 'tool',
            content: JSON.stringify(result!),
            tool_call_id: id,
          });

          // Verify step completion after action
          try {
            const updatedPageState = await this.getPageState(tabId);
            const updatedContext = formatPageContext(
              updatedPageState.url,
              updatedPageState.title,
              updatedPageState.tree,
            );

            const verification = await verifyStepCompletion(
              step,
              updatedContext,
              plan.workingMemory,
            );

            if (verification === 'complete') {
              step.status = 'complete';
              step.result = result!.message;
              stepComplete = true;
              onUpdate({ kind: 'step_complete', stepIndex: stepIdx, result: step.result });
            } else if (verification === 'failed') {
              plan.workingMemory.failedApproaches.push(
                `Step "${step.description}" attempt ${attempt + 1}: ${result!.message}`,
              );
              if (attempt + 1 >= step.maxAttempts) {
                step.status = 'failed';
                onUpdate({
                  kind: 'step_failed',
                  stepIndex: stepIdx,
                  reason: `Failed after ${step.maxAttempts} attempts`,
                });

                // Replan
                onUpdate({ kind: 'replanning', reason: `Step "${step.description}" failed` });
                try {
                  plan = await replan(plan, updatedContext, `Step failed: ${step.description}`);
                  onUpdate({ kind: 'plan_created', plan });
                  // Break out of attempt loop; outer loop will pick up new steps
                  stepIdx = plan.currentStepIndex - 1; // -1 because loop increments
                  break;
                } catch {
                  onUpdate({ kind: 'error', message: 'Replanning failed. Stopping.' });
                  this.sendDestroyOverlay(tabId);
                  await this.saveTaskRecord(task, 'failed', startTime, totalActions, 'Replanning failed');
                  return;
                }
              }
            } else if (verification === 'unexpected') {
              onUpdate({ kind: 'replanning', reason: 'Unexpected page state' });
              try {
                plan = await replan(plan, updatedContext, 'Unexpected page state encountered');
                onUpdate({ kind: 'plan_created', plan });
                stepIdx = plan.currentStepIndex - 1;
                break;
              } catch {
                // Continue with current plan if replanning fails
              }
            }
            // 'in_progress' — continue the attempt loop
          } catch {
            // If verification fails, continue (non-critical)
          }
        }
      }
    }

    if (!this.running) {
      onUpdate({ kind: 'error', message: 'Task cancelled.' });
      this.sendDestroyOverlay(tabId);
      return;
    }

    // If we got here, all steps were processed
    // Check if the plan completed successfully
    const allComplete = plan.steps.every(
      (s) => s.status === 'complete' || s.status === 'skipped',
    );
    if (allComplete && plan.status !== 'complete') {
      plan.status = 'complete';
      const summary = `Completed: ${task}`;
      onUpdate({ kind: 'done', summary });
      onUpdate({ kind: 'speaking', text: summary });
      await this.extractAndSaveMemories(memories);
      await this.saveTaskRecord(task, 'complete', startTime, totalActions, summary);
    } else if (!allComplete) {
      onUpdate({
        kind: 'error',
        message: 'Some steps could not be completed. The task may need manual intervention.',
      });
      await this.saveTaskRecord(task, 'failed', startTime, totalActions, 'Incomplete steps');
    }

    this.sendDestroyOverlay(tabId);
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
    for (let attempt = 0; attempt < 10; attempt++) {
      if (await this.ping(tabId)) return true;
      await this.waitForTabLoad(tabId, 5000);
      await this.injectContentScript(tabId);
      await this.sleep(600);
    }
    return false;
  }

  private async getPageState(
    tabId: number,
  ): Promise<{ tree: string; url: string; title: string }> {
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

  private sendDestroyOverlay(tabId: number): void {
    try {
      this.sendToTab(tabId, { type: 'DESTROY_OVERLAY' });
    } catch {
      // best-effort
    }
  }

  private async extractAndSaveMemories(existingMemories: any[]): Promise<void> {
    try {
      const transcript = this.conversationLog.join('\n');
      if (transcript.length < 50) return; // Too short to extract anything meaningful

      const newMemories = await extractMemories(transcript, existingMemories);
      for (const memory of newMemories) {
        await addMemory(memory);
      }
    } catch {
      // Memory extraction is best-effort
    }
  }

  private async saveTaskRecord(
    goal: string,
    status: 'complete' | 'failed',
    startTime: number,
    stepCount: number,
    summary: string,
  ): Promise<void> {
    try {
      await addTaskRecord({
        id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        goal,
        status,
        startedAt: startTime,
        completedAt: Date.now(),
        stepCount,
        summary,
      });
    } catch {
      // best-effort
    }
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
    case 'open_tab':
      return `Opening tab: ${action.args.url}`;
    case 'switch_tab':
      return `Switching to tab ${action.args.tabId}`;
    case 'read_tab':
      return `Reading tab ${action.args.tabId}`;
    case 'close_tab':
      return `Closing tab ${action.args.tabId}`;
    case 'done':
      return action.args.summary;
    default:
      return 'Unknown action';
  }
}
