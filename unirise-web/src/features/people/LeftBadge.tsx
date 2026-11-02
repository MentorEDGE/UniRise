import { UserX } from "lucide-react";
import { formatDate } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

/** Icon and text, never colour alone. */
export const LeftBadge = ({ leftOn }: { leftOn?: string }) => (
  <Badge className="border-warning/30 bg-warning/10 text-warning"><UserX className="size-3.5" aria-hidden />Left{leftOn ? ` ${formatDate(leftOn)}` : ""}</Badge>
);
