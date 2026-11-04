import { CHECKBOX_CLASS } from '@/client/components/common/checkbox/style';
import { useEffect, useState } from 'preact/hooks';
import type { FormEvent, FunctionComponent } from 'preact/compat';
import { AlertCircle, Check, Code, Globe, Loader2, Save, Terminal, Trash2 } from 'lucide-preact';
import type { McpEnvVar, McpScope, McpServerItem, WriteOutcome } from '@/shared/types';
import { ConnectionTest } from '@/client/components/settings/categories/mcp-settings/ConnectionTest';
import { McpEnvVarsSection } from '@/client/components/settings/categories/mcp-settings/EnvVarsSection';
import { useWriteFeedback } from '@/client/hooks/settings/write-feedback';

function parseCommandArgs(text: string): string[] {
  return text.split('\n').map((s) => s.trim()).filter(Boolean);
}

interface McpDetailPaneProps {
  server: McpServerItem;
  isNew?: boolean;
  onSave: (updatedServer: McpServerItem) => Promise<WriteOutcome>;
  onDelete?: (serverId: string) => Promise<WriteOutcome>;
  onOpenImportModal: () => void;
}

export const McpDetailPane: FunctionComponent<McpDetailPaneProps> = ({
  server,
  isNew = false,
  onSave,
  onDelete,
  onOpenImportModal,
}) => {
  const [formData, setFormData] = useState<McpServerItem>(server);
  const [commandText, setCommandText] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const feedback = useWriteFeedback();

  useEffect(() => {
    setFormData(server);
    setCommandText(server.commandArgs.join('\n'));
    setConfirmDelete(false);
  }, [server]);

  /**
   * A server is reachable by a command or a link, and neither may be blank: an
   * empty command writes a config entry omp connects to and fails, which reads
   * as "the server is broken" rather than "the form was empty".
   */
  const validationError = (() => {
    if (!formData.name.trim()) return 'A server needs a name — omp keys its config by it.';
    if (formData.reachType === 'command' && parseCommandArgs(commandText).length === 0) {
      return 'Paste the command that starts the server, one argument per line.';
    }
    if (formData.reachType === 'link' && !(formData.linkUrl ?? '').trim()) {
      return 'Paste the server’s MCP endpoint URL.';
    }
    return null;
  })();

  const handleSave = (e: FormEvent) => {
    e.preventDefault();
    if (validationError || feedback.saving) return;
    const updated: McpServerItem = {
      ...formData,
      name: formData.name.trim(),
      commandArgs: parseCommandArgs(commandText),
    };
    void feedback.run(() => onSave(updated));
  };

  const handleDelete = () => {
    if (!onDelete) return;
    void feedback.run(async () => {
      const outcome = await onDelete(formData.id);
      if (!outcome.ok) setConfirmDelete(false);
      return outcome;
    });
  };

  const handleAddEnvVar = () => {
    const newEnv: McpEnvVar = {
      id: `env-${Date.now()}`,
      key: '',
      value: '',
    };
    setFormData((prev) => ({
      ...prev,
      envVars: [...prev.envVars, newEnv],
    }));
  };

  const handleUpdateEnvVar = (id: string, key: string, value: string) => {
    setFormData((prev) => ({
      ...prev,
      envVars: prev.envVars.map((ev) => (ev.id === id ? { ...ev, key, value } : ev)),
    }));
  };

  const handleRemoveEnvVar = (id: string) => {
    setFormData((prev) => ({
      ...prev,
      envVars: prev.envVars.filter((ev) => ev.id !== id),
    }));
  };

  const serverForTest: McpServerItem = {
    ...formData,
    commandArgs: parseCommandArgs(commandText),
  };

  return (
    <form onSubmit={handleSave} className="flex-1 flex flex-col h-full scrollbar-overlay-container bg-paper text-ink p-6 md:p-8 space-y-6">
      {/* Header & Title */}
      <div className="flex items-center justify-between pb-4 border-b border-ink/10">
        <div>
          <h2 className="text-sm font-bold tracking-tight text-ink">
            {isNew ? 'Configure a new MCP server' : `Edit MCP Server: ${formData.name}`}
          </h2>
        </div>

        <button
          type="button"
          onClick={onOpenImportModal}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-ink/20 hover:border-ink/40 hover:bg-ink/5 transition-colors cursor-pointer"
        >
          <Code className="w-3.5 h-3.5 text-ink/70" />
          <span>Import from JSON snippet</span>
        </button>
      </div>

      {/* Basic Settings: Name & Scope */}
      <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-ink/80 mb-1.5">
              Server Name
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.currentTarget.value })}
              required
              placeholder="new-mcp-server"
              className="w-full text-xs font-mono px-3 py-2 rounded-lg border border-ink/20 hover:border-ink/40 bg-paper focus:outline-none focus:border-ink text-ink transition-colors"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-ink/80 mb-1.5">
              Scope
            </label>
            <select
              value={formData.scope}
              onChange={(e) => setFormData({ ...formData, scope: e.currentTarget.value as McpScope })}
              className="w-full text-xs py-2 px-3 rounded-lg border border-ink/20 hover:border-ink/40 bg-paper focus:outline-none focus:border-ink cursor-pointer text-ink transition-colors"
            >
              <option value="every-project">Available in every project</option>
              <option value="this-project">This project only</option>
            </select>
          </div>
        </div>

        {/* Enable Server Checkbox */}
        <div className="flex items-center gap-2 pt-1">
          <input
            type="checkbox"
            id="enable-mcp"
            checked={formData.enabled}
            onChange={(e) => setFormData({ ...formData, enabled: e.currentTarget.checked })}
            className={`${CHECKBOX_CLASS} w-4 h-4 cursor-pointer`}
          />
          <label htmlFor="enable-mcp" className="text-xs font-medium text-ink cursor-pointer select-none">
            Enable Server
          </label>
        </div>
      </div>

      <div className="border-t border-ink/10" />

      {/* SECTION: How to reach it */}
      <div className="space-y-3">
        <div>
          <h3 className="text-xs font-bold uppercase tracking-wider text-ink">
            How to reach it
          </h3>
          <p className="text-[11px] text-ink/60 mt-0.5">
            Paste the command that starts it, or the link to a hosted server.
          </p>
        </div>

        {/* Segmented Reach Type Buttons */}
        <div className="inline-flex rounded-lg border border-ink/20 p-0.5 bg-ink/5">
          <button
            type="button"
            onClick={() => setFormData({ ...formData, reachType: 'command' })}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
              formData.reachType === 'command'
                ? 'bg-paper text-ink shadow-2xs font-semibold'
                : 'text-ink/60 hover:text-ink'
            }`}
          >
            <Terminal className="w-3.5 h-3.5" />
            Command
          </button>
          <button
            type="button"
            onClick={() => setFormData({ ...formData, reachType: 'link' })}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
              formData.reachType === 'link'
                ? 'bg-paper text-ink shadow-2xs font-semibold'
                : 'text-ink/60 hover:text-ink'
            }`}
          >
            <Globe className="w-3.5 h-3.5" />
            Link
          </button>
        </div>

        {formData.reachType === 'command' ? (
          <div>
            <textarea
              value={commandText}
              onChange={(e) => setCommandText(e.currentTarget.value)}
              rows={4}
              placeholder={`bunx\n@modelcontextprotocol/server-postgres\npostgresql://user:pass@host/db`}
              className="w-full text-xs font-mono p-3 rounded-lg border border-ink/20 hover:border-ink/40 bg-ink/5 focus:outline-none focus:border-ink resize-none leading-relaxed text-ink transition-colors"
            />
            <p className="text-[11px] text-ink/50 mt-1">
              Runs on this machine. Paste a whole command and it is split into one argument per line.
            </p>
          </div>
        ) : (
          <div>
            <input
              type="url"
              value={formData.linkUrl || ''}
              onChange={(e) => setFormData({ ...formData, linkUrl: e.currentTarget.value })}
              placeholder="https://needmcp.com/mcp"
              className="w-full text-xs font-mono px-3 py-2 rounded-lg border border-ink/20 hover:border-ink/40 bg-ink/5 focus:outline-none focus:border-ink text-ink transition-colors"
            />
            <p className="text-[11px] text-ink/50 mt-1">
              Connect to a hosted MCP SSE or HTTP endpoint.
            </p>
          </div>
        )}
      </div>

      <div className="border-t border-ink/10" />

      {/* SECTION: Environment Variables */}
      <McpEnvVarsSection
        envVars={formData.envVars}
        onAdd={handleAddEnvVar}
        onUpdate={handleUpdateEnvVar}
        onRemove={handleRemoveEnvVar}
      />

      {validationError && (
        <div className="rounded-lg border border-error/30 bg-error/5 px-3 py-2 text-[11px] text-error">
          {validationError}
        </div>
      )}

      {feedback.error && (
        <div className="flex items-start gap-1.5 rounded-lg border border-error/30 bg-error/5 px-3 py-2 text-[11px] text-error">
          <AlertCircle className="mt-px h-3.5 w-3.5 flex-shrink-0" />
          <span className="flex-1 break-words">{feedback.error}</span>
          <button type="button" onClick={feedback.dismissError} className="cursor-pointer text-error/60 hover:text-error" aria-label="Dismiss error">
            ×
          </button>
        </div>
      )}

      {/* Footer Controls */}
      <div className="pt-3 border-t border-ink/10 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {!isNew && onDelete && (
            confirmDelete ? (
              <>
                <span className="text-[11px] text-ink/70">Delete “{formData.name}”?</span>
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={feedback.saving}
                  className="px-2.5 py-1 rounded-lg border border-error/40 text-error text-xs font-medium hover:bg-error/10 transition-colors cursor-pointer disabled:opacity-50"
                >
                  Delete
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  className="px-2 py-1 text-xs text-ink/50 hover:text-ink cursor-pointer"
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-ink/20 hover:border-error hover:text-error text-ink/70 text-xs font-medium transition-colors cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Delete
              </button>
            )
          )}

          <ConnectionTest server={serverForTest} />
        </div>

        <div className="flex items-center gap-3">
          {feedback.saved && (
            <span className="flex items-center gap-1 text-xs text-ink font-medium">
              <Check className="w-3.5 h-3.5" />
              Saved
            </span>
          )}
          <button
            type="submit"
            disabled={feedback.saving || Boolean(validationError)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-ink text-paper text-xs font-medium hover:bg-ink/90 transition-colors shadow-xs cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {feedback.saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            {isNew ? 'Create Server' : 'Save Changes'}
          </button>
        </div>
      </div>
    </form>
  );
};
