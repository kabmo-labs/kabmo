import { useEffect, useState } from 'preact/hooks';
import type { FormEvent, FunctionComponent } from 'preact/compat';
import { Check, Code, Globe, Plus, Terminal, Trash2 } from 'lucide-preact';
import type { McpEnvVar, McpScope, McpServerItem } from '@/shared/types';
import { ConnectionTest } from '@/client/components/settings/categories/mcp-settings/ConnectionTest';

function parseCommandArgs(text: string): string[] {
  return text.split('\n').map((s) => s.trim()).filter(Boolean);
}

interface McpDetailPaneProps {
  server: McpServerItem;
  isNew?: boolean;
  onSave: (updatedServer: McpServerItem) => void;
  onDelete?: (serverId: string) => void;
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
  const [savedSuccess, setSavedSuccess] = useState(false);

  useEffect(() => {
    setFormData(server);
    setCommandText(server.commandArgs.join('\n'));
    setSavedSuccess(false);
  }, [server]);

  const handleSave = (e: FormEvent) => {
    e.preventDefault();
    const parsedArgs = parseCommandArgs(commandText);

    const updated: McpServerItem = {
      ...formData,
      commandArgs: parsedArgs,
    };

    onSave(updated);
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 2000);
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
            className="w-4 h-4 rounded border-ink/30 text-ink focus:ring-0 cursor-pointer"
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
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-ink">
              Environment Variables
            </h3>
            <p className="text-[11px] text-ink/60 mt-0.5">
              Values the server needs, such as an API key.
            </p>
          </div>
          <button
            type="button"
            onClick={handleAddEnvVar}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-ink/20 hover:border-ink/40 hover:bg-ink/5 text-ink transition-colors cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add variable</span>
          </button>
        </div>

        {formData.envVars.length === 0 ? (
          <div className="p-4 rounded-lg border border-dashed border-ink/20 text-center text-xs text-ink/50">
            No environment variables configured.
          </div>
        ) : (
          <div className="space-y-2">
            {formData.envVars.map((env) => (
              <div key={env.id} className="flex items-center gap-2">
                <input
                  type="text"
                  value={env.key}
                  onChange={(e) => handleUpdateEnvVar(env.id, e.currentTarget.value, env.value)}
                  placeholder="KEY"
                  className="w-1/3 text-xs font-mono px-3 py-1.5 rounded-lg border border-ink/20 hover:border-ink/40 bg-paper focus:outline-none focus:border-ink text-ink transition-colors"
                />
                <input
                  type="text"
                  value={env.value}
                  onChange={(e) => handleUpdateEnvVar(env.id, env.key, e.currentTarget.value)}
                  placeholder="VALUE"
                  className="flex-1 text-xs font-mono px-3 py-1.5 rounded-lg border border-ink/20 hover:border-ink/40 bg-paper focus:outline-none focus:border-ink text-ink transition-colors"
                />
                <button
                  type="button"
                  onClick={() => handleRemoveEnvVar(env.id)}
                  className="p-1.5 text-ink/40 hover:text-error transition-colors rounded-md cursor-pointer"
                  title="Remove variable"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer Controls */}
      <div className="pt-3 border-t border-ink/10 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {!isNew && onDelete && (
            <button
              type="button"
              onClick={() => onDelete(formData.id)}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-ink/20 hover:border-error hover:text-error text-ink/70 text-xs font-medium transition-colors cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Delete
            </button>
          )}

          <ConnectionTest server={serverForTest} />
        </div>

        <div className="flex items-center gap-3">
          {savedSuccess && (
            <span className="flex items-center gap-1 text-xs text-ink font-medium">
              <Check className="w-3.5 h-3.5" />
              Saved successfully
            </span>
          )}
          <button
            type="submit"
            className="px-4 py-2 rounded-lg bg-ink text-paper text-xs font-medium hover:bg-ink/90 transition-colors shadow-xs cursor-pointer"
          >
            {isNew ? 'Create Server' : 'Save Changes'}
          </button>
        </div>
      </div>
    </form>
  );
};
