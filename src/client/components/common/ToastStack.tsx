import { createPortal } from 'preact/compat';
import { Toast } from '@/client/components/common/Toast';
import { dismissToast, useToastQueue } from '@/client/hooks/ui/toasts';

/**
 * The page's ONLY toast host, mounted once by `App`.
 *
 * ## One portal, one corner, one column
 *
 * Every card used to be its own `fixed bottom-4 right-4` portal, so two live
 * toasts printed on top of each other and the newest was unreadable behind the
 * older one. The stack is now a single flex column pinned to the corner: the
 * cards lay out in DOM order, the oldest first, and a new card pushes the others
 * up instead of covering them.
 *
 * It is portalled to `document.body` for the reason every overlay here is: a
 * `fixed` descendant of a `backdrop-filter`/`transform` ancestor is sized to
 * that ancestor, and the composer's glass card is exactly that.
 *
 * The queue is global (see `hooks/ui/toasts`), so a second mount would draw the
 * same list twice — a host that is a settings pane, a panel or a phone drawer
 * would. Only `App` mounts it.
 */
export function ToastStack() {
  const toasts = useToastQueue();
  if (toasts.length === 0) return null;

  return createPortal(
    <div
      className="pointer-events-none fixed bottom-4 right-4 z-[200] flex w-[360px] max-w-[calc(100vw-2rem)] flex-col items-stretch gap-2"
      data-toast-stack=""
    >
      {toasts.map((toast) => (
        <Toast key={toast.id} toast={toast} onDismiss={dismissToast} />
      ))}
    </div>,
    document.body,
  );
}
