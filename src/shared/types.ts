// ---- Task Planning ----

export interface TaskPlan {
  goal: string;
  steps: PlanStep[];
  currentStepIndex: number;
  status: 'planning' | 'executing' | 'replanning' | 'complete' | 'failed';
  workingMemory: WorkingMemory;
}

export interface PlanStep {
  id: string;
  description: string;
  successCriteria: string;
  status: 'pending' | 'active' | 'complete' | 'failed' | 'skipped';
  result?: string;
  attempts: number;
  maxAttempts: number;
}

export interface WorkingMemory {
  discoveredFacts: string[];
  failedApproaches: string[];
  currentContext: string;
}

// ---- User Profile & Memory ----

export interface UserProfile {
  name: string;
  email: string;
  role: string;
  preferredSites: string[];
  customFacts: Record<string, string>;
  onboardingComplete: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface Memory {
  id: string;
  fact: string;
  category: 'identity' | 'preference' | 'workflow' | 'site_knowledge' | 'relationship';
  source: 'onboarding' | 'conversation' | 'behavior';
  confidence: number;
  createdAt: number;
  lastUsedAt: number;
  usageCount: number;
}

// ---- Tab Registry ----

export interface TabEntry {
  tabId: number;
  url: string;
  title: string;
  purpose: string;
  status: 'active' | 'loading' | 'idle' | 'closed';
}

// ---- Task History ----

export interface TaskRecord {
  id: string;
  goal: string;
  status: 'complete' | 'failed';
  startedAt: number;
  completedAt: number;
  stepCount: number;
  summary: string;
}

// ---- Accessibility Tree ----

export interface A11yNode {
  id: number;
  role: string;
  name: string;
  value?: string;
  description?: string;
  focused?: boolean;
  checked?: boolean;
  disabled?: boolean;
  children?: A11yNode[];
}

// ---- Agent Actions (tool calls) ----

export type AgentAction =
  | { name: 'click'; args: { target: string; index?: number } }
  | { name: 'type'; args: { target: string; text: string; clearFirst?: boolean } }
  | { name: 'select'; args: { target: string; option: string } }
  | { name: 'scroll'; args: { direction: 'up' | 'down' | 'top' | 'bottom'; amount?: number } }
  | { name: 'navigate'; args: { url: string } }
  | { name: 'read_page'; args: { query: string } }
  | { name: 'wait'; args: { milliseconds?: number } }
  | { name: 'open_tab'; args: { url: string; purpose: string } }
  | { name: 'switch_tab'; args: { tabId: number } }
  | { name: 'read_tab'; args: { tabId: number } }
  | { name: 'close_tab'; args: { tabId: number } }
  | { name: 'done'; args: { summary: string } };

// ---- LLM Provider ----

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ChatRequest {
  model: string;
  systemPrompt: string;
  messages: Message[];
  tools: ToolDefinition[];
  temperature?: number;
  maxTokens?: number;
}

export interface ChatResponse {
  type: 'text' | 'tool_call';
  text?: string;
  toolCall?: {
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  };
}

export interface LLMProvider {
  name: string;
  chat(request: ChatRequest): Promise<ChatResponse>;
}

// ---- Settings ----

export interface HeySurfSettings {
  llm: {
    provider: 'openai' | 'anthropic' | 'gemini' | 'groq' | 'mistral' | 'deepseek' | 'xai' | 'together' | 'openrouter';
    apiKey: string;
    model: string;
  };
  voice: {
    inputEnabled: boolean;
    outputEnabled: boolean;
    language: string;
    voiceURI?: string;
    rate: number;
  };
  agent: {
    maxSteps: number;
    confirmDestructive: boolean;
    autoScroll: boolean;
    highlightActions: boolean;
  };
}

export const DEFAULT_SETTINGS: HeySurfSettings = {
  llm: {
    provider: 'openai',
    apiKey: '',
    model: 'gpt-4o',
  },
  voice: {
    inputEnabled: true,
    outputEnabled: true,
    language: 'en-US',
    rate: 1.0,
  },
  agent: {
    maxSteps: 15,
    confirmDestructive: true,
    autoScroll: true,
    highlightActions: true,
  },
};

// ---- Chrome Message Passing ----

export type ChromeMessage =
  | { type: 'PING' }
  | { type: 'MIC_PERMISSION_GRANTED' }
  | { type: 'GET_A11Y_TREE' }
  | { type: 'EXECUTE_ACTION'; action: AgentAction }
  | { type: 'HIGHLIGHT_ELEMENT'; target: string; index?: number }
  | { type: 'CLEAR_HIGHLIGHTS' }
  | { type: 'GET_PAGE_INFO' }
  | { type: 'A11Y_TREE_RESULT'; tree: A11yNode[]; url: string; title: string }
  | { type: 'ACTION_RESULT'; success: boolean; message: string }
  | { type: 'PAGE_INFO_RESULT'; url: string; title: string }
  | { type: 'START_AGENT'; task: string }
  | { type: 'STOP_AGENT' }
  | { type: 'AGENT_UPDATE'; update: AgentUpdate }
  | { type: 'PLAN_UPDATE'; plan: TaskPlan }
  | { type: 'INIT_OVERLAY' }
  | { type: 'DESTROY_OVERLAY' };

export type AgentUpdate =
  | { kind: 'thinking'; message: string }
  | { kind: 'action'; action: AgentAction; description: string }
  | { kind: 'action_result'; success: boolean; message: string }
  | { kind: 'speaking'; text: string }
  | { kind: 'plan_created'; plan: TaskPlan }
  | { kind: 'step_started'; stepIndex: number; description: string }
  | { kind: 'step_complete'; stepIndex: number; result: string }
  | { kind: 'step_failed'; stepIndex: number; reason: string }
  | { kind: 'replanning'; reason: string }
  | { kind: 'done'; summary: string }
  | { kind: 'error'; message: string };
