const COOKIE_NAME = "tsa_auth";
const COOKIE_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

type Payload = {
  u: string; // username
  exp: number; // epoch ms
};

function mustGetSecret(): string {
  const s = process.env.AUTH_COOKIE_SECRET?.trim();
  if (!s) {
    throw new Error("Missing AUTH_COOKIE_SECRET");
  }
  return s;
}

function toB64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function fromB64Url(s: string): Uint8Array {
  const padLen = (4 - (s.length % 4)) % 4;
  const padded = (s + "=".repeat(padLen)).replaceAll("-", "+").replaceAll("_", "/");
  return new Uint8Array(Buffer.from(padded, "base64"));
}

async function hmacSign(data: string, secret: string): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return new Uint8Array(sig);
}

export function cookieName(): string {
  return COOKIE_NAME;
}

export async function createAuthCookieValue(username: string): Promise<string> {
  const payload: Payload = { u: username, exp: Date.now() + COOKIE_TTL_MS };
  const json = JSON.stringify(payload);
  const data = toB64Url(new TextEncoder().encode(json));
  const sig = toB64Url(await hmacSign(data, mustGetSecret()));
  return `${data}.${sig}`;
}

export async function verifyAuthCookieValue(
  value: string | undefined,
): Promise<{ ok: boolean; username?: string }> {
  if (!value) return { ok: false };
  const parts = value.split(".");
  if (parts.length !== 2) return { ok: false };
  const [data, sig] = parts;
  try {
    const expected = toB64Url(await hmacSign(data, mustGetSecret()));
    if (sig !== expected) return { ok: false };
    const payloadRaw = new TextDecoder().decode(fromB64Url(data));
    const payload = JSON.parse(payloadRaw) as Payload;
    if (!payload?.u || typeof payload.exp !== "number") return { ok: false };
    if (Date.now() > payload.exp) return { ok: false };
    return { ok: true, username: payload.u };
  } catch {
    return { ok: false };
  }
}

