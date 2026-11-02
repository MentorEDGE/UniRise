import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { CheckCircle2, XCircle } from "lucide-react";
import { api } from "@/lib/api";
import { HttpError } from "@/lib/http";
import { CURRENCIES, HEX_RE, MIN_CONTRAST, accentHasContrast, contrastWithWhite } from "@/lib/tenantFormat";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import { ErrorBanner, Skeleton } from "@/components/ui/feedback";
import { useToast } from "@/components/ui/toast";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const LOCALES = [{ id: "en-IN", label: "English (India)" }, { id: "en-GB", label: "English (UK)" }, { id: "en-US", label: "English (US)" }];

const schema = z.object({
  logoText: z.string().trim().min(1, "Enter 1 to 4 characters").max(4, "Use at most 4 characters"),
  accent: z.string().regex(HEX_RE, "Use a colour like #6d28d9").refine((v) => !HEX_RE.test(v) || accentHasContrast(v), "White text is hard to read on this colour. Choose a darker one."),
  currency: z.enum(["INR", "USD", "EUR", "GBP"]),
  fiscalYearStartMonth: z.coerce.number().int().min(1).max(12),
  locale: z.string().min(1, "Choose a locale"),
  publicProfilesEnabled: z.boolean(),
  hodValidation: z.boolean(),
  escalationDays: z.coerce.number({ error: "Enter a number of days" }).int("Use whole days").min(7, "At least 7 days").max(120, "At most 120 days"),
});
type Values = z.infer<typeof schema>;

export default function TenantTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const q = useQuery({ queryKey: ["settings"], queryFn: () => api.settings() });
  const form = useForm<Values>({ resolver: zodResolver(schema) as never, mode: "onChange" });
  const { register, handleSubmit, reset, watch, formState: { errors, isDirty } } = form;
  useEffect(() => { if (q.data) reset(q.data); }, [q.data, reset]);

  const save = useMutation({
    mutationFn: (v: Values) => api.saveSettings(v),
    onSuccess: (s) => { qc.setQueryData(["settings"], s); qc.invalidateQueries({ queryKey: ["settings"] }); toast({ tone: "ok", message: "Tenant settings saved." }); },
    onError: (e) => toast({ tone: "error", message: e instanceof HttpError && e.status === 400 ? "Some values are not valid. Check the highlighted fields." : "Couldn't save. Try again." }),
  });

  const accent = watch("accent") ?? "";
  const valid = HEX_RE.test(accent);
  const ratio = valid ? contrastWithWhite(accent) : 0;
  const ok = ratio >= MIN_CONTRAST;
  const logo = watch("logoText") ?? "";

  if (q.isLoading) return <div className="space-y-3"><Skeleton className="h-10 w-72" /><Skeleton className="h-64 w-full" /></div>;
  if (q.isError) return <ErrorBanner error={q.error} onRetry={() => q.refetch()} />;

  return (
    <form onSubmit={handleSubmit((v) => save.mutate(v))} noValidate className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
      <Card>
        <CardHeader><CardTitle>Branding and defaults</CardTitle><CardDescription>Shown to everyone at {q.data?.name}. Sample data until a backend is connected.</CardDescription></CardHeader>
        <CardContent className="grid gap-5 sm:grid-cols-2">
          <Field label="Logo text" hint="Up to 4 characters, shown in the logo mark" error={errors.logoText?.message}>
            {(p) => <Input {...p} maxLength={4} {...register("logoText")} />}
          </Field>
          <Field label="Accent colour" hint={ok ? "Hex colour, for example #6d28d9" : undefined} error={errors.accent?.message}>
            {(p) => (
              <div className="flex gap-2">
                <input type="color" aria-label="Pick accent colour" value={valid ? accent : "#6d28d9"} onChange={(e) => form.setValue("accent", e.target.value, { shouldDirty: true, shouldValidate: true })} className="h-10 w-12 shrink-0 cursor-pointer rounded-xl border border-input bg-background p-1" />
                <Input {...p} spellCheck={false} autoComplete="off" {...register("accent")} />
              </div>)}
          </Field>
          <Field label="Currency" error={errors.currency?.message}>
            {(p) => <Select {...p} {...register("currency")}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</Select>}
          </Field>
          <Field label="Fiscal year starts in" error={errors.fiscalYearStartMonth?.message}>
            {(p) => <Select {...p} {...register("fiscalYearStartMonth")}>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</Select>}
          </Field>
          <Field label="Locale" hint="Dates and numbers" error={errors.locale?.message}>
            {(p) => <Select {...p} {...register("locale")}>{LOCALES.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}</Select>}
          </Field>
          <Field label="Escalate overdue milestones after (days)" hint="Then the HoD is told too. 7 to 120." error={errors.escalationDays?.message}>
            {(p) => <Input {...p} type="number" inputMode="numeric" min={7} max={120} {...register("escalationDays")} />}
          </Field>
          <div className="space-y-4 sm:col-span-2">
            <label className="flex items-start gap-3 text-sm">
              <input type="checkbox" className="mt-1 size-4 accent-[hsl(var(--primary))]" {...register("publicProfilesEnabled")} />
              <span><span className="font-medium">Public profile site</span><span className="block text-xs text-muted-foreground">Shows the scholarly record of people who agreed to appear at /public. Everyone else stays hidden.</span></span>
            </label>
            <label className="flex items-start gap-3 text-sm">
              <input type="checkbox" className="mt-1 size-4 accent-[hsl(var(--primary))]" {...register("hodValidation")} />
              <span><span className="font-medium">HoD validation step</span><span className="block text-xs text-muted-foreground">Heads of department validate entries before the research office reviews them.</span></span>
            </label>
          </div>
          <div className="flex gap-3 sm:col-span-2">
            <Button type="submit" loading={save.isPending} disabled={!isDirty}>Save settings</Button>
            <Button variant="secondary" disabled={!isDirty || save.isPending} onClick={() => q.data && reset(q.data)}>Discard changes</Button>
          </div>
        </CardContent>
      </Card>

      <Card className="h-fit" aria-live="polite">
        <CardHeader><CardTitle>Preview</CardTitle><CardDescription>How the accent looks with white text.</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-xl text-xs font-bold text-white" style={{ backgroundColor: valid ? accent : "#6d28d9" }} aria-hidden>{logo.slice(0, 4) || "—"}</span>
            <span className="text-lg font-semibold tracking-tight">{q.data?.name}</span>
          </div>
          <div className="rounded-xl px-4 py-3 text-sm font-semibold text-white" style={{ backgroundColor: valid ? accent : "#6d28d9" }}>Sample button</div>
          {valid ? (
            <p className={`flex items-start gap-2 text-sm ${ok ? "text-success" : "text-destructive"}`}>
              {ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden /> : <XCircle className="mt-0.5 size-4 shrink-0" aria-hidden />}
              <span><strong>Contrast {ratio.toFixed(2)}:1.</strong> {ok ? `Meets the ${MIN_CONTRAST}:1 minimum for readable text.` : `Below the ${MIN_CONTRAST}:1 minimum, so it can't be saved. Choose a darker colour.`}</span>
            </p>
          ) : <p className="text-sm text-muted-foreground">Enter a hex colour to see its contrast.</p>}
          <p className="text-xs text-muted-foreground">In dark mode a lighter version of this colour is used automatically.</p>
        </CardContent>
      </Card>
    </form>
  );
}
