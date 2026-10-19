import { useEffect, useRef } from 'preact/hooks';

/**
 * Event-listener hooks. Each subscribes once per event type and always calls
 * the latest handler through a ref, so an inline closure does not tear the
 * listener down and re-add it on every render.
 */

type EventTargetLike = Window | Document;

function useEventListener<E extends Event>(
  target: EventTargetLike,
  type: string,
  handler: (event: E) => void,
  options?: AddEventListenerOptions | boolean,
) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
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
  useEventListener<WindowEventMap[K]>(window, type, handler, options);
}

/** Subscribe a `document` listener; the latest handler is always invoked. */
export function useDocumentEvent<K extends keyof DocumentEventMap>(
  type: K,
  handler: (event: DocumentEventMap[K]) => void,
  options?: AddEventListenerOptions | boolean,
) {
  useEventListener<DocumentEventMap[K]>(document, type, handler, options);
}

/** Subscribe to a custom `omp:*` window event. */
export function useKabmoEvent(
  name: string,
  handler: (event: Event) => void,
  options?: AddEventListenerOptions | boolean,
) {
  useEventListener<Event>(window, name, handler, options);
}

/** @deprecated Use `useKabmoEvent`. */
export const useChamberEvent = useKabmoEvent;
