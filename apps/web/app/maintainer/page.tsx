import { MaintainerPanel } from "@/components/maintainer-panel";

export const dynamic = "force-dynamic";

const LOGIN_MESSAGE: Record<string, string> = {
  ok: "Signed in with GitHub.",
  cancelled: "GitHub sign-in was cancelled.",
  invalid_state: "GitHub sign-in could not be verified (expired or mismatched state). Try again.",
  github_error: "GitHub sign-in failed.",
};

export default async function MaintainerPage({ searchParams }: { searchParams: Promise<{ login?: string }> }) {
  const { login } = await searchParams;
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Maintainer</h1>
        <p className="mt-1 text-sm text-muted">
          A merge needs three separate things: a GitHub identity with write access to the repository, a World ID proof of human
          enrolled to that identity, and a fresh World ID approval of the exact commit.
        </p>
      </div>
      <MaintainerPanel loginMessage={login ? LOGIN_MESSAGE[login] : undefined} />
    </div>
  );
}
