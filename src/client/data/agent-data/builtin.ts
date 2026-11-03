import type { AgentItem } from '@/shared/types';

export const builtinAgents: AgentItem[] = [
  // BUILT-IN AGENTS
  {
    id: 'agent-explore',
    name: 'explore',
    description: 'Contextual grep for codebases. Locates keywords, definitions, and code structures.',
    scope: 'system',
    systemPrompt: `You are an expert exploratory assistant designed to quickly search, grep, and analyze codebases without modifying files. Report precise file paths and line numbers.`,
    isBuiltIn: true,
  },
  {
    id: 'agent-general',
    name: 'general',
    description: 'General-purpose agent untuk multi-turn development, edits, and refactoring.',
    scope: 'system',
    systemPrompt: `You are a general-purpose programming assistant. Solve tasks concisely, edit code surgically, and preserve formatting conventions.`,
    isBuiltIn: true,
  },
];
