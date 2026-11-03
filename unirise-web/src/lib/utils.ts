import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { getCurrency } from "./tenantFormat";

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

export const ORCID_RE = /^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/;
export const DOI_RE = /^10\.\d{4,9}\/\S+$/;

export const formatNumber = (n: number) => new Intl.NumberFormat().format(n);

/** Amounts use the tenant's currency (tenant settings), with the number format that fits it. */
export const formatMoney = (n: number, currency: string = getCurrency()) =>
  new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(n);

/** Short amounts for chart axes and tiles, e.g. ₹4.2 Cr. */
export const formatMoneyCompact = (n: number, currency: string = getCurrency()) =>
  new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", { style: "currency", currency, notation: "compact", maximumFractionDigits: 1 }).format(n);

export const formatDate =(iso: string) =>
  new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

/** DOI/ORCID links are only built for the two trusted hosts. */
export const doiUrl = (doi: string) => `https://doi.org/${encodeURI(doi)}`;
export const orcidUrl = (id: string) => `https://orcid.org/${id}`;

export const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("");

export const statusLabel: Record<string, string> = {
  draft: "Draft", submitted: "Submitted", approved: "Approved", sanctioned: "Sanctioned",
  rework: "Rework", revision_required: "Revision required", rejected: "Rejected",
};

/** Neutralises spreadsheet formulas so exported text can't run when opened in Excel. */
export function tableToCsv(columns: string[], rows: (string | number)[][]) {
  const esc = (v: string | number) => {
    let s = String(v);
    if (/^[=+\-@]/.test(s)) s = "'" + s;
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.map(esc).join(","), ...rows.map((r) => r.map(esc).join(","))].join("\n");
}

export function downloadCsv(filename: string, columns: string[], rows: (string | number)[][]) {
  const blob = new Blob([tableToCsv(columns, rows)], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = filename; a.click(); URL.revokeObjectURL(a.href);
}
