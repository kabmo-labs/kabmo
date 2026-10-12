/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The slots that reach INTO the conversation rather than beside it.
 *
 * Split from `./slots` because these four are a different KIND of contribution
 * from a row among rows, and the difference is what a plugin can do with them:
 *
 * - `providerIcon` supplies a mark, so it is data rather than a component.
 * - `pendingInteraction` answers the agent's own question — the one place a
 *   plugin changes what the agent DOES rather than what it looks like.
 * - `messageDirective` claims a fenced block in an assistant message.
 * - `contentScript` mounts code into the app shell, with no component at all.
 *
 * Kept in the same package and re-exported from the root, so an author imports
 * one name either way.
 */

import type { ComponentType } from 'preact';
import type { KeyedRegistration, SlotContextProps } from './slots';

/**
 * A provider's mark, contributed by a plugin.
 *
 * A REGISTRY rather than a component: every surface that draws a provider logo
 * already resolves it through one function, so a plugin supplies a glyph and
 * the resolution point picks it up. `provider` is matched against the same
 * string the provider reaches the host as — a login provider id
 * (`google-vertex`), a models.yml slug, or a legacy icon key — so the matching
 * folds case and punctuation exactly as the built-in table does.
 *
 * A `glyph` is an SVG source string, and its paint must be `currentColor`: a
 * mark takes the surrounding ink and follows the theme, which is what keeps a
 * dense provider list free of the only chroma in the palette.
 */
export interface ProviderIconRegistration extends KeyedRegistration {
  /** The provider this mark belongs to. */
  provider: string;
  /** SVG source. `currentColor` for paint. */
  glyph: string;
}

// ---------------------------------------------------------------------------
// The agent's own questions
// ---------------------------------------------------------------------------

/** One question omp asked, as a plugin sees it. */
export interface PendingInteractionQuestion {
  id: string;
  question: string;
  options: readonly { label: string; description?: string }[];
  header?: string;
  /** Several options may be selected at once. */
  multi?: boolean;
  /** Index into `options` omp marks as recommended. */
  recommended?: number;
}

/**
 * What a `pendingInteraction` component is given.
 *
 * `submit` and `cancel` are the WHOLE surface, and both go through the same
 * response path a human click uses — a plugin's answer and a user's answer must
 * be the same frame, or the agent receives something omp did not expect.
 */
export interface PendingInteractionProps {
  /** The questions omp is waiting on. */
  questions: readonly PendingInteractionQuestion[];
  /** Whether each question already has an answer recorded. */
  recorded: readonly boolean[];
  /** Answer every question, in the order they were asked. */
  submit: (answers: readonly { id: string; selectedOptions: readonly string[]; customInput?: string }[]) => void;
  /** Decline, leaving the question for a human. */
  cancel: () => void;
}

/** A plugin's renderer for the agent's own question dialog. */
export interface PendingInteractionRegistration extends KeyedRegistration {
  component: ComponentType<PendingInteractionProps>;
}

// ---------------------------------------------------------------------------
// Message directives
// ---------------------------------------------------------------------------

/**
 * What a `messageDirective` component is given.
 *
 * `body` is the fenced block's RAW text. The host does not parse it: a payload
 * shape belongs to the plugin, and a host that guessed would have to own every
 * plugin's schema.
 */
export interface MessageDirectiveProps extends SlotContextProps {
  /** The fence's language token, e.g. `omp:chart`. Matched exactly. */
  name: string;
  /** The fenced block's raw text, exactly as the author wrote it. */
  body: string;
  /** `key="value"` pairs from the fence's info line, if any. */
  attributes: Readonly<Record<string, string>>;
}

/**
 * A plugin's renderer for a fenced block in an assistant message.
 *
 * `name` is matched EXACTLY against the fence's language token, so an
 * unclaimed fence stays an ordinary code block — which is what keeps a
 * plugin-less install rendering raw JSON as code rather than as prose.
 */
export interface MessageDirectiveRegistration extends KeyedRegistration {
  /** The fence token this renderer claims, e.g. `omp:chart`. */
  name: string;
  component: ComponentType<MessageDirectiveProps>;
}

// ---------------------------------------------------------------------------
// Content scripts
// ---------------------------------------------------------------------------

/** What a content script's `mount` is handed. */
export interface ContentScriptContext {
  pluginId: string;
  /**
   * The element this script's DOM belongs in — the plugin's own surface.
   *
   * It carries the plugin's scope attribute
   * ({@link PLUGIN_SURFACE_ATTR}), which is what confines the plugin's
   * stylesheet to its own DOM: the host serves that CSS wrapped in
   * `@scope ([data-plugin-surface="<id>"])`, so a rule reaches an element only
   * when the element is inside a surface carrying the same id.
   *
   * That makes this container the difference between a working stylesheet and a
   * leak. A script that appends to `document.body` instead puts its DOM OUTSIDE
   * every surface, where the plugin's own CSS cannot match it — and the old
   * workaround (marking `<html>` with a scoping attribute) is exactly the leak
   * this replaced, because `<html>` is an ancestor of the host's chrome too.
   *
   * Append here. The host removes the whole subtree on teardown, so a node left
   * inside it needs no removal of its own.
   */
  root: HTMLElement;
  /** Bumped on every reload; a script may use it to key its own DOM. */
  generation: number;
  /** Aborts when this generation is torn down. */
  signal: AbortSignal;
}

/** Bundled code that enhances the app shell without rendering a slot. */
export interface ContentScriptRegistration extends KeyedRegistration {
  /**
   * Mount, returning the disposer that undoes it.
   *
   * The disposer is REQUIRED: the host owns teardown across reload, disable,
   * removal and window teardown, and a script that owns DOM it does not give
   * back leaks it for the life of the page.
   */
  mount: (context: ContentScriptContext) => (() => void) | Promise<() => void>;
}
