import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/app/auth";
import { accentHasContrast, darkModeVariant, hexToHslVar, setCurrency } from "@/lib/tenantFormat";

/** Tenant settings for the signed-in user (key ["settings"]). Disabled until someone is signed in. */
export function useTenantSettings() {
  const { user } = useAuth();
  return useQuery({ queryKey: ["settings"], queryFn: () => api.settings(), enabled: !!user, staleTime: 5 * 60_000 });
}

const STYLE_ID = "tenant-theme";

/** Applies the tenant's accent colour and currency. Render once, inside the auth and query providers. */
export function TenantTheme() {
  const { data } = useTenantSettings();
  useEffect(() => {
    setCurrency(data?.currency);
    // A colour without enough contrast is ignored, so a bad value can never make buttons unreadable.
    if (!data || !accentHasContrast(data.accent)) { document.getElementById(STYLE_ID)?.remove(); return; }
    const light = hexToHslVar(data.accent);
    const dark = darkModeVariant(data.accent);
    const el = document.getElementById(STYLE_ID) ?? Object.assign(document.createElement("style"), { id: STYLE_ID });
    // Selectors repeat the stylesheet's own (:root, .dark) and come later, so they win without !important.
    el.textContent = `:root{--primary:${light};--ring:${light};--accent:${light}}.dark{--primary:${dark};--ring:${dark};--accent:${light}}`;
    document.head.appendChild(el);
  }, [data]);
  useEffect(() => () => { document.getElementById(STYLE_ID)?.remove(); }, []);
  return null;
}
