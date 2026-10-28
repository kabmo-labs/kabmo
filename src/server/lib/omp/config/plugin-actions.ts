/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Plugin mutations — one thin wrapper per `omp plugin` verb the Plugins panel
 * offers. Every call is scoped by its cwd: `omp plugin` reads the PROJECT
 * registry of the directory it runs in, so a workspace-scoped action must run
 * in that workspace and a user-scoped one in `$HOME` (which is not a project
 * anchor, so no project registry is consulted).
 */

import { INSTALL_TIMEOUT_MS, MUTATE_TIMEOUT_MS, runPluginCli, type PluginCommandResult } from '@/server/lib/omp/config/plugin-cli';
import type { PluginScope } from '@/shared/types';

function scopeArgs(scope: PluginScope | undefined): string[] {
  return scope ? ['--scope', scope] : [];
}

export function installPlugin(spec: string, cwd: string, scope?: PluginScope): Promise<PluginCommandResult> {
  return runPluginCli(['install', spec, ...scopeArgs(scope)], cwd, INSTALL_TIMEOUT_MS);
}

export function uninstallPlugin(id: string, cwd: string, scope?: PluginScope): Promise<PluginCommandResult> {
  return runPluginCli(['uninstall', id, ...scopeArgs(scope)], cwd, MUTATE_TIMEOUT_MS);
}

export function setPluginEnabled(
  id: string,
  enabled: boolean,
  cwd: string,
  scope?: PluginScope,
): Promise<PluginCommandResult> {
  return runPluginCli([enabled ? 'enable' : 'disable', id, ...scopeArgs(scope)], cwd, MUTATE_TIMEOUT_MS);
}

export function upgradePlugins(id: string | null, cwd: string, scope?: PluginScope): Promise<PluginCommandResult> {
  const args = ['upgrade'];
  if (id) args.push(id, ...scopeArgs(scope));
  return runPluginCli(args, cwd, INSTALL_TIMEOUT_MS);
}

/**
 * Replace a plugin's feature selection.
 *
 * `--set` REPLACES the list outright, which is the only shape that can express
 * "no optional features" — `--enable`/`--disable` can only add and remove, so a
 * plugin that started with features enabled could never be returned to omp's
 * defaults. The pane sends the full selection it rendered.
 */
export function setPluginFeatures(packageName: string, features: string[], cwd: string): Promise<PluginCommandResult> {
  return runPluginCli(['features', packageName, '--set', features.join(',')], cwd, MUTATE_TIMEOUT_MS);
}

export function setPluginSetting(
  packageName: string,
  key: string,
  value: string,
  cwd: string,
): Promise<PluginCommandResult> {
  return runPluginCli(['config', 'set', packageName, key, value], cwd, MUTATE_TIMEOUT_MS);
}

export function deletePluginSetting(
  packageName: string,
  key: string,
  cwd: string,
): Promise<PluginCommandResult> {
  return runPluginCli(['config', 'delete', packageName, key], cwd, MUTATE_TIMEOUT_MS);
}

export function addMarketplace(source: string, cwd: string): Promise<PluginCommandResult> {
  return runPluginCli(['marketplace', 'add', source], cwd, INSTALL_TIMEOUT_MS);
}

export function removeMarketplace(name: string, cwd: string): Promise<PluginCommandResult> {
  return runPluginCli(['marketplace', 'remove', name], cwd, MUTATE_TIMEOUT_MS);
}

export function updateMarketplaces(name: string | null, cwd: string): Promise<PluginCommandResult> {
  return runPluginCli(name ? ['marketplace', 'update', name] : ['marketplace', 'update'], cwd, INSTALL_TIMEOUT_MS);
}

export function runPluginDoctor(cwd: string): Promise<PluginCommandResult> {
  return runPluginCli(['doctor', '--json'], cwd, MUTATE_TIMEOUT_MS);
}
