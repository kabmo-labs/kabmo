import { useEffect } from 'preact/hooks';
import type { RefObject } from 'preact/compat';

/**
 * Run `handler` when a pointer goes down outside `ref`.
 *
 * `enabled: false` detaches the listener entirely rather than letting the
 * handler return early: a surface rendered in a PORTAL is outside `ref` by
 * construction, so every press inside it reads as "outside" and the handler
 * would close the very overlay the press belongs to — measured as a model row
 * that could not be chosen on a phone, because `mousedown` closed the picker
 * before `click` reached the row.
 */
export function useOnClickOutside(
  ref: RefObject<any>,
  handler: (event: globalThis.MouseEvent | globalThis.TouchEvent) => void,
  enabled = true,
) {
  useEffect(() => {
    if (!enabled) return;
    const listener = (event: globalThis.MouseEvent | globalThis.TouchEvent) => {
      if (!ref.current || ref.current.contains(event.target as Node)) {
        return;
      }
      handler(event);
    };
    document.addEventListener('mousedown', listener);
    document.addEventListener('touchstart', listener);
    return () => {
      document.removeEventListener('mousedown', listener);
      document.removeEventListener('touchstart', listener);
    };
  }, [ref, handler, enabled]);
}
