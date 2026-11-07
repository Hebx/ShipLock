import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, ErrorPanel, EvidenceTag, Sha, SeverityPill, StateBadge } from "@/components/ui";
import { getReview } from "@/lib/api";

export const dynamic = "force-dynamic";

const CONCLUSION_LABEL = {
  pass: "no blocking findings (heuristic)",
  block: "blocking findings",
  inconclusive: "inconclusive",
} as const;

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await getReview(id);
  if (!result.ok && result.error === "not_found") notFound();
  if (!result.ok) return <ErrorPanel message={result.error} />;

  const { job, localReport, findings, paidReview, otherHeads, events } = result.data;
  const local = findings.filter((f) => f.source === "local");
  const ghBase = `https://github.com/${job.repository}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/" className="text-sm text-muted hover:text-white">
            ← Pull requests
          </Link>
          <h1 className="mt-1 text-2xl font-bold">
            {job.repository}#{job.pullNumber}
          </h1>
          <p className="mt-1 text-sm text-muted">
            Review job <code className="font-mono">{job.id}</code>
          </p>
        </div>
        <div className="text-right">
          <StateBadge state={job.state} />
          {job.stateReason && <p className="mt-1 text-xs text-muted">{job.stateReason}</p>}
        </div>
      </div>

      {job.state === "stale" && (
        <div className="rounded-2xl border border-caution/50 bg-caution/10 p-4 text-sm text-caution">
          This commit is no longer the pull request head. Its review and any authorization cannot be used; a fresh paid review and
          approval are required for the new head.
        </div>
      )}

      <Card title="Exact commit binding" aside={<EvidenceTag kind="local" />}>
        <dl className="grid gap-3 text-sm sm:grid-cols-[180px_1fr]">
          <dt className="text-muted">Head SHA</dt>
          <dd>
            <a href={`${ghBase}/commit/${job.headSha}`} target="_blank" rel="noreferrer">
              <Sha value={job.headSha} />
            </a>
          </dd>
          <dt className="text-muted">Base</dt>
          <dd>
            <Sha value={job.baseSha} /> <span className="text-muted">({job.baseRef})</span>
          </dd>
          <dt className="text-muted">Repository ID</dt>
          <dd className="font-mono">{job.repositoryId}</dd>
          <dt className="text-muted">Diff SHA-256</dt>
          <dd>{job.diffSha256 ? <Sha value={job.diffSha256} /> : <span className="text-muted">not analyzed</span>}</dd>
          <dt className="text-muted">Scanner</dt>
          <dd className="font-mono">{job.scannerVersion}</dd>
          <dt className="text-muted">Report SHA-256</dt>
          <dd>{job.localReportSha256 ? <Sha value={job.localReportSha256} /> : <span className="text-muted">—</span>}</dd>
        </dl>
      </Card>

      <Card
        title="Risk findings"
        aside={
          <span className="text-xs text-muted">
            {localReport ? `${localReport.stats.filesChanged} files · +${localReport.stats.additions} −${localReport.stats.deletions}` : ""}
            {job.localConclusion ? ` · ${CONCLUSION_LABEL[job.localConclusion]}` : ""}
          </span>
        }
      >
        {local.length === 0 ? (
          <p className="text-sm text-muted">{localReport ? "No heuristic findings." : "Not analyzed yet."}</p>
        ) : (
          <ul className="divide-y divide-line text-sm">
            {local.map((f, i) => (
              <li key={i} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2">
                <SeverityPill severity={f.severity} />
                <span className="font-mono text-xs text-muted">{f.rule_id}</span>
                <span className="font-mono text-xs">
                  {f.file}
                  {f.line ? `:${f.line}` : ""}
                </span>
                <span className="w-full text-muted sm:w-auto">{f.description}</span>
                {f.evidence && <code className="w-full truncate font-mono text-xs text-[#c9c3e6]">{f.evidence}</code>}
              </li>
            ))}
          </ul>
        )}
        {localReport && (
          <ul className="mt-4 list-disc space-y-1 pl-5 text-xs text-muted">
            {localReport.limitations.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        )}
      </Card>

      <div className="grid gap-6 md:grid-cols-3">
        <Card title="Paid review" aside={<EvidenceTag kind={paidReview ? paidReview.evidence_kind : "none"} />}>
          {paidReview ? (
            <dl className="space-y-2 text-sm">
              <dt className="text-muted">Hedera transaction</dt>
              <dd className="font-mono text-xs break-all">{paidReview.hedera_transaction_id}</dd>
              <dt className="text-muted">Amount</dt>
              <dd className="font-mono">{paidReview.amount_base_units} tinybar</dd>
              <dt className="text-muted">Ledger check</dt>
              <dd>{paidReview.ledger_verified_at ? "confirmed on mirror node" : "not independently confirmed"}</dd>
            </dl>
          ) : (
            <p className="text-sm text-muted">No paid review accepted for this commit.</p>
          )}
        </Card>
        <Card title="Human checkpoint" aside={<EvidenceTag kind="none" />}>
          <p className="text-sm text-muted">World ID Agent Pass authorization is not available until a paid review is confirmed.</p>
        </Card>
        <Card title="Merge" aside={<EvidenceTag kind="none" />}>
          <p className="text-sm text-muted">No merge attempted. ShipLock merges only the approved SHA.</p>
        </Card>
      </div>

      <Card title="Evidence timeline">
        <ol className="space-y-2 text-sm">
          {events.map((e) => (
            <li key={e.id} className="flex gap-3">
              <time className="w-44 shrink-0 font-mono text-xs text-muted">{new Date(e.at).toISOString().replace("T", " ").slice(0, 19)}</time>
              <span className="font-mono text-xs text-white">{e.type}</span>
              <span className="truncate font-mono text-xs text-muted">{JSON.stringify(e.detail)}</span>
            </li>
          ))}
        </ol>
      </Card>

      {otherHeads.length > 0 && (
        <Card title="Other commits of this pull request">
          <ul className="space-y-2 text-sm">
            {otherHeads.map((j) => (
              <li key={j.id} className="flex items-center gap-3">
                <Link href={`/reviews/${j.id}`}>
                  <Sha value={j.headSha} short />
                </Link>
                <StateBadge state={j.state} />
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
