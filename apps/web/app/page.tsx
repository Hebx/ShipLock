import Link from "next/link";
import { Card, ErrorPanel, Sha, StateBadge } from "@/components/ui";
import { getPullRequests } from "@/lib/api";

export const dynamic = "force-dynamic";

const STEPS = [
  ["AI agent", "opens the pull request"],
  ["Independent review", "paid via Hedera x402"],
  ["Verified human", "authorizes the exact commit"],
  ["Merge", "only that SHA ships"],
] as const;

export default async function Dashboard() {
  const result = await getPullRequests();

  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-3xl font-bold tracking-tight">
          AI writes. <span className="text-approve">Humans ship.</span>
        </h1>
        <p className="mt-2 max-w-2xl text-muted">
          Release control for agent-built pull requests: the code that merges must be the code that was independently reviewed and
          explicitly authorized.
        </p>
        <ol className="mt-6 grid gap-3 sm:grid-cols-4">
          {STEPS.map(([title, sub], i) => (
            <li key={title} className="rounded-xl border border-line bg-panel/70 px-4 py-3">
              <p className="text-xs text-muted">Step {i + 1}</p>
              <p className="font-semibold">{title}</p>
              <p className="text-sm text-muted">{sub}</p>
            </li>
          ))}
        </ol>
      </section>

      {!result.ok ? (
        <ErrorPanel message={result.error} />
      ) : (
        <Card title="Pull requests" aside={<span className="text-xs text-muted">{result.data.pullRequests.length} tracked</span>}>
          {result.data.pullRequests.length === 0 ? (
            <p className="text-sm text-muted">
              No pull requests yet. An agent registers one with <code className="font-mono">POST /api/reviews</code>, or run{" "}
              <code className="font-mono">pnpm analyze owner/repo#N</code> against an allowlisted repository.
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {result.data.pullRequests.map((pr) => (
                <li key={pr.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">
                      <span className="text-muted">
                        {pr.repository}#{pr.number}
                      </span>{" "}
                      {pr.title}
                    </p>
                    <p className="mt-1 text-xs text-muted">
                      head <Sha value={pr.latestHeadSha} short /> · by {pr.authorLogin ?? "unknown"} · synced{" "}
                      {new Date(pr.lastSyncedAt).toLocaleString()}
                    </p>
                  </div>
                  {pr.latestJob ? (
                    <>
                      <StateBadge state={pr.latestJob.state} />
                      <Link href={`/reviews/${pr.latestJob.id}`} className="rounded-lg bg-brand px-3 py-1.5 text-sm font-medium hover:bg-brand/80">
                        Open
                      </Link>
                    </>
                  ) : (
                    <span className="text-xs text-muted">{pr.merged ? "merged" : pr.state}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </div>
  );
}
