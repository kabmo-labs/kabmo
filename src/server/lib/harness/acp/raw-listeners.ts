/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The raw `session/update` sinks an ACP session fans out to.
 *
 * The transcript recorder reads the FOLDED events; the raw panel reads the
 * original ACP payloads, so the session needs a second, pre-mapper sink. Kept
 * in its own module because the session class is at the file ceiling and this
 * is a self-contained subscription set.
 */

export type RawNotificationListener = (method: string, params: Record<string, unknown>) => void;

export class RawNotificationSink {
  private readonly listeners = new Set<RawNotificationListener>();

  add(listener: RawNotificationListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(method: string, params: Record<string, unknown>): void {
    for (const listener of this.listeners) listener(method, params);
  }
}
