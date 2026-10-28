/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The editor column taken over by a plugin.
 *
 * There is no tab strip in this mode and no file: the plugin owns the whole surface, the
 * way a right-panel view does, and the layout's own toggle is what gives the column back.
 * `PluginIdProvider` is what lets the plugin's own components resolve their registration.
 */

import type { ComponentType } from 'preact/compat';
import { PluginIdProvider } from '@kabmo-labs/kabmo-ui';

interface PluginColumnProps {
  pluginId: string;
  Component: ComponentType<{ sessionId: string | null; workspacePath: string | null }>;
  sessionId: string | null;
  className?: string;
}

export function PluginColumn({ pluginId, Component, sessionId, className = '' }: PluginColumnProps) {
  return (
    <div className={`flex flex-col h-full bg-canvas ${className}`}>
      <PluginIdProvider pluginId={pluginId}>
        <Component sessionId={sessionId} workspacePath={null} />
      </PluginIdProvider>
    </div>
  );
}
