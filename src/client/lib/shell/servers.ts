/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The shell's server list, as the console reads and changes it.
 *
 * The same four commands work in all five shells. Two more — `servers_start` and
 * `servers_stop` — exist only where a shell can own a child process (the desktop
 * trio). A phone refuses them, and the panel knows not to offer them from
 * `startable: false` in the state rather than from a user agent.
 *
 * Nothing here decides which shell answered; that is `transport.ts`.
 */

import { callShell } from '@/client/lib/shell/transport';

/** One server in the shell's list, or one found on this machine. */
export interface ShellServer {
  id: string;
  label: string;
  url: string;
  kind: 'remote' | 'managed';
  port?: number;
  running: boolean;
  /** This shell started it (as opposed to a server found on the machine). */
  owned: boolean;
  version?: string;
  mode?: string;
  pid?: number;
  startedAt?: string;
  /** `stored` for the list, `record` for a local instance found on disk. */
  source: 'stored' | 'record';
}

export interface ShellServersState {
  entries: ShellServer[];
  /** Local instances this shell did NOT start — a `kabmo serve`, a dev server. */
  detected: ShellServer[];
  activeId?: string;
  activeUrl?: string;
  /**
   * Whether this shell can start a server of its own. Absent reads as `true`, so
   * the three desktop shells (which all can) need no change; a phone answers
   * `false` and the panel then says nothing about starting one.
   */
  startable?: boolean;
}

export function readServers(): Promise<ShellServersState> {
  return callShell<ShellServersState>('servers_state');
}

export function addRemoteServer(label: string, url: string): Promise<ShellServersState> {
  return callShell<ShellServersState>('servers_add', { label, url });
}

export function removeServer(id: string): Promise<ShellServersState> {
  return callShell<ShellServersState>('servers_remove', { id });
}

/** Point the window at a server. The shell navigates, so this page goes away. */
export function activateServer(id: string): Promise<ShellServersState> {
  return callShell<ShellServersState>('servers_activate', { id });
}

/** Start a local server as the shell's child, then navigate to it. */
export function startLocalServer(port?: number, label?: string): Promise<ShellServersState> {
  return callShell<ShellServersState>('servers_start', { port: port ?? null, label: label ?? null });
}

export function stopLocalServer(id: string): Promise<ShellServersState> {
  return callShell<ShellServersState>('servers_stop', { id });
}
