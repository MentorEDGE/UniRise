import { useSearchParams } from "react-router-dom";
import { useCallback } from "react";

/** Filters, sort and page live in the URL so views are shareable and survive reload. */
export function useListParams(defaults: Record<string, string>) {
  const [sp, setSp] = useSearchParams();
  const get = (k: string) => sp.get(k) ?? defaults[k] ?? "";
  const set = useCallback((patch: Record<string, string | number | undefined>, resetPage = true) => {
    setSp((prev) => {
      const n = new URLSearchParams(prev);
      Object.entries(patch).forEach(([k, v]) => (v === undefined || v === "" ? n.delete(k) : n.set(k, String(v))));
      if (resetPage && !("page" in patch)) n.delete("page");
      return n;
    }, { replace: true });
  }, [setSp]);
  return { get, set, page: Number(get("page") || 0) };
}
