/** The three transports omp's `mcp.json` schema accepts. */
export type McpTransport = 'stdio' | 'http' | 'sse';
export type McpScope = 'every-project' | 'this-project';

/** One key/value row: an env var, an HTTP header, or an OAuth field. */
export interface McpKeyValue {
  id: string;
  key: string;
  value: string;
}

/** omp's `auth` block: the credential strategy for a remote server. */
export interface McpAuthConfig {
  type: 'oauth' | 'apikey';
  credentialId?: string;
  tokenUrl?: string;
  clientId?: string;
  clientSecret?: string;
  resource?: string;
}

/** omp's `oauth` block: explicit OAuth client settings for `/mcp reauth`. */
export interface McpOAuthConfig {
  clientId?: string;
  clientSecret?: string;
  scope?: string;
  redirectUri?: string;
  callbackPort?: number;
  callbackPath?: string;
  prompt?: string;
}

export interface McpServerItem {
  id: string;
  name: string;
  scope: McpScope;
  /** Absolute omp project root — meaningful only when scope is 'this-project'. */
  projectPath?: string;
  enabled: boolean;
  transport: McpTransport;
  commandArgs: string[];
  linkUrl?: string;
  envVars: McpKeyValue[];
  /** HTTP/SSE request headers. */
  headers: McpKeyValue[];
  /** Working directory for a stdio server. */
  cwd?: string;
  /** Per-request timeout in milliseconds; 0 disables client-side timeouts. */
  timeout?: number;
  requestIdFormat?: 'string' | 'number';
  /** Include the server's own instructions in the system prompt. */
  instructions?: boolean;
  auth?: McpAuthConfig;
  oauth?: McpOAuthConfig;
  status?: 'active' | 'inactive' | 'error';
}

/** Where a session's server was declared. */
export type McpServerSource = 'user' | 'project' | 'custom' | 'plugin';

/** The answer of a real MCP handshake, cached for a minute server-side. */
export interface McpProbeResult {
  ok: boolean;
  error?: string;
  toolCount: number;
  durationMs: number;
  /** Epoch ms of the handshake, so the UI can say how old the answer is. */
  checkedAt: number;
}

/** One server as a SESSION sees it, with that session's override applied. */
export interface SessionMcpServer {
  name: string;
  transport: McpTransport;
  source: McpServerSource;
  enabled: boolean;
  /** The last handshake, or null when this server was never probed. */
  probe: McpProbeResult | null;
}

/** `GET /api/sessions/:sessionId/mcp` — the list and the switch behind it. */
export interface SessionMcpPayload {
  sessionId: string;
  harness: string | null;
  /** How this harness receives MCP: a handshake argument or omp's config file. */
  delivery: 'acp' | 'omp-config' | null;
  live: boolean;
  servers: SessionMcpServer[];
  /** Only the names that differ from the configured state. */
  overrides: Record<string, boolean>;
}
