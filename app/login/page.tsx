export const runtime = "nodejs";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const sp = await searchParams;
  const next = (sp.next || "/").toString();
  const showError = sp.error === "1";

  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
      <form
        action="/api/auth/login"
        method="post"
        style={{
          width: "100%",
          maxWidth: 420,
          border: "1px solid rgba(0,0,0,0.12)",
          borderRadius: 12,
          padding: 20,
          background: "white",
        }}
      >
        <h1 style={{ marginTop: 0, marginBottom: 16, fontSize: 20 }}>Sign in</h1>

        {showError ? (
          <div
            style={{
              background: "rgba(220, 38, 38, 0.08)",
              border: "1px solid rgba(220, 38, 38, 0.25)",
              borderRadius: 8,
              padding: 10,
              marginBottom: 12,
              color: "#991B1B",
              fontSize: 14,
            }}
          >
            Invalid username or password.
          </div>
        ) : null}

        <input type="hidden" name="next" value={next} />

        <label style={{ display: "block", marginBottom: 12 }}>
          <div style={{ fontSize: 13, marginBottom: 6, opacity: 0.85 }}>Username</div>
          <input
            name="username"
            autoComplete="username"
            required
            style={{
              width: "100%",
              height: 40,
              borderRadius: 8,
              border: "1px solid rgba(0,0,0,0.18)",
              padding: "0 12px",
            }}
          />
        </label>

        <label style={{ display: "block", marginBottom: 16 }}>
          <div style={{ fontSize: 13, marginBottom: 6, opacity: 0.85 }}>Password</div>
          <input
            type="password"
            name="password"
            autoComplete="current-password"
            required
            style={{
              width: "100%",
              height: 40,
              borderRadius: 8,
              border: "1px solid rgba(0,0,0,0.18)",
              padding: "0 12px",
            }}
          />
        </label>

        <button
          type="submit"
          style={{
            width: "100%",
            height: 40,
            borderRadius: 8,
            border: "1px solid rgba(0,0,0,0.18)",
            background: "#111827",
            color: "white",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Sign in
        </button>
      </form>
    </main>
  );
}

