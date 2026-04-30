import { Redis } from "ioredis";

let client: Redis | null | undefined;

function redisUrl(): string | undefined {
  return process.env.REDIS_URL?.trim() || process.env.CATALOG_REDIS_URL?.trim();
}

function keyPrefix(): string {
  return process.env.CATALOG_INVENTORY_KEY_PREFIX?.trim() || "catalog:inventory";
}

function inventoryKey(productId: string): string {
  return `${keyPrefix()}:${productId}`;
}

export function isInventoryRedisEnabled(): boolean {
  return Boolean(redisUrl());
}

function getClient(): Redis | null {
  if (client !== undefined) return client;
  const url = redisUrl();
  if (!url) {
    client = null;
    return client;
  }

  client = new Redis(url, {
    maxRetriesPerRequest: 2,
    enableReadyCheck: true,
    lazyConnect: true,
  });

  client.on("error", (err: unknown) => {
    console.warn("[catalog-api][redis] client error:", err instanceof Error ? err.message : String(err));
  });

  return client;
}

export async function closeInventoryRedis(): Promise<void> {
  if (!client) return;
  try {
    await client.quit();
  } catch {
    try {
      client.disconnect();
    } catch {
      // ignore
    }
  } finally {
    client = undefined;
  }
}

export type InventoryRedisHealth = {
  enabled: boolean;
  ok: boolean;
  error?: string;
};

async function connectIfNeeded(c: Redis): Promise<void> {
  // ioredis throws if connect() is called while already connecting/connected.
  try {
    await c.connect();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("already connecting/connected")) return;
    throw e;
  }
}

export async function inventoryRedisHealth(): Promise<InventoryRedisHealth> {
  const c = getClient();
  if (!c) return { enabled: false, ok: true };
  try {
    await connectIfNeeded(c);
    const pong = await c.ping();
    return { enabled: true, ok: pong === "PONG" };
  } catch (e) {
    return {
      enabled: true,
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error",
    };
  }
}

function defaultSeedQty(): number {
  const raw = process.env.CATALOG_INVENTORY_DEFAULT_QTY?.trim();
  const n = raw ? Number.parseInt(raw, 10) : 10;
  return Number.isFinite(n) && n >= 0 ? n : 10;
}

export async function seedInventoryIfConfigured(productIds: string[]): Promise<void> {
  if (process.env.CATALOG_INVENTORY_SEED?.trim() !== "1") return;
  const c = getClient();
  if (!c) return;

  const qty = defaultSeedQty();
  try {
    await connectIfNeeded(c);

    const pipeline = c.pipeline();
    for (const id of productIds) {
      pipeline.set(inventoryKey(id), String(qty), "NX");
    }
    await pipeline.exec();
    console.log(
      `[catalog-api][redis] Seeded missing inventory keys (NX) for ${productIds.length} product(s), default qty=${qty}.`,
    );
  } catch (e) {
    console.warn(
      "[catalog-api][redis] Inventory seed failed (continuing without Redis inventory):",
      e instanceof Error ? e.message : String(e),
    );
  }
}

export async function getInventoryQuantities(productIds: string[]): Promise<Map<string, number | null>> {
  const out = new Map<string, number | null>();
  for (const id of productIds) out.set(id, null);

  const c = getClient();
  if (!c || productIds.length === 0) return out;

  try {
    await connectIfNeeded(c);

    const chunkSize = 500;
    for (let i = 0; i < productIds.length; i += chunkSize) {
      const chunk = productIds.slice(i, i + chunkSize);
      const keys = chunk.map(inventoryKey);
      const values = await c.mget(...keys);
      for (let j = 0; j < chunk.length; j++) {
        const raw = values[j];
        if (raw == null) {
          out.set(chunk[j]!, null);
          continue;
        }
        const n = Number.parseInt(raw, 10);
        out.set(chunk[j]!, Number.isFinite(n) ? n : null);
      }
    }
  } catch (e) {
    console.warn(
      "[catalog-api][redis] Inventory read failed (continuing without Redis inventory):",
      e instanceof Error ? e.message : String(e),
    );
  }

  return out;
}
