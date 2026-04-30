import type { PriceSnapshot } from "../types.js";

const COINGECKO_IDS: Record<keyof PriceSnapshot, string> = {
  BTC: "bitcoin",
  ETH: "ethereum",
  SOL: "solana",
  DOGE: "dogecoin",
};

export async function fetchCoinGeckoPrices(): Promise<PriceSnapshot> {
  const ids = Object.values(COINGECKO_IDS).join(",");
  const vs = ["gbp", "eur", "chf", "usd"].join(",");
  const url = new URL("https://api.coingecko.com/api/v3/simple/price");
  url.searchParams.set("ids", ids);
  url.searchParams.set("vs_currencies", vs);

  const res = await fetch(url.toString(), {
    headers: { accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`CoinGecko error: HTTP ${res.status}`);
  }
  const json = (await res.json()) as Record<
    string,
    Record<string, number | undefined> | undefined
  >;

  const out = {} as PriceSnapshot;
  for (const [sym, id] of Object.entries(COINGECKO_IDS) as Array<
    [keyof PriceSnapshot, string]
  >) {
    const row = json[id];
    if (!row) throw new Error(`Missing CoinGecko payload for "${id}"`);
    const gbp = row["gbp"];
    const eur = row["eur"];
    const chf = row["chf"];
    const usd = row["usd"];
    if (
      typeof gbp !== "number" ||
      typeof eur !== "number" ||
      typeof chf !== "number" ||
      typeof usd !== "number"
    ) {
      throw new Error(`Unexpected CoinGecko payload for "${id}"`);
    }
    out[sym] = { gbp, eur, chf, usd };
  }

  return out;
}

