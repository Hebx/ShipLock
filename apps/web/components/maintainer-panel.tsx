"use client";

import { any, CredentialRequest, IDKitRequestWidget, type IDKitResult } from "@worldcoin/idkit";
import { useCallback, useEffect, useState } from "react";
import type { EnrollmentRequest, SessionInfo } from "@/lib/api";
import { callApi, HUMAN_CREDENTIALS, loadSession, WORLD_ENV_LABEL } from "@/lib/client";
import { Card, EvidenceTag } from "./ui";

export function MaintainerPanel({ loginMessage }: { loginMessage?: string }) {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [request, setRequest] = useState<EnrollmentRequest | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const r = await loadSession();
    if (r.ok) setSession(r.data);
    else setError(r.error);
  }, []);
  useEffect(() => void refresh(), [refresh]);

  if (!session) return <p className="text-sm text-muted">{error ?? "Loading…"}</p>;

  const startEnrollment = async () => {
    setBusy(true);
    setError(null);
    const r = await callApi<EnrollmentRequest>("/api/world/enrollment/start", { method: "POST", body: {}, csrf: session.csrfToken });
    setBusy(false);
    if (r.ok) setRequest(r.data);
    else setError(r.error);
  };

  /** The server verifies the proof with World; a thrown error makes the widget show failure. */
  const completeEnrollment = async (idkitResult: IDKitResult) => {
    const r = await callApi("/api/world/enrollment/complete", {
      method: "POST",
      body: { requestId: request!.requestId, idkitResult },
      csrf: session.csrfToken,
    });
    if (!r.ok) {
      setError(r.error);
      throw new Error(r.error);
    }
  };

  return (
    <div className="space-y-6">
      {loginMessage && <p className="rounded-xl border border-line bg-panel-2 p-3 text-sm">{loginMessage}</p>}
      {error && <p className="rounded-xl border border-caution/40 bg-caution/5 p-3 text-sm text-caution">{error}</p>}

      <Card title="1 · GitHub identity" aside={<EvidenceTag kind={session.authenticated ? "live" : "none"} />}>
        {session.authenticated && session.github ? (
          <p className="text-sm">
            Signed in as <span className="font-mono">@{session.github.login}</span> (id {session.github.id}). Repository permission is
            re-checked live with GitHub on every approval and merge.
          </p>
        ) : session.githubOAuthConfigured ? (
          <a href="/api/auth/github/start" className="inline-flex rounded-lg bg-white px-4 py-2 text-sm font-semibold text-midnight">
            Sign in with GitHub
          </a>
        ) : (
          <p className="text-sm text-caution">GitHub sign-in is not configured on this server (GITHUB_OAUTH_CLIENT_ID / SECRET).</p>
        )}
      </Card>

      <Card
        title="2 · World ID proof of human"
        aside={<EvidenceTag kind={!session.worldEnrollment ? "none" : session.worldEnrollment.environment === "production" ? "live" : "test"} />}
      >
        {!session.world.configured ? (
          <p className="text-sm text-caution">World ID is not configured on this server (WORLD_APP_ID / WORLD_RP_ID / WORLD_RP_SIGNING_KEY).</p>
        ) : (
          <div className="space-y-3 text-sm">
            <p className={session.world.environment === "staging" ? "text-caution" : "text-muted"}>{WORLD_ENV_LABEL[session.world.environment]}</p>
            {!session.authenticated ? (
              <p className="text-muted">Sign in with GitHub first.</p>
            ) : session.worldEnrollment ? (
              <p>
                Enrolled {new Date(session.worldEnrollment.enrolledAt).toLocaleString()}. One World ID can be enrolled to one GitHub account.
                Each merge still needs its own fresh approval.
              </p>
            ) : (
              <>
                <p className="text-muted">
                  Prove you are a unique human once. ShipLock stores the World ID session and nullifier — never your identity — and binds
                  them to this GitHub account.
                </p>
                <button
                  onClick={startEnrollment}
                  disabled={busy}
                  className="rounded-lg bg-brand px-4 py-2 font-semibold text-white disabled:opacity-50"
                >
                  Enroll with World ID
                </button>
              </>
            )}
          </div>
        )}
      </Card>

      {request && (
        <IDKitRequestWidget
          open
          onOpenChange={(open) => !open && setRequest(null)}
          app_id={request.app_id}
          action={request.action}
          rp_context={request.rp_context}
          environment={request.environment}
          allow_legacy_proofs={false}
          session_id="create"
          require_user_presence={request.require_user_presence}
          constraints={any(...HUMAN_CREDENTIALS.map((c) => CredentialRequest(c, { signal: request.signal })))}
          handleVerify={completeEnrollment}
          onSuccess={async () => {
            setRequest(null);
            await refresh();
          }}
          onError={(code) => {
            if (code !== "failed_by_host_app") setError(`World ID: ${code}`);
          }}
        />
      )}
    </div>
  );
}
