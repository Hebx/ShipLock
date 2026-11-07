import type { ReactNode } from "react";
import type { Finding, ReleaseState } from "@/lib/api";

const STATE_STYLE: Record<ReleaseState, { label: string; className: string }> = {
  discovered: { label: "Discovered", className: "border-info/50 text-info" },
  review_pending: { label: "Review pending", className: "border-info/50 text-info" },
  paid_review_confirmed: { label: "Paid review confirmed", className: "border-brand/60 text-brand" },
  approval_pending: { label: "Awaiting human", className: "border-brand/60 text-brand" },
  approved: { label: "Approved", className: "border-approve/60 text-approve" },
  merge_in_progress: { label: "Merging", className: "border-approve/60 text-approve" },
  merged: { label: "Merged", className: "border-approve bg-approve/10 text-approve" },
  review_blocked: { label: "Review blocked", className: "border-caution/60 text-caution" },
  denied: { label: "Denied", className: "border-caution/60 text-caution" },
  expired: { label: "Expired", className: "border-caution/60 text-caution" },
  stale: { label: "Stale SHA", className: "border-caution/60 text-caution" },
  invalid: { label: "Invalid", className: "border-caution/60 text-caution" },
  failed: { label: "Failed", className: "border-caution/60 text-caution" },
  reconcile_required: { label: "Reconcile required", className: "border-caution/60 text-caution" },
};

export function StateBadge({ state }: { state: ReleaseState }) {
  const s = STATE_STYLE[state];
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${s.className}`}>{s.label}</span>;
}

/** Every external artifact must say where its evidence came from. */
export function EvidenceTag({ kind }: { kind: "live" | "test" | "simulated" | "local" | "none" }) {
  const map = {
    live: ["Live", "border-approve/60 text-approve"],
    test: ["Development / test", "border-info/60 text-info"],
    simulated: ["Simulated", "border-caution/60 text-caution"],
    local: ["ShipLock local analysis", "border-line text-muted"],
    none: ["No evidence yet", "border-line text-muted"],
  } as const;
  const [label, className] = map[kind];
  return <span className={`inline-flex rounded-md border px-2 py-0.5 text-[11px] uppercase tracking-wide ${className}`}>{label}</span>;
}

export function Sha({ value, short = false }: { value: string; short?: boolean }) {
  return (
    <code title={value} className="rounded bg-panel-2 px-1.5 py-0.5 font-mono text-[12px] text-[#d9ccff] break-all">
      {short ? value.slice(0, 12) : value}
    </code>
  );
}

export function Card({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-panel/80 p-5">
      <header className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold tracking-wide text-white">{title}</h2>
        {aside}
      </header>
      {children}
    </section>
  );
}

const SEVERITY_STYLE: Record<Finding["severity"], string> = {
  critical: "bg-caution/20 text-caution",
  high: "bg-caution/10 text-caution",
  medium: "bg-info/10 text-info",
  low: "bg-panel-2 text-muted",
  info: "bg-panel-2 text-muted",
};

export function SeverityPill({ severity }: { severity: Finding["severity"] }) {
  return <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase ${SEVERITY_STYLE[severity]}`}>{severity}</span>;
}

export function ErrorPanel({ message }: { message: string }) {
  return (
    <div className="rounded-2xl border border-caution/40 bg-caution/5 p-5 text-sm text-caution">
      {message}. Start it with <code className="font-mono">pnpm dev:api</code>.
    </div>
  );
}
