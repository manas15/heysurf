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
    provider: 'openai' | 'anthropic' | 'gemini';
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
  | { type: 'AGENT_UPDATE'; update: AgentUpdate };

export type AgentUpdate =
  | { kind: 'thinking'; message: string }
  | { kind: 'action'; action: AgentAction; description: string }
  | { kind: 'action_result'; success: boolean; message: string }
  | { kind: 'speaking'; text: string }
  | { kind: 'done'; summary: string }
  | { kind: 'error'; message: string };
