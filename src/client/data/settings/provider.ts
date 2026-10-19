import type { PresetProviderOption, ProviderItem } from '@/shared/types/settings/provider';

export const DEFAULT_PROVIDERS_LIST: ProviderItem[] = [
  {
    id: 'provider-deepseek',
    name: 'DeepSeek',
    slug: 'deepseek',
    icon: 'deepseek',
    status: 'connected',
    configuredIn: 'auth credentials',
    credentialSource: 'kabmo',
    apiKey: 'sk-ds-••••••••••••••••••••38f1',
    baseUrl: 'https://api.deepseek.com/v1',
    models: [
      {
        id: 'ds-v4-flash-vision-exp',
        name: 'DeepSeek V4 Flash Vision Exp',
        contextWindow: '1M ctx · 384K out',
        hasTools: true,
        hasVision: true,
        hasReasoning: true,
        isVisible: true,
        temperature: 0.7,
        maxTokens: 384000,
        topP: 0.95,
        reasoningEffort: 'medium',
      },
      {
        id: 'ds-v4-flash',
        name: 'DeepSeek V4 Flash',
        contextWindow: '1M ctx · 384K out',
        hasTools: true,
        hasVision: false,
        hasReasoning: true,
        isVisible: true,
        temperature: 0.6,
        maxTokens: 384000,
        topP: 0.95,
        reasoningEffort: 'low',
      },
      {
        id: 'ds-v4-pro',
        name: 'DeepSeek V4 Pro',
        contextWindow: '1M ctx · 384K out',
        hasTools: true,
        hasVision: false,
        hasReasoning: true,
        isVisible: true,
        temperature: 0.6,
        maxTokens: 384000,
        topP: 0.95,
        reasoningEffort: 'high',
      },
    ],
  },
  {
    id: 'provider-agentrouter',
    name: 'AgentRouter',
    slug: 'agentrouter',
    icon: 'agentrouter',
    status: 'connected',
    configuredIn: 'auth credentials',
    credentialSource: 'kabmo',
    apiKey: 'ar-live-•••••••••••••••••••89c2',
    baseUrl: 'https://router.agent.ai/v1',
    models: [
      {
        id: 'ar-auto-fast',
        name: 'AgentRouter Auto (Fastest)',
        contextWindow: '2M ctx · 128K out',
        hasTools: true,
        hasVision: true,
        hasReasoning: false,
        isVisible: true,
        temperature: 0.7,
        maxTokens: 128000,
      },
      {
        id: 'ar-coder-max',
        name: 'AgentRouter Coder Max',
        contextWindow: '1M ctx · 64K out',
        hasTools: true,
        hasVision: false,
        hasReasoning: true,
        isVisible: true,
        temperature: 0.5,
        maxTokens: 64000,
      },
      {
        id: 'ar-reasoning-preview',
        name: 'AgentRouter Reasoning Preview',
        contextWindow: '128K ctx · 32K out',
        hasTools: true,
        hasVision: false,
        hasReasoning: true,
        isVisible: true,
        temperature: 0.6,
        maxTokens: 32000,
      },
    ],
  },
  {
    id: 'provider-commandcode',
    name: 'Command Code',
    slug: 'command-code',
    icon: 'commandcode',
    status: 'connected',
    configuredIn: 'auth credentials',
    credentialSource: 'kabmo',
    apiKey: 'cc-key-••••••••••••••••••••7a12',
    baseUrl: 'https://api.commandcode.dev/v1',
    models: Array.from({ length: 41 }, (_, i) => {
      const names = [
        'Command Code Qwen-2.5-Coder-32B-Instruct',
        'Command Code DeepSeek-Coder-V2-0724',
        'Command Code Claude-3.5-Haiku-Fast',
        'Command Code GLM-4-9B-Chat',
        'Command Code Mistral-Codestral-22B',
        'Command Code Llama-3.3-70B-Instruct',
        'Command Code StarCoder-2-15B',
        'Command Code CodeGemma-7B-IT',
        'Command Code Yi-Coder-9B',
        'Command Code DeepSeek-V3-Base',
        'Command Code OpenAI-GPT-4o-Mini',
        'Command Code Gemini-2.5-Flash-Code',
      ];
      const modelName = i < names.length ? names[i] : `Command Code Custom Model-${i + 1}`;
      return {
        id: `cc-model-${i + 1}`,
        name: modelName,
        contextWindow: i % 2 === 0 ? '1M ctx · 128K out' : '128K ctx · 16K out',
        hasTools: true,
        hasVision: i % 3 === 0,
        hasReasoning: i % 4 === 0,
        isVisible: true,
        temperature: 0.6,
        maxTokens: 64000,
      };
    }),
  },
  {
    id: 'provider-opencodezen',
    name: 'OpenCode Zen',
    slug: 'opencode-zen',
    icon: 'opencode',
    status: 'connected',
    configuredIn: 'auth credentials',
    credentialSource: 'kabmo',
    apiKey: 'zen-live-•••••••••••••••••••44fa',
    baseUrl: 'https://zen.opencode.ai/v1',
    models: [
      { id: 'zen-claude-37', name: 'Zen Claude 3.7 Sonnet', contextWindow: '200K ctx · 64K out', hasTools: true, hasVision: true, hasReasoning: true, isVisible: true, temperature: 0.7 },
      { id: 'zen-deepseek-r1', name: 'Zen DeepSeek R1 Distill', contextWindow: '128K ctx · 64K out', hasTools: true, hasVision: false, hasReasoning: true, isVisible: true, temperature: 0.6 },
      { id: 'zen-gemini-25', name: 'Zen Gemini 2.5 Flash', contextWindow: '1M ctx · 32K out', hasTools: true, hasVision: true, hasReasoning: false, isVisible: true, temperature: 0.7 },
      { id: 'zen-gpt-4o', name: 'Zen GPT-4o Native', contextWindow: '128K ctx · 16K out', hasTools: true, hasVision: true, hasReasoning: false, isVisible: true, temperature: 0.7 },
      { id: 'zen-mistral-large', name: 'Zen Mistral Large 2', contextWindow: '128K ctx · 32K out', hasTools: true, hasVision: false, hasReasoning: false, isVisible: true, temperature: 0.6 },
      { id: 'zen-qwen-25', name: 'Zen Qwen 2.5 Coder 32B', contextWindow: '128K ctx · 32K out', hasTools: true, hasVision: false, hasReasoning: false, isVisible: true, temperature: 0.6 },
      { id: 'zen-llama-33', name: 'Zen Llama 3.3 70B', contextWindow: '128K ctx · 16K out', hasTools: true, hasVision: false, hasReasoning: false, isVisible: true, temperature: 0.6 },
    ],
  },
  {
    id: 'provider-claudecode',
    name: 'Claude Code',
    slug: 'claude-code',
    icon: 'claude',
    status: 'connected',
    configuredIn: 'auth credentials',
    credentialSource: 'kabmo',
    apiKey: 'sk-ant-•••••••••••••••••••••991c',
    baseUrl: 'https://api.anthropic.com/v1',
    models: [
      { id: 'claude-37-sonnet', name: 'Claude 3.7 Sonnet', contextWindow: '200K ctx · 64K out', hasTools: true, hasVision: true, hasReasoning: true, isVisible: true, temperature: 0.7 },
      { id: 'claude-37-thinking', name: 'Claude 3.7 Sonnet (Thinking)', contextWindow: '200K ctx · 64K out', hasTools: true, hasVision: true, hasReasoning: true, isVisible: true, temperature: 0.6 },
      { id: 'claude-35-sonnet', name: 'Claude 3.5 Sonnet', contextWindow: '200K ctx · 8K out', hasTools: true, hasVision: true, hasReasoning: false, isVisible: true, temperature: 0.7 },
      { id: 'claude-35-haiku', name: 'Claude 3.5 Haiku', contextWindow: '200K ctx · 8K out', hasTools: true, hasVision: false, hasReasoning: false, isVisible: true, temperature: 0.7 },
      { id: 'claude-3-opus', name: 'Claude 3 Opus', contextWindow: '200K ctx · 4K out', hasTools: true, hasVision: true, hasReasoning: false, isVisible: true, temperature: 0.7 },
      { id: 'claude-3-sonnet', name: 'Claude 3 Sonnet', contextWindow: '200K ctx · 4K out', hasTools: true, hasVision: true, hasReasoning: false, isVisible: true, temperature: 0.7 },
    ],
  },
];

