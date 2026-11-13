/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The rest of omp's per-server schema: timeout, working directory, request-id
 * encoding, instruction inclusion, and the two credential blocks.
 *
 * These are collapsed because most servers need none of them, but they are
 * editable rather than hidden: a server that needs `cwd`, a string request id,
 * or an OAuth client is otherwise impossible to configure from Kabmo, and the
 * file would have to be hand-edited.
 */

import type { ComponentChildren } from 'preact';
import { CHECKBOX_CLASS } from '@/client/components/common/checkbox/style';
import type { McpAuthConfig, McpOAuthConfig, McpServerItem } from '@/shared/types';

const INPUT_CLASS =
  'w-full text-xs font-mono px-3 py-1.5 rounded-lg border border-ink/20 hover:border-ink/40 bg-paper focus:outline-none focus:border-ink text-ink transition-colors';

function Field({ label, children }: { label: string; children: ComponentChildren }) {
  return (
    <label className="block space-y-1">
      <span className="block text-[11px] font-medium text-ink/70">{label}</span>
      {children}
    </label>
  );
}

interface McpAdvancedSectionProps {
  server: McpServerItem;
  onChange: (patch: Partial<McpServerItem>) => void;
}

export function McpAdvancedSection({ server, onChange }: McpAdvancedSectionProps) {
  const auth = server.auth;
  const oauth = server.oauth;
  const setAuth = (patch: Partial<McpAuthConfig>) => {
    onChange({ auth: { ...(auth ?? { type: 'oauth' }), ...patch } });
  };
  const setOAuth = (patch: Partial<McpOAuthConfig>) => {
    onChange({ oauth: { ...(oauth ?? {}), ...patch } });
  };

  return (
    <details className="rounded-lg border border-ink/15 bg-ink/[0.02]">
      <summary className="cursor-pointer select-none px-3 py-2 text-xs font-semibold text-ink">
        Advanced
        <span className="ml-2 font-normal text-ink/50">timeout, working directory, credentials</span>
      </summary>

      <div className="px-3 pb-3 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Timeout (ms)">
            <input
              type="number"
              min={0}
              value={server.timeout ?? ''}
              onChange={(e) => {
                const raw = e.currentTarget.value;
                onChange({ timeout: raw === '' ? undefined : Number(raw) });
              }}
              placeholder="30000"
              className={INPUT_CLASS}
            />
          </Field>

          <Field label="Request id format">
            <select
              value={server.requestIdFormat ?? ''}
              onChange={(e) => {
                const raw = e.currentTarget.value;
                onChange({ requestIdFormat: raw === 'string' || raw === 'number' ? raw : undefined });
              }}
              className={`${INPUT_CLASS} cursor-pointer`}
            >
              <option value="">Default (number)</option>
              <option value="number">number</option>
              <option value="string">string</option>
            </select>
          </Field>

          {server.transport === 'stdio' && (
            <Field label="Working directory">
              <input
                type="text"
                value={server.cwd ?? ''}
                onChange={(e) => onChange({ cwd: e.currentTarget.value || undefined })}
                placeholder="/path/to/project"
                className={INPUT_CLASS}
              />
            </Field>
          )}

          <label className="flex items-center gap-2 pt-5 text-xs text-ink cursor-pointer select-none">
            <input
              type="checkbox"
              checked={server.instructions !== false}
              onChange={(e) => onChange({ instructions: e.currentTarget.checked })}
              className={`${CHECKBOX_CLASS} w-4 h-4 cursor-pointer`}
            />
            Include the server&rsquo;s instructions in the prompt
          </label>
        </div>

        <div className="border-t border-ink/10 pt-3 space-y-3">
          <Field label="Auth strategy">
            <select
              value={auth?.type ?? ''}
              onChange={(e) => {
                const raw = e.currentTarget.value;
                if (raw !== 'oauth' && raw !== 'apikey') {
                  onChange({ auth: undefined });
                  return;
                }
                setAuth({ type: raw });
              }}
              className={`${INPUT_CLASS} cursor-pointer`}
            >
              <option value="">None</option>
              <option value="oauth">OAuth</option>
              <option value="apikey">API key</option>
            </select>
          </Field>

          {auth && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Field label="Credential id">
                <input
                  type="text"
                  value={auth.credentialId ?? ''}
                  onChange={(e) => setAuth({ credentialId: e.currentTarget.value })}
                  className={INPUT_CLASS}
                />
              </Field>
              <Field label="Token URL">
                <input
                  type="text"
                  value={auth.tokenUrl ?? ''}
                  onChange={(e) => setAuth({ tokenUrl: e.currentTarget.value })}
                  className={INPUT_CLASS}
                />
              </Field>
              <Field label="Client id">
                <input
                  type="text"
                  value={auth.clientId ?? ''}
                  onChange={(e) => setAuth({ clientId: e.currentTarget.value })}
                  className={INPUT_CLASS}
                />
              </Field>
              <Field label="Client secret">
                <input
                  type="password"
                  value={auth.clientSecret ?? ''}
                  onChange={(e) => setAuth({ clientSecret: e.currentTarget.value })}
                  className={INPUT_CLASS}
                />
              </Field>
              <Field label="Resource">
                <input
                  type="text"
                  value={auth.resource ?? ''}
                  onChange={(e) => setAuth({ resource: e.currentTarget.value })}
                  className={INPUT_CLASS}
                />
              </Field>
            </div>
          )}
        </div>

        <div className="border-t border-ink/10 pt-3 space-y-3">
          <p className="text-[11px] font-medium text-ink/70">OAuth client (used by reauth)</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Client id">
              <input
                type="text"
                value={oauth?.clientId ?? ''}
                onChange={(e) => setOAuth({ clientId: e.currentTarget.value })}
                className={INPUT_CLASS}
              />
            </Field>
            <Field label="Client secret">
              <input
                type="password"
                value={oauth?.clientSecret ?? ''}
                onChange={(e) => setOAuth({ clientSecret: e.currentTarget.value })}
                className={INPUT_CLASS}
              />
            </Field>
            <Field label="Scope">
              <input
                type="text"
                value={oauth?.scope ?? ''}
                onChange={(e) => setOAuth({ scope: e.currentTarget.value })}
                className={INPUT_CLASS}
              />
            </Field>
            <Field label="Redirect URI">
              <input
                type="text"
                value={oauth?.redirectUri ?? ''}
                onChange={(e) => setOAuth({ redirectUri: e.currentTarget.value })}
                className={INPUT_CLASS}
              />
            </Field>
            <Field label="Callback port">
              <input
                type="number"
                min={1}
                max={65535}
                value={oauth?.callbackPort ?? ''}
                onChange={(e) => {
                  const raw = e.currentTarget.value;
                  setOAuth({ callbackPort: raw === '' ? undefined : Number(raw) });
                }}
                className={INPUT_CLASS}
              />
            </Field>
            <Field label="Callback path">
              <input
                type="text"
                value={oauth?.callbackPath ?? ''}
                onChange={(e) => setOAuth({ callbackPath: e.currentTarget.value })}
                className={INPUT_CLASS}
              />
            </Field>
            <Field label="Prompt">
              <input
                type="text"
                value={oauth?.prompt ?? ''}
                onChange={(e) => setOAuth({ prompt: e.currentTarget.value })}
                placeholder="consent"
                className={INPUT_CLASS}
              />
            </Field>
          </div>
        </div>
      </div>
    </details>
  );
}
