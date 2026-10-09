/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The fake host's LIST-slot registrar.
 *
 * Split from `./fake-host` for the repo's per-file size ceiling, and because the
 * two halves are different KINDS of registration: `./fake-host` records the four
 * POSITIONAL slots (one of each, a second is refused), while this module records
 * the eight LIST slots (a row among rows, keyed, each returning a disposer).
 *
 * The validation is written from the same rules as the host's own store
 * (`src/client/lib/plugins/list-slots.ts`) — message for message — because this
 * package is published and cannot import the host's source; a plugin author's
 * test must catch what the app would refuse.
 */

import type {
  CommandPaletteRegistration,
  ComposerActionRegistration,
  ComposerBannerRegistration,
  DiffRendererRegistration,
  FileOpenerRegistration,
  KeyedRegistration,
  ListSlotName,
  MessageActionRegistration,
  PluginListSlots,
  SourceCodeRendererRegistration,
  TimelineRendererRegistration,
} from '../slots';

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
  };
}

/**
 * The store's own two refusals, message for message: a registration with no id,
 * and a duplicate id within the same plugin and slot.
 */
function validateList(
  slot: ListSlotName,
  registration: KeyedRegistration,
  list: readonly KeyedRegistration[],
): void {
  if (!registration || typeof registration.id !== 'string' || !registration.id) {
    throw new Error(`${slot} registration needs a non-empty id`);
  }
  if (list.some((entry) => entry.id === registration.id)) {
    throw new Error(`${slot} "${registration.id}" is already registered by this plugin`);
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
 * Build the eight keyed registrars over the harness's CURRENT state.
 *
 * `registrations` is read through a function rather than handed in as an object
 * so the registrar always writes where the harness reads: `harness.setup` swaps
 * in a fresh state per attempt, and the `host` a caller may use directly must
 * keep writing into the live one.
 */
export function createListRegistrar(registrations: () => FakeListRegistrations): PluginListSlots {
  return {
    messageAction: (registration) => {
      const list = registrations().messageActions;
      validateList('messageAction', registration, list);
      list.push(registration);
      return removeListed(list, registration);
    },
    commandPaletteAction: (registration) => {
      const list = registrations().commandPaletteActions;
      validateList('commandPaletteAction', registration, list);
      list.push(registration);
      return removeListed(list, registration);
    },
    fileOpener: (registration) => {
      const list = registrations().fileOpeners;
      validateList('fileOpener', registration, list);
      list.push(registration);
      return removeListed(list, registration);
    },
    sourceCodeRenderer: (registration) => {
      const list = registrations().sourceCodeRenderers;
      validateList('sourceCodeRenderer', registration, list);
      list.push(registration);
      return removeListed(list, registration);
    },
    diffRenderer: (registration) => {
      const list = registrations().diffRenderers;
      validateList('diffRenderer', registration, list);
      list.push(registration);
      return removeListed(list, registration);
    },
    timelineRenderer: (registration) => {
      const list = registrations().timelineRenderers;
      validateList('timelineRenderer', registration, list);
      list.push(registration);
      return removeListed(list, registration);
    },
    composerAction: (registration) => {
      const list = registrations().composerActions;
      validateList('composerAction', registration, list);
      list.push(registration);
      return removeListed(list, registration);
    },
    composerBanner: (registration) => {
      const list = registrations().composerBanners;
      validateList('composerBanner', registration, list);
      list.push(registration);
      return removeListed(list, registration);
    },
  };
}
