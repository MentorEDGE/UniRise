import { forwardRef, type ButtonHTMLAttributes } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "destructive";
type Size = "sm" | "md" | "lg" | "icon";

const variants: Record<Variant, string> = {
  primary: "bg-primary text-primary-foreground hover:bg-primary/90 border border-primary/80 shadow-[0_10px_24px_hsl(var(--primary)/0.25)]",
  secondary: "border border-slate-300 text-slate-700 bg-transparent hover:bg-slate-100/60 dark:border-white/15 dark:text-slate-200 dark:hover:bg-white/10",
  ghost: "hover:bg-secondary hover:text-secondary-foreground",
  destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
};
const sizes: Record<Size, string> = { sm: "h-8 px-3 text-xs", md: "h-10 px-4 text-sm", lg: "h-11 px-6 text-sm", icon: "h-9 w-9" };

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant; size?: Size; loading?: boolean; pill?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", loading, pill, disabled, children, type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cn(
        "inline-flex items-center justify-center gap-2 whitespace-nowrap font-semibold transition-[transform,background-color,color,border-color,box-shadow] duration-200 ease-out-strong active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
        pill ? "rounded-full" : "rounded-xl", variants[variant], sizes[size], className,
      )}
      {...props}
    >
      {loading && <Loader2 className="animate-spin" aria-hidden />}
      {children}
    </button>
  ),
);
Button.displayName = "Button";
