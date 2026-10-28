/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The fake host's LIST-slot registrar.
 *
 * A plugin's own tests need the registrations the host would have accepted,
 * keyed the way the host keys them, with the host's own refusals — otherwise a
 * test passes against a registrar that never validates and the plugin ships
 * broken.
 *
 * A TABLE, not a method per slot: the twelve registrations differ only in which
 * array they write to and which key is globally unique, and a chain of
 * near-identical blocks is where the next slot gets added to the interface and
 * forgotten here (the failure is a type error at best, and a silently missing
 * slot at worst — a test asserting on rows that were never recorded).
 */

import type {
  CommandPaletteRegistration,
  ComposerActionRegistration,
  ComposerBannerRegistration,
  ContentScriptRegistration,
  DiffRendererRegistration,
  FileOpenerRegistration,
  KeyedRegistration,
  ListSlotName,
  MessageActionRegistration,
  MessageDirectiveRegistration,
  PendingInteractionRegistration,
  PluginListSlots,
  ProviderIconRegistration,
  SourceCodeRendererRegistration,
  TimelineRendererRegistration,
} from '../slots';
import { GLOBALLY_KEYED_SLOTS } from '../slots';

/**
 * The list slots' rows, one array each, in registration order.
 *
 * One key per slot rather than one map, because the host's store keys a row by
 * `pluginId\0slot\0id` and a test asserts on ONE plugin's rows: an array is what
 * a disposer's splice and an `order` assertion both read naturally.
 */
export interface FakeListRegistrations {
  messageActions: MessageActionRegistration[];
  commandPaletteActions: CommandPaletteRegistration[];
  fileOpeners: FileOpenerRegistration[];
  sourceCodeRenderers: SourceCodeRendererRegistration[];
  diffRenderers: DiffRendererRegistration[];
  timelineRenderers: TimelineRendererRegistration[];
  composerActions: ComposerActionRegistration[];
  composerBanners: ComposerBannerRegistration[];
  providerIcons: ProviderIconRegistration[];
  pendingInteractions: PendingInteractionRegistration[];
  messageDirectives: MessageDirectiveRegistration[];
  contentScripts: ContentScriptRegistration[];
}

export function emptyListRegistrations(): FakeListRegistrations {
  return {
    messageActions: [],
    commandPaletteActions: [],
    fileOpeners: [],
    sourceCodeRenderers: [],
    diffRenderers: [],
    timelineRenderers: [],
    composerActions: [],
    composerBanners: [],
    providerIcons: [],
    pendingInteractions: [],
    messageDirectives: [],
    contentScripts: [],
  };
}

/** `ListSlotName` → the array that holds its rows. One row per slot. */
const ARRAY_BY_SLOT: Record<ListSlotName, keyof FakeListRegistrations> = {
  messageAction: 'messageActions',
  commandPaletteAction: 'commandPaletteActions',
  fileOpener: 'fileOpeners',
  sourceCodeRenderer: 'sourceCodeRenderers',
  diffRenderer: 'diffRenderers',
  timelineRenderer: 'timelineRenderers',
  composerAction: 'composerActions',
  composerBanner: 'composerBanners',
  providerIcon: 'providerIcons',
  pendingInteraction: 'pendingInteractions',
  messageDirective: 'messageDirectives',
  contentScript: 'contentScripts',
};

/**
 * The store's own refusals, message for message: a registration with no id, a
 * duplicate id within this plugin and slot, and — for a globally-keyed slot —
 * an id another plugin already claimed.
 */
function validateList(
  slot: ListSlotName,
  registration: KeyedRegistration,
  list: readonly KeyedRegistration[],
  globallyKeyed: readonly KeyedRegistration[],
): void {
  if (!registration || typeof registration.id !== 'string' || !registration.id) {
    throw new Error(`${slot} registration needs a non-empty id`);
  }
  if (list.some((entry) => entry.id === registration.id)) {
    throw new Error(`${slot} "${registration.id}" is already registered by this plugin`);
  }
  if (GLOBALLY_KEYED_SLOTS.includes(slot) && globallyKeyed.some((entry) => entry.id === registration.id)) {
    throw new Error(`${slot} "${registration.id}" is already claimed by another plugin`);
  }
}

/** Take back exactly the row this disposer was handed, leaving its neighbours. */
function removeListed<T extends KeyedRegistration>(list: T[], registration: T): () => void {
  return () => {
    const index = list.indexOf(registration);
    if (index >= 0) list.splice(index, 1);
  };
}

/**
 * Build the twelve keyed registrars over the harness's CURRENT state.
 *
 * `registrations` is read through a function rather than handed in as an object
 * so the registrar always writes where the harness reads: `harness.setup` swaps
 * in a fresh state per attempt, and the `host` a caller may use directly must
 * keep writing into the live one.
 */
export function createListRegistrar(registrations: () => FakeListRegistrations): PluginListSlots {
  /** Register one row, with the two duplicate rules the host's store applies. */
  const register = <T extends KeyedRegistration>(slot: ListSlotName, registration: T): (() => void) => {
    const state = registrations();
    const list = state[ARRAY_BY_SLOT[slot]] as unknown as T[];
    // A globally-keyed slot's cross-plugin view: the host refuses the second
    // claim, and a fake that allowed it would let a plugin ship a fence name it
    // can never own.
    const elsewhere =
      GLOBALLY_KEYED_SLOTS.includes(slot)
        ? (Object.values(state).flat() as KeyedRegistration[]).filter((entry) => entry.id === registration.id)
        : [];
    validateList(slot, registration, list, elsewhere);
    list.push(registration);
    return removeListed(list, registration);
  };

  return {
    messageAction: (registration) => register('messageAction', registration),
    commandPaletteAction: (registration) => register('commandPaletteAction', registration),
    fileOpener: (registration) => register('fileOpener', registration),
    sourceCodeRenderer: (registration) => register('sourceCodeRenderer', registration),
    diffRenderer: (registration) => register('diffRenderer', registration),
    timelineRenderer: (registration) => register('timelineRenderer', registration),
    composerAction: (registration) => register('composerAction', registration),
    composerBanner: (registration) => register('composerBanner', registration),
    experimental_providerIcon: (registration) => register('providerIcon', registration),
    pendingInteraction: (registration) => register('pendingInteraction', registration),
    messageDirective: (registration) => register('messageDirective', registration),
    contentScript: (registration) => register('contentScript', registration),
  };
}
