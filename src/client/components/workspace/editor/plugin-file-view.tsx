/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The editor's bridge to the three viewer slots: `fileOpener`,
 * `sourceCodeRenderer` and `diffRenderer`.
 *
 * A plugin that contributes one of these replaces a built-in viewer for the
 * files it claims, so the host has to decide WHICH one — and the decision is a
 * priority, not a merge. An opener is asked first because its `matches` is the
 * plugin's own judgement: an extension list cannot say "a `.md` that opens with
 * frontmatter", and a plugin that needs that should not have to register a
 * wildcard and refuse at render time.
 *
 * The resolution is returned as a discriminated union rather than a
 * `{ Component, props }` pair the host spreads through a cast: the two view
 * kinds are handed DIFFERENT props (`sourceCodeRenderer` gets the file's text,
 * `fileOpener` its own read), and the union is what lets `PluginFileViewBody`
 * spread each one without a lie.
 *
 * Every path here returns null when no row matches. That is the property that
 * keeps a Kabmo with no plugins rendering exactly what it did before these
 * slots existed — the hosts only ever draw a contributed view when this module
 * says one was contributed.
 */

import type { ComponentChildren, ComponentType } from 'preact';
import type {
  DiffRendererProps,
  DiffRendererRegistration,
  FileOpenerProps,
  FileOpenerRegistration,
  SourceCodeRendererProps,
  SourceCodeRendererRegistration,
} from '@kabmo-labs/kabmo-sdk';
import { useListSlotRows, usePluginSlotContext } from '@/client/hooks/workspace/list-slots';
import { PluginIdProvider } from '@kabmo-labs/kabmo-ui';

/** What a non-diff file carries into resolution. */
export interface PluginFileViewFile {
  path: string;
  /** The file's text, already read by the host. */
  content: string;
  /** The host's own language id for the path, when it resolved one. */
  language?: string;
  /**
   * The lowercased `'.ext'` suffix, or `''`. Derived from `path` when omitted,
   * so the rule lives here and a caller that already knows it may pass it.
   */
  extension?: string;
}

/** A resolved contributed view: the component, its plugin, and its props. */
export type ResolvedPluginFileView =
  | { kind: 'opener'; pluginId: string; Component: ComponentType<FileOpenerProps>; props: FileOpenerProps }
  | { kind: 'source'; pluginId: string; Component: ComponentType<SourceCodeRendererProps>; props: SourceCodeRendererProps };

/** A resolved diff view: one props shape, so no union is needed. */
export interface ResolvedPluginDiffView {
  pluginId: string;
  Component: ComponentType<DiffRendererProps>;
  props: DiffRendererProps;
}

/**
 * The lowercased `'.ext'` suffix of a path, or `''` when it names none.
 *
 * `> 0` keeps a dotfile (`.gitignore`) extensionless rather than reading its
 * whole name as an extension; the length check keeps a trailing dot (`Makefile.`)
 * from becoming the extension `'.'`.
 */
function extensionOfPath(path: string): string {
  const name = path.split('/').pop() ?? '';
  const dot = name.lastIndexOf('.');
  return dot > 0 && dot < name.length - 1 ? name.slice(dot).toLowerCase() : '';
}

/** The contributed view for a NON-diff file, or null when none claims it. */
export function usePluginFileView(file: PluginFileViewFile): ResolvedPluginFileView | null {
  const openers = useListSlotRows<FileOpenerRegistration>('fileOpener');
  const renderers = useListSlotRows<SourceCodeRendererRegistration>('sourceCodeRenderer');
  const context = usePluginSlotContext();
  const extension = file.extension ?? extensionOfPath(file.path);

  const opener = openers.find((row) => row.registration.matches({ path: file.path, extension }));
  if (opener) {
    return {
      kind: 'opener',
      pluginId: opener.pluginId,
      Component: opener.registration.component,
      props: { ...context, path: file.path, extension },
    };
  }

  const renderer = renderers.find((row) => row.registration.extensions.includes(extension));
  if (renderer) {
    return {
      kind: 'source',
      pluginId: renderer.pluginId,
      Component: renderer.registration.component,
      props: { ...context, path: file.path, content: file.content, language: file.language },
    };
  }

  return null;
}

/**
 * The contributed view for a diff tab, or null when none claims the file.
 *
 * A `diffRenderer` with no `extensions` applies to every diff; one that lists
 * them claims only those, so a plugin can render just the file types it knows.
 */
export function usePluginDiffView(file: { path: string; diff: string }): ResolvedPluginDiffView | null {
  const renderers = useListSlotRows<DiffRendererRegistration>('diffRenderer');
  const context = usePluginSlotContext();
  const extension = extensionOfPath(file.path);
  const renderer = renderers.find((row) => {
    const claimed = row.registration.extensions;
    return claimed === undefined || claimed.includes(extension);
  });
  if (!renderer) return null;
  return {
    pluginId: renderer.pluginId,
    Component: renderer.registration.component,
    props: { ...context, path: file.path, diff: file.diff },
  };
}

/**
 * Draw a resolution.
 *
 * A component, not an inline spread at each host, because the union's two
 * branches carry different props: each branch reads `Component` and `props`
 * together so TypeScript keeps them correlated, which one spread of the union
 * would lose.
 *
 * The wrapper is the plugin's SURFACE, not decoration: the plugin's stylesheet
 * is scoped to `[data-plugin-surface="<id>"]`, so a view drawn outside it would
 * have no CSS of its own.
 */
export function PluginFileViewBody({ view }: { view: ResolvedPluginFileView }): ComponentChildren {
  if (view.kind === 'opener') {
    const Opener = view.Component;
    return (
      <PluginIdProvider pluginId={view.pluginId}>
        <Opener {...view.props} />
      </PluginIdProvider>
    );
  }
  const Source = view.Component;
  return (
    <PluginIdProvider pluginId={view.pluginId}>
      <Source {...view.props} />
    </PluginIdProvider>
  );
}
