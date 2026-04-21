import { useState } from "react";
import { login } from "../lib/api";

export function Login({ onOk }: { onOk: () => void }) {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    const ok = await login(pw);
    setBusy(false);
    if (ok) onOk();
    else setErr("access denied");
  }

  return (
    <div className="min-h-screen flex items-center justify-center">
      <form
        onSubmit={submit}
        className="border border-term-line bg-term-panel p-6 w-[360px] shadow-[0_0_30px_rgba(86,211,100,0.1)]"
      >
        <div className="text-term-greenBright font-bold tracking-[0.2em] mb-1">♥ KALSHI DIAGNOSTICS</div>
        <div className="text-term-dim text-[11px] mb-4">AUTHORIZATION REQUIRED</div>
        <input
          autoFocus
          type="password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          placeholder="password"
          className="w-full bg-term-bg border border-term-line px-3 py-2 font-mono text-term-text focus:outline-none focus:border-term-greenBright"
        />
        {err && <div className="text-term-red text-[11px] mt-2">&gt; {err}</div>}
        <button
          disabled={busy}
          className="mt-4 w-full border border-term-greenBright text-term-greenBright py-2 font-bold tracking-[0.2em] text-[12px] hover:bg-term-greenBright/10 disabled:opacity-50"
        >
          {busy ? "AUTHENTICATING…" : "ENTER"}
        </button>
      </form>
    </div>
  );
}