/**
 * Providers offered by the Add Provider picker. `group` is the section the
 * picker renders; `api`/`auth`/`discovery` are the `models.yml` fields the
 * preset seeds, so a choice that omp understands is made once here rather than
 * re-derived from the URL at write time.
 *
 * A preset whose id names a provider omp already bundles (`bundled: true`) is
 * an OVERRIDE entry: omp keeps serving its own model list for that provider and
 * only the endpoint changes. That is the documented way to point a bundled
 * provider at a proxy, and it is deliberately not offered for providers whose
 * models Kabmo would then have to duplicate.
 */
export const PRESET_NEW_PROVIDERS: PresetProviderOption[] = [
  {
    id: 'openai', name: 'OpenAI', slug: 'openai', icon: 'openai',
    defaultUrl: 'https://api.openai.com/v1', api: 'openai-responses', group: 'Frontier APIs',
  },
  {
    id: 'anthropic', name: 'Anthropic', slug: 'anthropic', icon: 'claude',
    defaultUrl: 'https://api.anthropic.com/v1', api: 'anthropic-messages', group: 'Frontier APIs',
  },
  {
    id: 'google', name: 'Google Gemini', slug: 'google', icon: 'gemini',
    defaultUrl: 'https://generativelanguage.googleapis.com/v1beta',
    api: 'google-generative-ai', group: 'Frontier APIs',
  },
  {
    id: 'groq', name: 'Groq Cloud', slug: 'groq', icon: 'groq',
    defaultUrl: 'https://api.groq.com/openai/v1', api: 'openai-completions', group: 'Frontier APIs',
  },
  {
    id: 'mistral', name: 'Mistral AI', slug: 'mistral', icon: 'mistral',
    defaultUrl: 'https://api.mistral.ai/v1', api: 'openai-completions', group: 'Frontier APIs',
  },
  {
    id: 'xai', name: 'xAI', slug: 'xai', icon: 'xai',
    defaultUrl: 'https://api.x.ai/v1', api: 'openai-completions', group: 'Frontier APIs',
  },
  {
    id: 'cerebras', name: 'Cerebras', slug: 'cerebras', icon: 'cerebras',
    defaultUrl: 'https://api.cerebras.ai/v1', api: 'openai-completions', group: 'Frontier APIs',
  },
  {
    id: 'deepseek', name: 'DeepSeek', slug: 'deepseek', icon: 'deepseek',
    defaultUrl: 'https://api.deepseek.com/v1', api: 'openai-completions', group: 'Frontier APIs',
  },
  {
    id: 'openrouter', name: 'OpenRouter', slug: 'openrouter', icon: 'openrouter',
    defaultUrl: 'https://openrouter.ai/api/v1', api: 'openai-completions', group: 'Gateways',
  },
  {
    id: 'together', name: 'Together AI', slug: 'together', icon: 'together',
    defaultUrl: 'https://api.together.xyz/v1', api: 'openai-completions', group: 'Gateways',
  },
  {
    id: 'fireworks', name: 'Fireworks', slug: 'fireworks', icon: 'fireworks',
    defaultUrl: 'https://api.fireworks.ai/inference/v1', api: 'openai-completions', group: 'Gateways',
  },
  {
    id: 'deepinfra', name: 'DeepInfra', slug: 'deepinfra', icon: 'deepinfra',
    defaultUrl: 'https://api.deepinfra.com/v1/openai', api: 'openai-completions', group: 'Gateways',
  },
  {
    id: 'siliconflow', name: 'SiliconFlow', slug: 'siliconflow', icon: 'siliconflow',
    defaultUrl: 'https://api.siliconflow.com/v1', api: 'openai-completions', group: 'Gateways',
  },
  {
    id: 'nvidia', name: 'NVIDIA NIM', slug: 'nvidia', icon: 'nvidia',
    defaultUrl: 'https://integrate.api.nvidia.com/v1', api: 'openai-completions', group: 'Gateways',
  },
  {
    id: 'novita', name: 'Novita AI', slug: 'novita', icon: 'novita',
    defaultUrl: 'https://api.novita.ai/v3/openai', api: 'openai-completions', group: 'Gateways',
  },
  {
    id: 'vercel-ai-gateway', name: 'Vercel AI Gateway', slug: 'vercel-ai-gateway', icon: 'vercel',
    defaultUrl: 'https://ai-gateway.vercel.sh/v1', api: 'openai-completions', group: 'Gateways',
  },
  {
    id: 'ollama', name: 'Ollama (Local)', slug: 'ollama', icon: 'ollama',
    defaultUrl: 'http://127.0.0.1:11434', api: 'openai-responses',
    auth: 'none', discovery: 'ollama', group: 'Local & self-hosted',
  },
  {
    id: 'lm-studio', name: 'LM Studio (Local)', slug: 'lm-studio', icon: 'lmstudio',
    defaultUrl: 'http://127.0.0.1:1234/v1', api: 'openai-completions',
    auth: 'none', discovery: 'lm-studio', group: 'Local & self-hosted',
  },
  {
    id: 'llama-cpp', name: 'llama.cpp (Local)', slug: 'llama.cpp', icon: 'llamacpp',
    defaultUrl: 'http://127.0.0.1:8080', api: 'openai-responses',
    auth: 'none', discovery: 'llama.cpp', group: 'Local & self-hosted',
  },
  {
    id: 'vllm', name: 'vLLM (Local)', slug: 'vllm', icon: 'vllm',
    defaultUrl: 'http://127.0.0.1:8000/v1', api: 'openai-completions',
    auth: 'none', discovery: 'openai-models-list', group: 'Local & self-hosted',
  },
  {
    id: 'litellm', name: 'LiteLLM Proxy', slug: 'litellm', icon: 'litellm',
    defaultUrl: 'http://localhost:4000/v1', api: 'openai-completions',
    discovery: 'litellm', group: 'Local & self-hosted',
  },
  {
    id: 'azure', name: 'Azure OpenAI', slug: 'azure', icon: 'azure',
    defaultUrl: 'https://YOUR-RESOURCE.openai.azure.com/openai/v1',
    api: 'azure-openai-responses', bundled: true, group: 'Other dialects',
  },
  {
    id: 'amazon-bedrock', name: 'Amazon Bedrock', slug: 'amazon-bedrock', icon: 'amazon',
    defaultUrl: 'https://bedrock-runtime.us-east-1.amazonaws.com',
    api: 'bedrock-converse-stream', bundled: true, group: 'Other dialects',
  },
  {
    id: 'google-vertex', name: 'Google Vertex AI', slug: 'google-vertex', icon: 'vertexai',
    defaultUrl: 'https://us-central1-aiplatform.googleapis.com/v1',
    api: 'google-vertex', bundled: true, group: 'Other dialects',
  },
  {
    id: 'openai-codex', name: 'OpenAI Codex', slug: 'openai-codex', icon: 'codex',
    defaultUrl: 'https://chatgpt.com/backend-api/codex',
    api: 'openai-codex-responses', bundled: true, group: 'Other dialects',
  },
  {
    id: 'anthropic-custom', name: 'Anthropic-Compatible Proxy', slug: 'anthropic-custom', icon: 'claude',
    defaultUrl: 'https://', api: 'anthropic-messages', group: 'Custom',
  },
  {
    id: 'openai-custom', name: 'OpenAI-Compatible Gateway', slug: 'openai-custom', icon: 'openai',
    defaultUrl: 'https://', api: 'openai-completions', group: 'Custom',
  },
  {
    id: 'custom', name: 'Custom OpenAI-Compatible', slug: 'custom', icon: 'custom',
    defaultUrl: 'https://', api: 'openai-completions', group: 'Custom',
  },
];
