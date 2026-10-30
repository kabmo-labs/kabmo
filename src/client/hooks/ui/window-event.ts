import { useEffect, useRef } from 'preact/hooks';

/**
 * Event-listener hooks. Each subscribes once per event type and always calls
 * the latest handler through a ref, so an inline closure does not tear the
 * listener down and re-add it on every render.
 */

type EventTargetLike = Window | Document;

/**
 * The global to subscribe on, or null when this environment has none.
 *
 * Read through `globalThis` rather than as a bare identifier: `window` is a
 * ReferenceError where it does not exist, and a component that subscribes during
 * render would then throw instead of rendering. That is not hypothetical — a
 * suite that unmounts its DOM globals between files made `useToolRenderMode`
 * fail with `window is not defined` inside an unrelated render.
 */
function globalTarget(name: 'window' | 'document'): EventTargetLike | null {
  return (globalThis as unknown as Record<string, EventTargetLike | undefined>)[name] ?? null;
}

function useEventListener<E extends Event>(
  target: EventTargetLike | null,
  type: string,
  handler: (event: E) => void,
  options?: AddEventListenerOptions | boolean,
) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    // Nothing to subscribe on: an effect without a target is a no-op rather
    // than a crash, so a render in a DOM-less environment still mounts.
    if (!target) return;
    const listener = (event: Event) => handlerRef.current(event as E);
    target.addEventListener(type, listener, options);
    return () => target.removeEventListener(type, listener, options);
  }, [target, type, options]);
}

/** Subscribe a `window` listener; the latest handler is always invoked. */
export function useWindowEvent<K extends keyof WindowEventMap>(
  type: K,
  handler: (event: WindowEventMap[K]) => void,
  options?: AddEventListenerOptions | boolean,
) {
  useEventListener<WindowEventMap[K]>(globalTarget('window'), type, handler, options);
}

/** Subscribe a `document` listener; the latest handler is always invoked. */
export function useDocumentEvent<K extends keyof DocumentEventMap>(
  type: K,
  handler: (event: DocumentEventMap[K]) => void,
  options?: AddEventListenerOptions | boolean,
) {
  useEventListener<DocumentEventMap[K]>(globalTarget('document'), type, handler, options);
}

/** Subscribe to a custom `omp:*` window event. */
export function useKabmoEvent(
  name: string,
  handler: (event: Event) => void,
  options?: AddEventListenerOptions | boolean,
) {
  useEventListener<Event>(globalTarget('window'), name, handler, options);
}

/** @deprecated Use `useKabmoEvent`. */
export const useChamberEvent = useKabmoEvent;
