"use client";

import { CredentialRequest, IDKitSessionWidget, type IDKitResultSession } from "@worldcoin/idkit";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { ApprovalRequest, Authorization, MergeAttempt, PaidReview, ReleaseState, SessionInfo } from "@/lib/api";
import { callApi, loadSession, WORLD_ENV_LABEL } from "@/lib/client";
import { Card, EvidenceTag, Sha } from "./ui";

const AUTHORIZABLE: ReleaseState[] = ["paid_review_confirmed", "denied", "expired"];

interface Props {
  jobId: string;
  jobState: ReleaseState;
  paidReview: PaidReview | null;
  authorization: Authorization | null;
  mergeAttempt: MergeAttempt | null;
}

export function HumanCheckpoint({ jobId, jobState, paidReview, authorization, mergeAttempt }: Props) {
  const router = useRouter();
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [proof, setProof] = useState<ApprovalRequest | null>(null);
  /** Set once the widget outcome is handled: approved by the server, or closed and cancelled. */
  const settled = useRef(false);

  useEffect(() => {
    loadSession().then((r) => (r.ok ? setSession(r.data) : setError(r.error)));
  }, []);

  const post = async <T,>(path: string, body: unknown = {}) => {
    setBusy(true);
    setError(null);
    const r = await callApi<T>(path, { method: "POST", body, csrf: session?.csrfToken });
    setBusy(false);
    if (!r.ok) setError(r.error);
    return r;
  };
  const done = () => router.refresh();

  const requestAuthorization = async () => {
    const r = await post<{ idkit: ApprovalRequest }>("/api/authorizations", { jobId });
    if (r.ok) {
      settled.current = false;
      setProof(r.data.idkit);
    }
    done();
  };

  const approveWithWorld = async () => {
    const r = await post<{ idkit: ApprovalRequest }>(`/api/authorizations/${authorization!.id}/proof-request`);
    if (r.ok) {
      settled.current = false;
      setProof(r.data.idkit);
    } else done();
  };

  /** Runs inside the widget. Only ShipLock's server, after World's verify endpoint, can approve. */
  const submitApproval = async (idkitResult: IDKitResultSession) => {
    const auth = authorization ?? (await currentAuthorization());
    const r = await callApi(`/api/authorizations/${auth.id}/approve`, {
      method: "POST",
      body: { requestId: proof!.requestId, operationHash: proof!.signal, idkitResult },
      csrf: session?.csrfToken,
    });
    if (!r.ok) {
      setError(r.error);
      throw new Error(r.error);
    }
    settled.current = true;
  };

  const currentAuthorization = async () => {
    const r = await callApi<{ authorization: Authorization | null }>(`/api/reviews/${jobId}`);
    if (!r.ok || !r.data.authorization) throw new Error("authorization_not_found");
    return r.data.authorization;
  };

  /** Any World outcome other than a server-accepted approval closes this checkpoint. */
  const closeWithoutApproval = async (errorCode: string) => {
    setProof(null);
    if (settled.current) return done();
    settled.current = true;
    const auth = authorization ?? (await currentAuthorization().catch(() => null));
    if (auth) await post(`/api/authorizations/${auth.id}/cancel`, { errorCode });
    done();
  };

  const signedIn = session?.authenticated && session.github;
  const enrolled = Boolean(session?.worldEnrollment);
  const gate = !session ? "Loading…" : !signedIn ? "sign_in" : !session.world.configured ? "world_unconfigured" : !enrolled ? "enroll" : null;

  return (
    <>
      <Card
        title="Human checkpoint"
        aside={
          <EvidenceTag
            kind={authorization?.status === "approved" || authorization?.status === "consumed" ? (authorization.worldEnvironment === "production" ? "live" : "test") : "none"}
          />
        }
      >
        <div className="space-y-3 text-sm">
          {session?.world.configured && (
            <p className={session.world.environment === "staging" ? "text-xs text-caution" : "text-xs text-muted"}>{WORLD_ENV_LABEL[session.world.environment]}</p>
          )}

          {authorization ? <OperationView authorization={authorization} /> : null}

          {gate === "sign_in" && (
            <p className="text-muted">
              <Link href="/maintainer">Sign in with GitHub</Link> to review this release.
            </p>
          )}
          {gate === "world_unconfigured" && <p className="text-caution">World ID is not configured on this server.</p>}
          {gate === "enroll" && (
            <p className="text-muted">
              <Link href="/maintainer">Enroll your World ID</Link> before approving merges.
            </p>
          )}

          {!gate && authorization?.status === "pending" && (
            <div className="flex flex-wrap gap-2">
              <button onClick={approveWithWorld} disabled={busy} className="rounded-lg bg-approve px-3 py-1.5 font-semibold text-midnight disabled:opacity-50">
                Approve with World ID
              </button>
              <button
                onClick={async () => {
                  await post(`/api/authorizations/${authorization.id}/deny`, { reason: "maintainer_rejected" });
                  done();
                }}
                disabled={busy}
                className="rounded-lg border border-caution/60 px-3 py-1.5 text-caution disabled:opacity-50"
              >
                Deny
              </button>
            </div>
          )}

          {!gate && AUTHORIZABLE.includes(jobState) && authorization?.status !== "pending" && (
            paidReview?.reportConclusion === "pass" ? (
              <button onClick={requestAuthorization} disabled={busy} className="rounded-lg bg-brand px-3 py-1.5 font-semibold text-white disabled:opacity-50">
                Review exact merge operation
              </button>
            ) : (
              <p className="text-muted">Only a paid review with no blocking findings can be authorized.</p>
            )
          )}

          {!authorization && !AUTHORIZABLE.includes(jobState) && jobState !== "approval_pending" && (
            <p className="text-muted">Authorization opens once a paid review of this exact commit is confirmed.</p>
          )}
          {error && <p className="text-caution">{error}</p>}
        </div>
      </Card>

      <Card title="Merge" aside={<EvidenceTag kind={mergeAttempt?.status === "merged" ? "live" : "none"} />}>
        <div className="space-y-3 text-sm">
          {mergeAttempt ? (
            <MergeAttemptView attempt={mergeAttempt} />
          ) : (
            <p className="text-muted">No merge attempted. ShipLock merges only the approved SHA, once.</p>
          )}
          {!gate && authorization?.status === "approved" && !mergeAttempt && (
            <button
              onClick={async () => {
                await post(`/api/merges/${authorization.id}/execute`);
                done();
              }}
              disabled={busy}
              className="rounded-lg bg-approve px-3 py-1.5 font-semibold text-midnight disabled:opacity-50"
            >
              Merge {authorization.operation.headSha.slice(0, 12)}
            </button>
          )}
          {!gate && mergeAttempt?.status === "uncertain" && (
            <button
              onClick={async () => {
                await post(`/api/merges/${mergeAttempt.authorizationId}/reconcile`);
                done();
              }}
              disabled={busy}
              className="rounded-lg border border-line px-3 py-1.5 disabled:opacity-50"
            >
              Reconcile with GitHub
            </button>
          )}
        </div>
      </Card>

      {proof && (
        <IDKitSessionWidget
          open
          onOpenChange={(open) => !open && void closeWithoutApproval("closed")}
          app_id={proof.app_id}
          rp_context={proof.rp_context}
          environment={proof.environment}
          existing_session_id={proof.existing_session_id}
          require_user_presence={proof.require_user_presence}
          action_description="Approve one ShipLock merge of the exact commit shown"
          constraints={CredentialRequest("proof_of_human", { signal: proof.signal })}
          handleVerify={submitApproval}
          onSuccess={() => {
            setProof(null);
            done();
          }}
          onError={(code) => void closeWithoutApproval(code)}
        />
      )}
    </>
  );
}

