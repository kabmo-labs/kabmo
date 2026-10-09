/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The contribution slots beyond the four positional ones.
 *
 * A separate module from `./app` because these are a DIFFERENT KIND of
 * registration, and the difference is the whole design:
 *
 * - A positional slot (`rightPanel`, `panel`, `headerPanel`, `settingsSection`)
 *   is one of something. The layout has one activity-bar button, one navbar
 *   entry and one editor column, so a second registration could never be
 *   reached — `./app` refuses it rather than letting it be a silent overwrite.
 * - A LIST slot is a row among rows. A chat row's action strip, the composer's
 *   command pool, a file opener — each is a list the host renders in order, so a
 *   plugin may contribute several and a second plugin's contribution sits
 *   beside the first's.
 *
 * Every list slot therefore takes a keyed registration and returns a DISPOSER.
 * The key is what makes the list addressable: the host can remove one row
 * without touching its neighbours, which is what a plugin reload needs, and a
 * duplicate key is refused rather than replacing what was there.
 */

import type { ComponentType } from 'preact';

/**
 * Props every list-slot component receives.
 *
 * Deliberately minimal and additive: a slot's own context (the message a
 * `messageAction` acts on, the file a `fileOpener` matched) is declared by the
 * slot's own props type below, so this is only what EVERY one of them knows.
 */
export interface SlotContextProps {
  /** The active session id, or null. */
  sessionId: string | null;
  /** The active workspace root, or null. */
  workspacePath: string | null;
}

/** A registration's identity within its slot: unique per plugin, stable across reloads. */
export interface KeyedRegistration {
  /** Unique within this plugin and this slot. A duplicate is refused. */
  id: string;
  /** Human label, for a tooltip, a menu row or a settings list. */
  title?: string;
  /** Sort key within the slot; lower first. Absent means 0. */
  order?: number;
}

// ---------------------------------------------------------------------------
// Chat row actions
// ---------------------------------------------------------------------------

/** What a `messageAction` is given about the row it sits on. */
export interface MessageActionProps extends SlotContextProps {
  /** The row's id, as the timeline holds it. */
  messageId: string;
  /** The row's role as the timeline spells it. */
  role: string;
  /** Every text block of the row, joined — what a Copy-like action would take. */
  text: string;
}

/** A button in a chat row's action strip. */
export interface MessageActionRegistration extends KeyedRegistration {
  component: ComponentType<MessageActionProps>;
}

// ---------------------------------------------------------------------------
// Composer commands
// ---------------------------------------------------------------------------

/** What a `commandPaletteAction` may do when the user picks it. */
export interface CommandActionContext extends SlotContextProps {
  /** Whatever the user typed after the command name, trimmed. */
  args: string;
}

/** One row in the composer's `/` popup. */
export interface CommandPaletteRegistration extends KeyedRegistration {
  /** The token a user types after `/`. Must be a bare word. */
  command: string;
  description: string;
  /** The usage hint the popup shows, e.g. `[question]`. */
  hint?: string;
  run: (context: CommandActionContext) => void | Promise<void>;
}

// ---------------------------------------------------------------------------
// File openers
// ---------------------------------------------------------------------------

/** What a `fileOpener` is given about the file it was offered. */
export interface FileOpenerProps extends SlotContextProps {
  /** The file's path, relative to the active workspace root. */
  path: string;
  /** The lowercased extension, with the dot (`'.png'`), or `''`. */
  extension: string;
}

/**
 * One opener.
 *
 * `matches` decides whether this opener is offered for a file, and it is a
 * FUNCTION rather than an extension list because the decision is genuinely the
 * plugin's: an extension list cannot express "a `.md` that starts with
 * frontmatter", and a plugin that wants that should not have to register a
 * wildcard and refuse at render time.
 */
export interface FileOpenerRegistration extends KeyedRegistration {
  /** Whether this opener handles `path`. Called with the same info the props carry. */
  matches: (file: { path: string; extension: string }) => boolean;
  component: ComponentType<FileOpenerProps>;
}

// ---------------------------------------------------------------------------
// Renderers that replace a built-in viewer
// ---------------------------------------------------------------------------

