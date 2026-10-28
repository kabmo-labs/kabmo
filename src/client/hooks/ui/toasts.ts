import { useRef, useState } from 'preact/hooks';
import type { ToastData } from '@/client/components/common/Toast';
import { useEditorErrorToast } from '@/client/hooks/ui/editor-error-toast';

/** What `useToasts` hands back — named, so a component takes the contract rather than `ReturnType`. */
export interface ToastsHandle {
  toasts: ToastData[];
  pushToast: (
    message: string,
    type?: 'success' | 'error',
    options?: { action?: ToastData['action']; duration?: number },
  ) => void;
  dismissToast: (id: number) => void;
}

export function useToasts(): ToastsHandle {
  const [toasts, setToasts] = useState<ToastData[]>([]);
  const toastIdRef = useRef(0);

  const pushToast = (
    message: string,
    type: 'success' | 'error' = 'error',
    options?: { action?: ToastData['action']; duration?: number },
  ) => {
    toastIdRef.current += 1;
    setToasts(prev => [...prev, { id: toastIdRef.current, message, type, ...options }]);
  };

  const dismissToast = (id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  };

  // Every toast host already calls this hook — both shells, the sidebar and the
  // settings modal — so subscribing here is what makes an editor exception
  // impossible to miss by forgetting one call site. A CodeMirror plugin that
  // throws is caught by the library and would otherwise reach only the console.
  useEditorErrorToast(pushToast);

  return { toasts, pushToast, dismissToast };
}
