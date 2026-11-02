import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { CheckCircle2, XCircle } from "lucide-react";

interface Toast { id: number; message: string; tone: "ok" | "error"; actionLabel?: string; onAction?: () => void }
const Ctx = createContext<{ toast: (t: Omit<Toast, "id">) => void }>({ toast: () => {} });
export const useToast = () => useContext(Ctx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const toast = useCallback((t: Omit<Toast, "id">) => {
    const id = Date.now() + Math.random();
    setItems((s) => [...s, { ...t, id }]);
    setTimeout(() => setItems((s) => s.filter((x) => x.id !== id)), 6000);
  }, []);
  return (
    <Ctx.Provider value={{ toast }}>
      {children}
      <div className="fixed bottom-20 right-4 z-[60] flex flex-col gap-2 md:bottom-6" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className="surface-card flex animate-fade-up items-center gap-3 px-4 py-3 text-sm">
            {t.tone === "ok" ? <CheckCircle2 className="size-5 text-success" aria-hidden /> : <XCircle className="size-5 text-destructive" aria-hidden />}
            <span>{t.message}</span>
            {t.onAction && (
              <button className="font-semibold text-primary underline-offset-4 hover:underline" onClick={() => { t.onAction?.(); setItems((s) => s.filter((x) => x.id !== t.id)); }}>
                {t.actionLabel ?? "Undo"}
              </button>
            )}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
