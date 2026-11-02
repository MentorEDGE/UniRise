import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Card({ className, hover, ...p }: HTMLAttributes<HTMLDivElement> & { hover?: boolean }) {
  return <div className={cn("surface-card", hover && "surface-card-hover", className)} {...p} />;
}
export const CardHeader = ({ className, ...p }: HTMLAttributes<HTMLDivElement>) => <div className={cn("px-6 pt-6 md:px-8 md:pt-8", className)} {...p} />;
export const CardTitle = ({ className, ...p }: HTMLAttributes<HTMLHeadingElement>) => <h3 className={cn("text-lg md:text-xl font-semibold tracking-tight", className)} {...p} />;
export const CardDescription = ({ className, ...p }: HTMLAttributes<HTMLParagraphElement>) => <p className={cn("mt-1 text-sm text-muted-foreground leading-relaxed", className)} {...p} />;
export const CardContent = ({ className, ...p }: HTMLAttributes<HTMLDivElement>) => <div className={cn("p-6 md:p-8", className)} {...p} />;