function OperationView({ authorization }: { authorization: Authorization }) {
  const op = authorization.operation;
  return (
    <div className="space-y-2">
      <p>
        Authorization <span className="font-mono text-xs">{authorization.id}</span> ·{" "}
        <span className={authorization.status === "approved" || authorization.status === "consumed" ? "text-approve" : "text-white"}>{authorization.status}</span>
        {authorization.statusReason && <span className="text-muted"> ({authorization.statusReason})</span>}
      </p>
      <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1 text-xs">
        <dt className="text-muted">Action</dt>
        <dd className="font-mono">
          {op.action} ({op.mergeMethod})
        </dd>
        <dt className="text-muted">Repository</dt>
        <dd className="font-mono">
          {op.repository} · id {op.repositoryId}
        </dd>
        <dt className="text-muted">Pull request</dt>
        <dd className="font-mono">
          #{op.pullNumber} → {op.baseRef}
        </dd>
        <dt className="text-muted">Head SHA</dt>
        <dd>
          <Sha value={op.headSha} />
        </dd>
        <dt className="text-muted">Review digest</dt>
        <dd>
          <Sha value={op.reportSha256} />
        </dd>
        <dt className="text-muted">Approver</dt>
        <dd className="font-mono">@{op.approverGithubLogin}</dd>
        <dt className="text-muted">Expires</dt>
        <dd className="font-mono">{new Date(op.expiresAt).toLocaleTimeString()}</dd>
        <dt className="text-muted">Signed hash</dt>
        <dd>
          <Sha value={authorization.operationHash} />
        </dd>
      </dl>
    </div>
  );
}

function MergeAttemptView({ attempt }: { attempt: MergeAttempt }) {
  return (
    <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1 text-xs">
      <dt className="text-muted">Result</dt>
      <dd className={attempt.status === "merged" ? "text-approve" : "text-caution"}>
        {attempt.status}
        {attempt.reason ? ` — ${attempt.reason}` : ""}
      </dd>
      <dt className="text-muted">Expected SHA</dt>
      <dd>
        <Sha value={attempt.expectedSha} />
      </dd>
      {attempt.githubHttpStatus !== null && (
        <>
          <dt className="text-muted">GitHub HTTP</dt>
          <dd className="font-mono">{attempt.githubHttpStatus}</dd>
        </>
      )}
      {attempt.mergeCommitSha && (
        <>
          <dt className="text-muted">Merge commit</dt>
          <dd>
            <Sha value={attempt.mergeCommitSha} />
          </dd>
        </>
      )}
      {attempt.mergeUrl && (
        <>
          <dt className="text-muted">Pull request</dt>
          <dd>
            <a href={attempt.mergeUrl} target="_blank" rel="noreferrer">
              {attempt.mergeUrl}
            </a>
          </dd>
        </>
      )}
    </dl>
  );
}
