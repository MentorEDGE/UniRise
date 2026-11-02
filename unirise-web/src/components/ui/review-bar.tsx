import { useState } from "react";
import type { ReviewAction } from "@/lib/types";
import { Button } from "./button";
import { Field } from "./form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./card";

/** Reviewer actions for a submitted record. The server decides who may review; the UI only hides the bar. */
export function ReviewBar({ onReview, loading, approveLabel = "Approve" }: {
  onReview: (action: ReviewAction, comment: string) => void; loading?: boolean; approveLabel?: string;
}) {
  const [comment, setComment] = useState("");
  const needsComment = !comment.trim();
  return (
    <Card className="mb-6">
      <CardHeader><CardTitle>Review this submission</CardTitle><CardDescription>Your comment is shown to the submitter. It is required unless you approve.</CardDescription></CardHeader>
      <CardContent className="space-y-4">
        <Field label="Comment">
          {(a) => <textarea {...a} rows={3} value={comment} onChange={(e) => setComment(e.target.value)} className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm" />}
        </Field>
        <div className="flex flex-wrap gap-3">
          <Button loading={loading} onClick={() => onReview("approve", comment)}>{approveLabel}</Button>
          <Button variant="secondary" disabled={needsComment} onClick={() => onReview("rework", comment)}>Send for rework</Button>
          <Button variant="secondary" disabled={needsComment} onClick={() => onReview("revision_required", comment)}>Request revision</Button>
          <Button variant="destructive" disabled={needsComment} onClick={() => onReview("reject", comment)}>Reject</Button>
        </div>
      </CardContent>
    </Card>
  );
}
