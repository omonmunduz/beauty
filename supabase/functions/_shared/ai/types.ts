// Assistant types. Pure TS: shared by the edge function and unit tests.

export type Scope = 'client' | 'owner';

export type ToolName = 'studio_info' | 'list_services' | 'list_masters' | 'find_slots' | 'owner_schedule' | 'owner_stats';

export interface ToolInvocation {
  name: ToolName;
  args: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ToolSpec {
  type: 'function';
  function: { name: ToolName; description: string; parameters: Record<string, unknown> };
}

export interface CompletionRequest {
  messages: ChatMessage[];
  tools?: ToolSpec[];
  json?: boolean;
}

export interface CompletionResponse {
  message: ChatMessage;
  totalTokens: number;
}

/** OpenAI-compatible chat completion; injected so loops are testable without network. */
export type CompleteFn = (req: CompletionRequest) => Promise<CompletionResponse>;

/** Runs one allowed tool on the server, bound to the request's tenant. */
export type Executor = (call: ToolInvocation) => Promise<unknown>;

export interface StudioContext {
  slug: string;
  name: string;
  timezone: string;
  currency: string;
  services: { id: string; name: string; category: string; price: number; duration_min: number; popular?: boolean }[];
  masters: { id: string; name: string; role_title: string }[];
}

export interface AssistantAction {
  label: string;
  href: string;
}

export interface AssistantReply {
  text: string;
  mode: 'llm-native' | 'llm-json' | 'offline';
  tools: ToolName[];
  actions: AssistantAction[];
  tokens: number;
}
