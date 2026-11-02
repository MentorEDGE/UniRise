import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { CheckCircle2, Circle, Clock, KeyRound, Lock, XCircle } from "lucide-react";
import { api } from "@/lib/api";
import type { SsoTestResult } from "@/mock/ext/tenant";
import type { TenantSettings } from "@/lib/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import { ErrorBanner, Skeleton } from "@/components/ui/feedback";
import { useToast } from "@/components/ui/toast";

const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;
const schema = z.object({
  provider: z.enum(["google", "microsoft", "none"]),
  clientId: z.string().trim().max(200, "Too long"),
  domain: z.string().trim(),
}).superRefine((v, ctx) => {
  if (v.provider === "none") return;
  if (!v.clientId) ctx.addIssue({ code: "custom", path: ["clientId"], message: "Enter the client ID from your provider" });
  if (!DOMAIN_RE.test(v.domain)) ctx.addIssue({ code: "custom", path: ["domain"], message: "Enter your email domain, for example university.edu" });
});
type Values = z.infer<typeof schema>;

const providerLabel = { google: "Google Workspace", microsoft: "Microsoft 365", none: "Not set up" } as const;
const statusMap = {
  verified: { icon: CheckCircle2, label: "Verified", cls: "border-success/30 bg-success/10 text-success" },
  configured: { icon: Clock, label: "Configured, not tested", cls: "border-warning/30 bg-warning/10 text-warning" },
  "not-configured": { icon: Circle, label: "Not configured", cls: "border-border bg-muted text-muted-foreground" },
} as const;

export default function SsoTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const q = useQuery({ queryKey: ["settings"], queryFn: () => api.settings() });
  const [result, setResult] = useState<SsoTestResult | null>(null);
  const form = useForm<Values>({ resolver: zodResolver(schema) as never });
  const { register, handleSubmit, reset, formState: { errors, isDirty } } = form;
  useEffect(() => { if (q.data) reset({ provider: q.data.sso.provider, clientId: q.data.sso.clientId, domain: q.data.sso.domain }); }, [q.data, reset]);

  const done = (s: TenantSettings) => { qc.setQueryData(["settings"], s); qc.invalidateQueries({ queryKey: ["settings"] }); qc.invalidateQueries({ queryKey: ["audit"] }); };
  const save = useMutation({
    mutationFn: (v: Values) => api.saveSso(v),
    onSuccess: (s) => { done(s); setResult(null); toast({ tone: "ok", message: "Single sign-on settings saved. Test the connection next." }); },
    onError: () => toast({ tone: "error", message: "Couldn't save. Check the values and try again." }),
  });
  const test = useMutation({
    mutationFn: () => api.testSso(),
    onSuccess: (r) => { setResult(r); qc.invalidateQueries({ queryKey: ["settings"] }); },
    onError: () => toast({ tone: "error", message: "The test couldn't run. Try again." }),
  });

  if (q.isLoading) return <Skeleton className="h-64 w-full" />;
  if (q.isError || !q.data) return <ErrorBanner error={q.error} onRetry={() => q.refetch()} />;
  const sso = q.data.sso;
  const st = statusMap[sso.status];
  const StIcon = st.icon;

  return (
    <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle>OpenID Connect sign-in</CardTitle>
            <Badge className={st.cls}><StIcon className="size-3.5" aria-hidden />{st.label}</Badge>
          </div>
          <CardDescription>Staff sign in with {providerLabel[sso.provider]}. There is no password form in UniRise. Sample data until a backend is connected.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit((v) => save.mutate(v))} noValidate className="grid gap-5 sm:grid-cols-2">
            <Field label="Provider" error={errors.provider?.message}>
              {(p) => <Select {...p} {...register("provider")}><option value="google">Google Workspace</option><option value="microsoft">Microsoft 365</option><option value="none">Not set up</option></Select>}
            </Field>
            <Field label="Email domain" hint="People with this domain may sign in" error={errors.domain?.message}>
              {(p) => <Input {...p} autoComplete="off" spellCheck={false} placeholder="university.edu" {...register("domain")} />}
            </Field>
            <Field label="Client ID" className="sm:col-span-2" hint="From the app registration at your provider" error={errors.clientId?.message}>
              {(p) => <Input {...p} autoComplete="off" spellCheck={false} {...register("clientId")} />}
            </Field>
            <div className="flex flex-wrap gap-3 sm:col-span-2">
              <Button type="submit" loading={save.isPending} disabled={!isDirty}>Save</Button>
              <Button variant="secondary" loading={test.isPending} disabled={isDirty || sso.provider === "none"} onClick={() => test.mutate()}><KeyRound /> Test connection</Button>
            </div>
            {isDirty && <p className="text-xs text-muted-foreground sm:col-span-2">Save your changes before testing.</p>}
          </form>
          {result && (
            <p role="status" className={`mt-5 flex items-start gap-2 rounded-xl border p-3 text-sm ${result.ok ? "border-success/30 bg-success/10" : "border-destructive/30 bg-destructive/10"}`}>
              {result.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden /> : <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />}
              <span><strong>{result.ok ? "Test passed." : "Test failed."}</strong> {result.message}</span>
            </p>)}
        </CardContent>
      </Card>

      <Card className="h-fit">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle>SAML 2.0</CardTitle>
            <Badge className="border-border bg-muted text-muted-foreground"><Lock className="size-3.5" aria-hidden />Phase 3</Badge>
          </div>
          <CardDescription>For universities that require SAML. Planned for a later release, so it can't be turned on yet.</CardDescription>
        </CardHeader>
        <CardContent>
          <Field label="Identity provider metadata URL">{(p) => <Input {...p} disabled placeholder="Available in Phase 3" />}</Field>
          <p className="mt-4 text-xs text-muted-foreground">Email-link sign-in exists only for sandbox and demo tenants, never for real staff.</p>
        </CardContent>
      </Card>
    </div>
  );
}
