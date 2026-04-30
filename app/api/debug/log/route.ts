import { NextResponse } from "next/server";

export const runtime = "nodejs";

type Body = {
  sessionId?: string;
  runId?: string;
  hypothesisId?: string;
  location?: string;
  message?: string;
  data?: Record<string, unknown>;
  timestamp?: number;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as Body | null;
    if (!body || typeof body !== "object") {
      return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
    }

    // Forward to Cursor debug ingest (server-side avoids browser CORS).
    await fetch("http://127.0.0.1:7693/ingest/6941670b-535c-42ff-a30e-044389d238dd", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "1c0afb" },
      body: JSON.stringify({
        sessionId: "1c0afb",
        runId: body.runId ?? "pre-fix",
        hypothesisId: body.hypothesisId ?? "H_unknown",
        location: body.location ?? "app/api/debug/log/route.ts",
        message: body.message ?? "debug",
        data: body.data ?? {},
        timestamp: typeof body.timestamp === "number" ? body.timestamp : Date.now(),
      }),
    }).catch(() => {});

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 },
    );
  }
}

