import { useRef, useState } from 'preact/hooks';
import type { ToastData } from '@/client/components/common/Toast';

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

  return { toasts, pushToast, dismissToast };
}
