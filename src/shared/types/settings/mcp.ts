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
