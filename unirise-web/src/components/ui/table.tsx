import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from "react";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./button";

export const Table = ({ className, ...p }: HTMLAttributes<HTMLTableElement>) => (
  <div className="w-full overflow-x-auto"><table className={cn("w-full caption-bottom text-sm", className)} {...p} /></div>
);
export const THead = (p: HTMLAttributes<HTMLTableSectionElement>) => <thead className="border-b bg-secondary/50 text-left text-xs uppercase tracking-wider text-muted-foreground" {...p} />;
export const TBody = (p: HTMLAttributes<HTMLTableSectionElement>) => <tbody className="divide-y" {...p} />;
export const TR = ({ className, ...p }: HTMLAttributes<HTMLTableRowElement>) => <tr className={cn("transition-colors hover:bg-secondary/40", className)} {...p} />;
export const TH = ({ className, ...p }: ThHTMLAttributes<HTMLTableCellElement>) => <th scope="col" className={cn("px-4 py-3 font-semibold", className)} {...p} />;
export const TD = ({ className, ...p }: TdHTMLAttributes<HTMLTableCellElement>) => <td className={cn("px-4 py-3 align-top", className)} {...p} />;

export function SortHeader({ label, field, sort, onSort }: { label: string; field: string; sort: string; onSort: (s: string) => void }) {
  const [key, dir] = sort.split(":");
  const active = key === field;
  return (
    <TH aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}>
      <button className="inline-flex items-center gap-1 uppercase tracking-wider hover:text-foreground" onClick={() => onSort(`${field}:${active && dir === "desc" ? "asc" : "desc"}`)}>
        {label}{active && (dir === "asc" ? <ArrowUp className="size-3" aria-hidden /> : <ArrowDown className="size-3" aria-hidden />)}
      </button>
    </TH>
  );
}

export function Pagination({ page, size, total, onPage }: { page: number; size: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / size));
  const from = total === 0 ? 0 : page * size + 1;
  const to = Math.min(total, (page + 1) * size);
  return (
    <nav className="flex items-center justify-between gap-3 border-t px-4 py-3 text-sm" aria-label="Pagination">
      <span className="text-muted-foreground">{from}–{to} of {total}</span>
      <div className="flex items-center gap-2">
        <Button size="icon" variant="secondary" aria-label="Previous page" disabled={page <= 0} onClick={() => onPage(page - 1)}><ChevronLeft /></Button>
        <span className="min-w-16 text-center">Page {page + 1} / {pages}</span>
        <Button size="icon" variant="secondary" aria-label="Next page" disabled={page + 1 >= pages} onClick={() => onPage(page + 1)}><ChevronRight /></Button>
      </div>
    </nav>
  );
}
