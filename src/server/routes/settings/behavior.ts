import { json } from '@/server/lib/remix-compat';
import type { ActionFunctionArgs, LoaderFunctionArgs } from '@/server/lib/remix-compat';
import { methodNotAllowed } from '@/server/lib/route-adapter';
import { getDb } from '@/server/db.server';
import { DEFAULT_BEHAVIOR_RULES } from '@/client/data/settings/behavior';
import { isMockMode } from '@/server/mock.server';
import { parseApprovalRules, writeToolsApproval } from '@/server/lib/omp/config/behavior';
import { isInstructionFileKind, readInstructionFile, saveInstructionFile } from '@/server/lib/omp/config/instructions';
import type { InstructionFileKind } from '@/shared/types';

/**
 * Preset stores for MOCK mode only. In real mode the Behavior panel is bound to
 * the native user instruction files (~/.omp/agent/AGENTS.md and RULES.md), so
 * Kabmo never keeps a second copy of them; the `agents` key keeps its
 * historical name from when the panel only edited behavior rules.
 */
const MOCK_KEYS: Record<InstructionFileKind, string> = {
  agents: 'omp_behavior_rules',
  rules: 'omp_rules_md',
};

/** MOCK preset per file: shipped rules for AGENTS.md, nothing for RULES.md. */
const MOCK_PRESETS: Record<InstructionFileKind, string> = {
  agents: DEFAULT_BEHAVIOR_RULES,
  rules: '',
};

function readKind(value: unknown): InstructionFileKind | null {
  const kind = value ?? 'agents';
  return isInstructionFileKind(kind) ? kind : null;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const mock = isMockMode();
  const kind = readKind(new URL(request.url).searchParams.get('file'));
  if (!kind) {
    return json({ error: 'file must be "agents" or "rules"' }, { status: 400 });
  }

  try {
    if (mock) {
      const db = await getDb();
      const row = await db.get('SELECT value FROM app_settings WHERE key = ?', [MOCK_KEYS[kind]]);
      const stored = typeof row?.value === 'string' ? row.value : undefined;
      if (stored === undefined && MOCK_PRESETS[kind]) {
        await db.run('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)', [MOCK_KEYS[kind], MOCK_PRESETS[kind]]);
      }
      return json({ kind, rules: stored ?? MOCK_PRESETS[kind], path: null, exists: false, isMock: true });
    }

    const file = await readInstructionFile(kind);
    return json({ kind, rules: file.content, path: file.path, exists: file.exists, isMock: false });
  } catch (error) {
    return json(
      {
        error: error instanceof Error ? error.message : String(error),
        kind,
        rules: MOCK_PRESETS[kind],
        path: null,
        exists: false,
        isMock: mock,
      },
      { status: 500 },
    );
  }
}

export async function action({ request, params }: ActionFunctionArgs) {
  try {
    if (request.method !== 'POST' && request.method !== 'PUT') {
      return methodNotAllowed({ request, params });
    }

    const body = await request.json();
    const kind = readKind(body.file);
    if (!kind) {
      return json({ error: 'file must be "agents" or "rules"' }, { status: 400 });
    }

    // Resetting AGENTS.md restores the shipped default rules; RULES.md has no
    // shipped default, so resetting it clears the file.
    const rules = body.action === 'reset' ? MOCK_PRESETS[kind] : body.rules;
    if (typeof rules !== 'string') {
      return json({ error: 'rules must be a string' }, { status: 400 });
    }

    const mock = isMockMode();
    if (mock) {
      const db = await getDb();
      await db.run('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)', [MOCK_KEYS[kind], rules]);
      return json({ success: true, kind, rules, path: null, exists: rules.trim().length > 0, isMock: true, nativeSynced: false });
    }

    const saved = await saveInstructionFile(kind, rules);

    // Best-effort, AGENTS.md only: recognizable approval directives in the
    // behavior rules also land in config.yml tools.approval. RULES.md holds
    // hard constraints, so mirroring approvals out of it would be surprising,
    // and a YAML failure must not fail the file save either way.
    let nativeSynced = false;
    let nativeError: string | undefined;
    const approval = kind === 'agents' ? parseApprovalRules(rules) : null;
    if (approval) {
      try {
        await writeToolsApproval(approval);
        nativeSynced = true;
      } catch (error) {
        nativeError = error instanceof Error ? error.message : String(error);
      }
    }

    return json({
      success: true,
      kind,
      rules: saved.content,
      path: saved.path,
      exists: saved.exists,
      isMock: false,
      nativeSynced,
      ...(nativeError ? { nativeError } : {}),
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
