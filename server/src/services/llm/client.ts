export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
}

export function isLlmEnabled(): boolean {
  if (process.env.ROSTER_AGENT_LLM === '0') return false;
  return Boolean(resolveApiKey());
}

function resolveApiKey(): string | undefined {
  return (
    process.env.ANTHROPIC_API_KEY?.trim() ||
    process.env.OPENAI_API_KEY?.trim() ||
    undefined
  );
}

function resolveBaseUrl(): string {
  return (process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/$/, '');
}

function isAnthropicEndpoint(baseUrl: string): boolean {
  return baseUrl.includes('anthropic.com');
}

export async function chatCompletion(
  messages: ChatMessage[],
  options: LlmOptions = {}
): Promise<string> {
  const apiKey = resolveApiKey();
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY or ANTHROPIC_API_KEY is not configured');
  }

  const baseUrl = resolveBaseUrl();
  const model = options.model ?? process.env.OPENAI_MODEL ?? 'gpt-4o-mini';
  const useJsonMode = Boolean(options.jsonMode) && !isAnthropicEndpoint(baseUrl);

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: options.temperature ?? 0.3,
      max_tokens: options.maxTokens ?? 1200,
      ...(useJsonMode ? { response_format: { type: 'json_object' } } : {}),
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`LLM request failed (${response.status}): ${body.slice(0, 300)}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error('LLM returned empty response');
  return content;
}
