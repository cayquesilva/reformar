import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { CheckCircle2, AlertTriangle, X } from 'lucide-react';
import { t as tr } from './i18n';

type Kind = 'success' | 'error';
interface Toast {
  id: number;
  kind: Kind;
  text: string;
}

const ToastContext = createContext<(text: string, kind?: Kind) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const remove = (id: number) => setToasts((t) => t.filter((x) => x.id !== id));
  const show = useCallback((text: string, kind: Kind = 'success') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-2), { id, kind, text }]);
    window.setTimeout(() => remove(id), kind === 'error' ? 8000 : 4500);
  }, []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      {/* aria-live: leitores de tela anunciam o resultado de cada ação */}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`}>
            {t.kind === 'success' ? <CheckCircle2 aria-hidden /> : <AlertTriangle aria-hidden />}
            <span>{t.text}</span>
            <button type="button" className="icon-btn" onClick={() => remove(t.id)} aria-label={tr('Fechar aviso')}>
              <X aria-hidden />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
