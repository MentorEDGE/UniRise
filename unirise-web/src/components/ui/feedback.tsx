import { AlertTriangle, Inbox } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Button } from "./button";
import { HttpError } from "@/lib/http";

export const Skeleton = ({ className }: { className?: string }) => <div className={cn("skeleton", className)} aria-hidden />;

export function EmptyState({ title, description, action, icon }: { title: string; description: string; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
      <div className="grid size-12 place-items-center rounded-2xl bg-secondary text-primary">{icon ?? <Inbox className="size-6" aria-hidden />}</div>
      <h3 className="text-lg font-semibold">{title}</h3>
      <p className="max-w-md text-sm text-muted-foreground">{description}</p>
      {action}
    </div>
  );
}

/** Generic error banner; never shows raw server text. */
export function ErrorBanner({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const status = error instanceof HttpError ? error.status : 0;
  const msg = status === 403 ? "You don't have access to this." : status === 404 ? "We couldn't find that." : "Something went wrong. Please try again.";
  return (
    <div role="alert" className="flex items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm">
      <AlertTriangle className="size-5 shrink-0 text-destructive" aria-hidden />
      <span className="flex-1">{msg}</span>
      {onRetry && <Button size="sm" variant="secondary" onClick={onRetry}>Retry</Button>}
    </div>
  );
}
