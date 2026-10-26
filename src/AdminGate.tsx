import { useEffect, useState, type ReactNode } from "react";
import { ArrowLeft, Leaf, LockKeyhole } from "lucide-react";
import "./admin.css";

type Session = { configured: boolean; signedIn: boolean; unreachable?: boolean };

/**
 * Shows the owner sign-in until the server confirms a session, then renders the admin pages.
 * The server is the source of truth: admin data and Claude mode check the session cookie too.
 */
export function AdminGate({ children, onExit }: { children: (signOut: () => void) => ReactNode; onExit: () => void }) {
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/admin/session")
      .then((response) => response.json() as Promise<Session>)
      .then((result) => { if (active) setSession(result); })
      .catch(() => { if (active) setSession({ configured: false, signedIn: false, unreachable: true }); });
    return () => { active = false; };
  }, []);

  async function signOut() {
    await fetch("/api/admin/logout", { method: "POST" }).catch(() => undefined);
    setSession((current) => ({ configured: current?.configured ?? true, signedIn: false }));
  }

  if (!session) return <div className="admin-loading" role="status">Checking your sign-in…</div>;
  if (!session.signedIn) return <SignIn session={session} onSignedIn={() => setSession({ ...session, signedIn: true })} onExit={onExit} />;
  return <>{children(signOut)}</>;
}

function SignIn({ session, onSignedIn, onExit }: { session: Session; onSignedIn: () => void; onExit: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Couldn’t sign in. Please try again.");
      setPassword("");
      onSignedIn();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Couldn’t sign in. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const unavailable = session.unreachable
    ? "Couldn’t reach the server. Start the site with npm run dev and reload."
    : !session.configured
      ? "Sign-in isn’t set up yet. Add OWNER_PASSWORD to the server’s .env file and restart npm run dev."
      : "";

  return (
    <main className="signin-page">
      <form className="signin-card" onSubmit={submit}>
        <span className="signin-brand">
          <span className="brand-mark" aria-hidden="true"><Leaf size={20} strokeWidth={1.7} /></span>
          <span>fig <i>&amp;</i> froth</span>
        </span>
        <h1>Behind the <em>counter.</em></h1>
        <p className="signin-lede"><LockKeyhole size={16} aria-hidden="true" /> Staff sign-in</p>
        {unavailable ? <p className="signin-error" role="alert">{unavailable}</p> : <>
          <label>
            Password
            <input type="password" name="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required autoFocus />
          </label>
          {error && <p className="signin-error" role="alert">{error}</p>}
          <button className="button button-dark signin-submit" type="submit" disabled={busy || !password}>{busy ? "Signing in…" : "Sign in"}</button>
        </>}
        <button type="button" className="text-button signin-back" onClick={onExit}><ArrowLeft size={15} /> Back to the site</button>
      </form>
    </main>
  );
}
