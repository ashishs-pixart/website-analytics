import type { ToastState } from '../types';

export function Toast({ toast }: { toast: ToastState }) {
  if (!toast) return null;
  return <div id="toast" className="show">{toast.message}</div>;
}