/** What a `sourceCodeRenderer` is given. */
export interface SourceCodeRendererProps extends SlotContextProps {
  /** The file's path, for the plugin's own language detection. */
  path: string;
  /** The file's contents, already read by the host. */
  content: string;
  /** The host's own language id for the path, when it resolved one. */
  language?: string;
}

/** A plugin's replacement for the editor's read-only code view. */
export interface SourceCodeRendererRegistration extends KeyedRegistration {
  /** The lowercased extensions this renderer claims, each with its dot. */
  extensions: readonly string[];
  component: ComponentType<SourceCodeRendererProps>;
}

/** What a `diffRenderer` is given. */
export interface DiffRendererProps extends SlotContextProps {
  path: string;
  /** The unified diff text, exactly as git produced it. */
  diff: string;
}

/** A plugin's replacement for the diff viewer. */
export interface DiffRendererRegistration extends KeyedRegistration {
  extensions?: readonly string[];
  component: ComponentType<DiffRendererProps>;
}

// ---------------------------------------------------------------------------
// Tool-call renderers
// ---------------------------------------------------------------------------

/** What a `timelineRenderer` is given about one tool call. */
export interface TimelineRendererProps extends SlotContextProps {
  /** The tool's name, as the agent called it. */
  toolName: string;
  /** The call's arguments, as JSON — the shape omp reported. */
  args: unknown;
  /** The call's output text, when it has one. */
  output?: string;
}

/**
 * A plugin's renderer for a tool call.
 *
 * The host keeps its own renderer for a tool it knows; this is for a tool it
 * does not, which is what a plugin shipping its own agent tool needs. `tool`
 * is matched exactly, so two plugins cannot both claim `bash` — the second
 * registration is refused rather than shadowing the first.
 */
export interface TimelineRendererRegistration extends KeyedRegistration {
  /** The tool name this renderer draws. Matched exactly. */
  tool: string;
  component: ComponentType<TimelineRendererProps>;
}

// ---------------------------------------------------------------------------
// Composer customization
// ---------------------------------------------------------------------------

/** What a composer action is given. */
export interface ComposerActionProps extends SlotContextProps {
  /** The draft as it stands, read at render time. */
  text: string;
  /** Whether a run is in flight, so a send-like action can disable itself. */
  isSubmitting: boolean;
}

/** A button in the composer's toolbar. */
export interface ComposerActionRegistration extends KeyedRegistration {
  component: ComponentType<ComposerActionProps>;
}

/** A strip above the composer's input. */
export interface ComposerBannerRegistration extends KeyedRegistration {
  component: ComponentType<SlotContextProps>;
}

// ---------------------------------------------------------------------------
// The registrar
// ---------------------------------------------------------------------------

/**
 * The list slots, and the one method per slot.
 *
 * Every method returns the disposer for the registration it just made, so a
 * plugin can take one back without reloading. A duplicate `id` within the same
 * plugin and slot THROWS — the same rule the positional slots follow, for the
 * same reason: a plugin that registers the same key twice is broken, and a
 * quiet replace would make the first registration unreachable with nothing on
 * screen to say so.
 */
export interface PluginListSlots {
  messageAction(registration: MessageActionRegistration): () => void;
  commandPaletteAction(registration: CommandPaletteRegistration): () => void;
  fileOpener(registration: FileOpenerRegistration): () => void;
  sourceCodeRenderer(registration: SourceCodeRendererRegistration): () => void;
  diffRenderer(registration: DiffRendererRegistration): () => void;
  timelineRenderer(registration: TimelineRendererRegistration): () => void;
  composerAction(registration: ComposerActionRegistration): () => void;
  composerBanner(registration: ComposerBannerRegistration): () => void;
}

/** Every list slot's name, so a store can be built from one list. */
export const LIST_SLOT_NAMES = [
  'messageAction',
  'commandPaletteAction',
  'fileOpener',
  'sourceCodeRenderer',
  'diffRenderer',
  'timelineRenderer',
  'composerAction',
  'composerBanner',
] as const;

export type ListSlotName = (typeof LIST_SLOT_NAMES)[number];
