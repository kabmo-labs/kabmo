import type { CatalogSkillItem, SkillCatalogSource, SkillItem } from '@/shared/types';

export const DEFAULT_SKILLS: SkillItem[] = [
  // MICROSOFT-FOUNDRY Group (5 skills)
  {
    id: 'skill-ms-capacity',
    name: 'capacity',
    description: 'Manage and allocate Azure OpenAI / Microsoft Foundry deployment quota and PTU capacity.',
    location: 'user',
    locationLabel: 'User / OpenCode',
    group: 'MICROSOFT-FOUNDRY',
    project: 'ompchamber',
    instructions: `---
description: "Manage and allocate Azure OpenAI / Microsoft Foundry deployment quota and PTU capacity."
---

## Capacity Management Protocol
1. Query current PTU (Provisioned Throughput Unit) utilization.
2. Check regional quota ceilings before queuing batch completions.
3. Automatically switch to pay-as-you-go overflow when quota exceeds 90%.`,
  },
  {
    id: 'skill-ms-customize',
    name: 'customize',
    description: 'Fine-tune hyperparameters and customize system prompt overlays for foundry models.',
    location: 'user',
    locationLabel: 'User / OpenCode',
    group: 'MICROSOFT-FOUNDRY',
    project: 'ompchamber',
    instructions: `---
description: "Fine-tune hyperparameters and customize system prompt overlays for foundry models."
---

## Customization Protocol
1. Load base model configuration presets.
2. Inject temperature, frequency penalty, and presence penalty parameters.
3. Apply safety content filter profiles.`,
  },
  {
    id: 'skill-ms-deploy',
    name: 'deploy-model',
    description: 'Deploy and register serverless model endpoints on Microsoft Foundry edge.',
    location: 'user',
    locationLabel: 'User / OpenCode',
    group: 'MICROSOFT-FOUNDRY',
    project: 'ompchamber',
    instructions: `---
description: "Deploy and register serverless model endpoints on Microsoft Foundry edge."
---

## Deployment Steps
1. Verify model weights availability and hardware target.
2. Register deployment route in the edge API gateway.
3. Perform initial healthcheck handshake before traffic cutover.`,
  },
  {
    id: 'skill-ms-finetune',
    name: 'finetuning',
    description: 'Configure LoRA and full fine-tuning jobs on custom enterprise datasets.',
    location: 'user',
    locationLabel: 'User / OpenCode',
    group: 'MICROSOFT-FOUNDRY',
    project: 'ompchamber',
    instructions: `---
description: "Configure LoRA and full fine-tuning jobs on custom enterprise datasets."
---

## Finetuning Job Spec
1. Validate JSONL formatted prompt/completion splits.
2. Specify learning rate warmup, epochs, and checkpoint intervals.
3. Stream training loss metrics to chamber telemetry matrix.`,
  },
  {
    id: 'skill-ms-preset',
    name: 'preset',
    description: 'Apply pre-tested model configuration and inference presets for foundry.',
    location: 'user',
    locationLabel: 'User / OpenCode',
    group: 'MICROSOFT-FOUNDRY',
    project: 'ompchamber',
    instructions: `---
description: "Apply pre-tested model configuration and inference presets for foundry."
---

## Presets Available
- \`code-generation\`: temp 0.1, top_p 0.95
- \`creative-architecture\`: temp 0.7, top_p 1.0
- \`strict-eval\`: temp 0.0, top_p 0.5`,
  },

  // Standalone User Skills (4 skills)
  {
    id: 'skill-customize-opencode',
    name: 'customize-opencode',
    description: 'Customize OpenCode runtime bindings, language server hooks, and tool execution policies.',
    location: 'user',
    locationLabel: 'User / OpenCode',
    project: 'ompchamber',
    instructions: `---
description: "Customize OpenCode runtime bindings, language server hooks, and tool execution policies."
---

## OpenCode Configuration
1. Bind AST parser to Bun v1.2 engine.
2. Enable inline diagnostics and auto-repair suggestions.`,
  },
  {
    id: 'skill-microsoft-foundry',
    name: 'microsoft-foundry',
    description: 'Comprehensive integration toolkit for Microsoft Foundry AI ecosystem and telemetry.',
    location: 'user',
    locationLabel: 'User / OpenCode',
    project: 'ompchamber',
    instructions: `---
description: "Comprehensive integration toolkit for Microsoft Foundry AI ecosystem and telemetry."
---

## Foundry Integration
- Authenticate using Azure Managed Identity or API secret tokens.
- Telemetry events stream directly into Kabmo Inspector.`,
  },
  {
    id: 'skill-security-research',
    name: 'security-research',
    description: 'Automated vulnerability scanner and static security analysis toolchain.',
    location: 'user',
    locationLabel: 'User / OpenCode',
    project: 'ompchamber',
    instructions: `---
description: "Automated vulnerability scanner and static security analysis toolchain."
---

## Security Scan Protocol
1. Scan lockfiles for known CVE advisories.
2. Check for unsafe regex patterns (ReDoS vectors).
3. Verify TLS 1.3 requirements across edge routes.`,
  },
  {
    id: 'skill-security-review',
    name: 'security-review',
    description: 'Automated pre-flight security review, secret leak inspection, and dependency audit checker.',
    location: 'user',
    locationLabel: 'User / OpenCode',
    project: 'ompchamber',
    instructions: `---
description: "Automated pre-flight security review, secret leak inspection, and dependency audit checker."
---

## Pre-flight Review Checklist
- Reject hardcoded secrets, private keys, or API tokens.
- Ensure strict sanitization on incoming JSON parameters.`,
  },
];

