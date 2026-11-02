import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Plus, Search, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth, can } from "@/app/auth";
import { useListParams } from "@/lib/useListParams";
import { doiUrl } from "@/lib/utils";
import type { PublicationFilters, PublicationType, VerificationState } from "@/lib/types";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";
import { SourceChip, VerificationBadge } from "@/components/ui/badge";
import { EmptyState, ErrorBanner, Skeleton } from "@/components/ui/feedback";
import { Pagination, SortHeader, Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { ConfirmDialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";

const SIZE = 10;

export default function Publications() {
  const { user } = useAuth();
  const { get, set, page } = useListParams({ sort: "year:desc" });
  const qc = useQueryClient();
  const { toast } = useToast();
  const [toDelete, setToDelete] = useState<number | null>(null);

  const filters: PublicationFilters = {
    q: get("q") || undefined,
    year: get("year") ? Number(get("year")) : undefined,
    type: (get("type") as PublicationType) || "",
    state: (get("state") as VerificationState) || "",
    departmentId: get("dept") ? Number(get("dept")) : undefined,
    sort: get("sort"),
    page,
    size: SIZE,
  };

  const list = useQuery({ queryKey: ["publications", filters], queryFn: () => api.publications(filters), placeholderData: (p) => p });
  const depts = useQuery({ queryKey: ["departments"], queryFn: api.departments });
  const researchers = useQuery({ queryKey: ["researchers", "all"], queryFn: () => api.researchers() });
  const nameOf = (id: number) => researchers.data?.find((r) => r.id === id)?.name ?? `#${id}`;

  const del = useMutation({
    mutationFn: (id: number) => api.deletePublication(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["publications"] });
      qc.invalidateQueries({ queryKey: ["summary"] });
      toast({ tone: "ok", message: "Publication removed from reports." });
      setToDelete(null);
    },
    onError: () => toast({ tone: "error", message: "Couldn't delete. Try again." }),
  });

  const data = list.data;
  const canEdit = can.edit(user?.role);
  const years = Array.from({ length: 9 }, (_, i) => 2026 - i);

  return (
    <div>
      <PageHeader eyebrow="Research output" title="Publications" description="Every record shows where it came from and whether it has been verified."
        actions={canEdit && <Link to="/publications/new" className="inline-flex h-10 items-center gap-2 rounded-xl border border-primary/80 bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-[0_10px_24px_hsl(var(--primary)/0.25)] transition-transform active:scale-[0.98]"><Plus className="size-4" aria-hidden />Add publication</Link>} />

      <Card className="mb-4 p-4">
        <form role="search" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr_1fr]" onSubmit={(e) => e.preventDefault()}>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground" aria-hidden />
            <Input aria-label="Search publications" placeholder="Search title, venue or DOI" className="pl-9" defaultValue={get("q")} onChange={(e) => set({ q: e.target.value })} />
          </div>
          <Select aria-label="Year" value={get("year")} onChange={(e) => set({ year: e.target.value })}>
            <option value="">All years</option>{years.map((y) => <option key={y}>{y}</option>)}
          </Select>
          <Select aria-label="Type" value={get("type")} onChange={(e) => set({ type: e.target.value })}>
            <option value="">All types</option>
            {["journal-article", "conference-paper", "book-chapter", "book", "preprint", "patent"].map((t) => <option key={t} value={t}>{t.replace("-", " ")}</option>)}
          </Select>
          <Select aria-label="Verification" value={get("state")} onChange={(e) => set({ state: e.target.value })}>
            <option value="">Any state</option><option value="verified">Verified</option><option value="suggested">Suggested</option><option value="unverified">Unverified</option>
          </Select>
          <Select aria-label="Department" value={get("dept")} onChange={(e) => set({ dept: e.target.value })}>
            <option value="">All departments</option>{depts.data?.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </Select>
        </form>
      </Card>

      {list.isError && <ErrorBanner error={list.error} onRetry={() => list.refetch()} />}

      <Card className="overflow-hidden">
        {list.isLoading ? (
          <div className="space-y-3 p-6">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
        ) : data && data.items.length === 0 ? (
          <EmptyState title="No publications found" description="Try different filters, or import one by DOI." action={canEdit && <Link to="/publications/new" className="text-sm font-semibold text-primary hover:underline">Import by DOI</Link>} />
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden md:block">
              <Table>
                <THead>
                  <tr>
                    <SortHeader label="Title" field="title" sort={get("sort")} onSort={(s) => set({ sort: s })} />
                    <SortHeader label="Year" field="year" sort={get("sort")} onSort={(s) => set({ sort: s })} />
                    <TH>Authors</TH><TH>State</TH><TH>Source</TH><TH><span className="sr-only">Actions</span></TH>
                  </tr>
                </THead>
                <TBody>
                  {data?.items.map((p) => (
                    <TR key={p.id}>
                      <TD className="max-w-md">
                        <Link to={`/publications/${p.id}`} className="font-medium hover:text-primary">{p.title}</Link>
                        <div className="mt-0.5 text-xs text-muted-foreground">{p.venue} · {p.type.replace("-", " ")}
                          {p.doi && <> · <a className="inline-flex items-center gap-0.5 text-primary hover:underline" href={doiUrl(p.doi)} target="_blank" rel="noopener noreferrer">DOI<ExternalLink className="size-3" aria-hidden /></a></>}
                        </div>
                      </TD>
                      <TD>{p.year}</TD>
                      <TD className="max-w-48 text-muted-foreground">{p.authorIds.map(nameOf).join(", ") || "—"}</TD>
                      <TD><VerificationBadge state={p.state} /></TD>
                      <TD><SourceChip source={p.source} /></TD>
                      <TD>{canEdit && <Button variant="ghost" size="icon" aria-label={`Delete ${p.title}`} onClick={() => setToDelete(p.id)}><Trash2 /></Button>}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>
            {/* Mobile cards */}
            <ul className="divide-y md:hidden">
              {data?.items.map((p) => (
                <li key={p.id} className="space-y-2 p-4">
                  <Link to={`/publications/${p.id}`} className="block font-medium">{p.title}</Link>
                  <p className="text-xs text-muted-foreground">{p.venue} · {p.year}</p>
                  <div className="flex flex-wrap gap-2"><VerificationBadge state={p.state} /><SourceChip source={p.source} /></div>
                </li>
              ))}
            </ul>
            {data && <Pagination page={data.page} size={data.size} total={data.total} onPage={(n) => set({ page: n }, false)} />}
          </>
        )}
      </Card>

      <ConfirmDialog open={toDelete !== null} onClose={() => setToDelete(null)} loading={del.isPending}
        title="Delete this publication?" description="It will be removed from all reports. This can't be undone."
        onConfirm={() => toDelete !== null && del.mutate(toDelete)} />
    </div>
  );
}
