"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { SessionInfo } from "@/lib/api";
import { callApi, loadSession } from "@/lib/client";

export function SessionBar() {
  const [session, setSession] = useState<SessionInfo | null>(null);

  useEffect(() => {
    loadSession().then((r) => r.ok && setSession(r.data));
  }, []);

  if (!session) return null;
  if (!session.authenticated || !session.github) {
    return (
      <Link href="/maintainer" className="text-sm text-muted hover:text-white">
        Maintainer sign-in
      </Link>
    );
  }
  const logout = async () => {
    await callApi("/api/auth/logout", { method: "POST", csrf: session.csrfToken });
    window.location.assign("/");
  };
  return (
    <div className="flex items-center gap-3 text-sm">
      <Link href="/maintainer" className="text-white">
        @{session.github.login}
      </Link>
      <span className={session.worldEnrollment ? "text-approve" : "text-caution"}>{session.worldEnrollment ? "World ID enrolled" : "not enrolled"}</span>
      <button onClick={logout} className="text-muted hover:text-white">
        Sign out
      </button>
    </div>
  );
}
