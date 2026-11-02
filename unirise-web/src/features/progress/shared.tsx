import { forwardRef, type TextareaHTMLAttributes } from "react";
import { HttpError } from "@/lib/http";
import { cn } from "@/lib/utils";

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...p }, ref) => (
  <textarea ref={ref} className={cn("min-h-24 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground transition-colors disabled:opacity-50 aria-[invalid=true]:border-destructive", className)} {...p} />
));
Textarea.displayName = "Textarea";

/** Suggested stage names for a new milestone; any name may be typed. */
export const STAGE_SUGGESTIONS = ["Registration", "Coursework", "Proposal defence", "Progress review 1", "Progress review 2", "Thesis submission", "Viva"];

/** Friendly text for a failed save; never the server's own wording. */
export function saveErrorMessage(e: unknown) {
  const status = e instanceof HttpError ? e.status : 0;
  if (status === 403) return "You don't have permission to do that.";
  if (status === 404) return "That item no longer exists.";
  if (status === 409) return "That can't be done in the item's current state. Refresh and try again.";
  if (status === 400) return "Some details are not valid. Check the form and try again.";
  return "Something went wrong. Please try again.";
}

/** Query keys that show milestones or their roll-ups; refreshed together after any milestone change. */
export const PROGRESS_KEYS = [["milestones"], ["mentee"], ["mentees"], ["reminders"], ["summary"], ["rollup"], ["unit-rollup"]] as const;
