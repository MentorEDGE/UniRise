import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

export const ORCID_RE = /^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/;
export const DOI_RE = /^10\.\d{4,9}\/\S+$/;

export const formatNumber = (n: number) => new Intl.NumberFormat().format(n);

export const formatMoney = (n: number, currency = "INR") =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 0 }).format(n);

export const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

/** DOI/ORCID links are only built for the two trusted hosts. */
export const doiUrl = (doi: string) => `https://doi.org/${encodeURI(doi)}`;
export const orcidUrl = (id: string) => `https://orcid.org/${id}`;

export const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("");