export const DEFAULT_CATALOG_SOURCES: SkillCatalogSource[] = [
  {
    id: 'anthropic',
    name: 'Anthropic',
    repo: 'anthropics/skills',
    stars: '175K',
    updatedAt: 'Updated 3d ago',
    skillCount: 20,
  },
  {
    id: 'openai',
    name: 'OpenAI',
    repo: 'openai/skills',
    stars: '26K',
    updatedAt: 'Updated 7w ago',
    skillCount: 14,
  },
  {
    id: 'cursor',
    name: 'Cursor',
    repo: 'cursor/plugins',
    stars: '7K',
    updatedAt: 'Updated 2d ago',
    skillCount: 18,
  },
  {
    id: 'matt-pocock',
    name: 'Matt Pocock',
    repo: 'mattpocock/skills',
    stars: '255K',
    updatedAt: 'Updated 2d ago',
    skillCount: 12,
  },
];

export const DEFAULT_CATALOG_SKILLS: CatalogSkillItem[] = [
  // Anthropic Skills
  {
    id: 'cat-academy-guide',
    sourceId: 'anthropic',
    name: 'academy-guide',
    description: 'Stop and check this skill before finishing any reply to a question about how to use Claude or a Claude product — it recommends matching courses, tutorials, and use cases from Claude Academy...',
    repoTag: 'anthropics/skills · skills/academy-guide',
    githubUrl: 'https://github.com/anthropics/skills/tree/main/skills/academy-guide',
    instructions: `---
description: "Claude Academy guidance and course matching"
---

## Guidance Protocol
- Recommend relevant interactive lessons when users inquire about prompting techniques.`,
  },
  {
    id: 'cat-algorithmic-art',
    sourceId: 'anthropic',
    name: 'algorithmic-art',
    description: 'Creating algorithmic art using p5.js with seeded randomness and interactive parameter exploration. Use this when users request creating art using code, generative art, algorithmic art, flow fields, or...',
    repoTag: 'anthropics/skills · skills/algorithmic-art',
    githubUrl: 'https://github.com/anthropics/skills/tree/main/skills/algorithmic-art',
    instructions: `---
description: "Generative art creation using p5.js"
---

## Canvas & Seed Configuration
- Always initialize canvas with non-blocking resize observers.
- Use seeded random generators for reproducible generative results.`,
  },
  {
    id: 'cat-react-performance',
    sourceId: 'anthropic',
    name: 'react-performance',
    description: 'Detect unnecessary re-renders, optimize memoization boundaries, and audit component tree render bottlenecks.',
    repoTag: 'anthropics/skills · skills/react-performance',
    githubUrl: 'https://github.com/anthropics/skills/tree/main/skills/react-performance',
    instructions: `---
description: "React component tree optimization and profiler auditing"
---

## Rules
- Prefer primitive values in dependency arrays.
- Split oversized state contexts to prevent cascading renders.`,
  },
  {
    id: 'cat-tailwind-v4',
    sourceId: 'anthropic',
    name: 'tailwind-v4',
    description: 'Modern Tailwind CSS v4 patterns, CSS custom variable theming, and zero-configuration design system integration.',
    repoTag: 'anthropics/skills · skills/tailwind-v4',
    githubUrl: 'https://github.com/anthropics/skills/tree/main/skills/tailwind-v4',
    instructions: `---
description: "Tailwind CSS v4 design tokens and theme variables"
---

## Tokens Guidelines
- Map semantic colors strictly to CSS custom variables (var(--theme-ink), var(--theme-paper)).`,
  },

  // OpenAI Skills
  {
    id: 'cat-openai-o-reasoning',
    sourceId: 'openai',
    name: 'o-series-reasoning',
    description: 'Structured chain-of-thought verification and reasoning trace analysis for OpenAI o1 and o3 models.',
    repoTag: 'openai/skills · skills/o-series-reasoning',
    githubUrl: 'https://github.com/openai/skills/tree/main/skills/o-series-reasoning',
    instructions: `---
description: "Prompt structures for deep reasoning models"
---

## Protocol
- Deconstruct complex queries into explicit mathematical verification stages.`,
  },
  {
    id: 'cat-openai-evals',
    sourceId: 'openai',
    name: 'automated-evals',
    description: 'Benchmarking and automated evaluation harness for model accuracy, hallucination tracking, and tool reliability.',
    repoTag: 'openai/skills · skills/automated-evals',
    githubUrl: 'https://github.com/openai/skills/tree/main/skills/automated-evals',
    instructions: `---
description: "Model benchmarking and eval metrics collector"
---

## Metrics Tracked
- Pass@1, execution time, token economy, tool call precision.`,
  },

  // Cursor Skills
  {
    id: 'cat-cursor-bun-expert',
    sourceId: 'cursor',
    name: 'bun-edge-builder',
    description: 'High-speed package compilation, TypeScript type stripping, and native Bun runtime optimizations for dev servers.',
    repoTag: 'cursor/plugins · plugins/bun-edge-builder',
    githubUrl: 'https://github.com/cursor/plugins/tree/main/plugins/bun-edge-builder',
    instructions: `---
description: "Bun v1.2 edge route builder and test runner"
---

## Commands
- Use bun test --watch for lightning-fast test execution.`,
  },
  {
    id: 'cat-cursor-git-sentinel',
    sourceId: 'cursor',
    name: 'git-sentinel',
    description: 'Automated conventional commit generator, branch protection validator, and git hygiene manager.',
    repoTag: 'cursor/plugins · plugins/git-sentinel',
    githubUrl: 'https://github.com/cursor/plugins/tree/main/plugins/git-sentinel',
    instructions: `---
description: "Conventional commit format auditor"
---

## Commit Guidelines
- Structure: feat(scope): message, fix(scope): message.`,
  },

  // Matt Pocock Skills
  {
    id: 'cat-matt-ts-wizard',
    sourceId: 'matt-pocock',
    name: 'ts-wizard',
    description: 'Advanced TypeScript type gymnastics, distributive conditional types, template literal helpers, and nominal brand types.',
    repoTag: 'mattpocock/skills · skills/ts-wizard',
    githubUrl: 'https://github.com/mattpocock/skills/tree/main/skills/ts-wizard',
    instructions: `---
description: "TypeScript advanced generic patterns"
---

## Type Patterns
- Use branded types for IDs to prevent cross-assignment.`,
  },
  {
    id: 'cat-matt-zod-mastery',
    sourceId: 'matt-pocock',
    name: 'zod-mastery',
    description: 'Bulletproof schema validation, runtime error transformation, and automatic type inference with Zod.',
    repoTag: 'mattpocock/skills · skills/zod-mastery',
    githubUrl: 'https://github.com/mattpocock/skills/tree/main/skills/zod-mastery',
    instructions: `---
description: "Zod runtime schema validation patterns"
---

## Best Practices
- Define schemas as single source of truth for runtime and compile-time types.`,
  },
];
