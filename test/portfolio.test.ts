import { describe, expect, it, vi } from "vitest";
import {
  buildPortfolioReport,
  fetchCoinGeckoPrices,
  parseMarkdownPurchases,
} from "../src/portfolio/index.js";

describe("parseMarkdownPurchases", () => {
  it("parses lots from the All Purchases table (incl. commas)", () => {
    const md = `
## All Purchases (do not change this section)

| Symbol | Date | Qty | Buy Price | Invested | Fees | Currency |
|--------|------|-----|-----------|----------|------|----------|
| DOGE | Mar 5, 2026 | 13,795.96958133 | 0.0725 | 1,000.00 | 7.89 | GBP |
| BTC | Mar 19, 2026 | 0.0184206 | 54,287.02 | 1,000.00 | 7.89 | GBP |

---
`;
    const lots = parseMarkdownPurchases(md);
    expect(lots).toHaveLength(2);
    expect(lots[0]?.symbol).toBe("DOGE");
    expect(lots[0]?.qty).toBeCloseTo(13795.96958133);
    expect(lots[0]?.invested).toBe(1000);
    expect(lots[1]?.buyPrice).toBeCloseTo(54287.02);
  });
});

describe("buildPortfolioReport", () => {
  it("computes P&L and GBP totals using derived FX", () => {
    const lots = parseMarkdownPurchases(`
## All Purchases (do not change this section)

| Symbol | Date | Qty | Buy Price | Invested | Fees | Currency |
|--------|------|-----|-----------|----------|------|----------|
| BTC | Feb 6, 2026 | 0.1 | 60000 | 10000.00 | 100.00 | USD |
| ETH | Feb 28, 2026 | 1 | 1500 | 1000.00 | 0.00 | GBP |

---
`);

    const prices = {
      BTC: { gbp: 50000, eur: 60000, chf: 55000, usd: 65000 },
      ETH: { gbp: 2000, eur: 2400, chf: 2200, usd: 2600 },
      SOL: { gbp: 100, eur: 120, chf: 110, usd: 130 },
      DOGE: { gbp: 0.08, eur: 0.096, chf: 0.088, usd: 0.104 },
    } as const;

    const report = buildPortfolioReport({ lots, prices, asOf: new Date(0) });
    // BTC current value in USD = 0.1 * 65000 = 6500; cost basis = 10100 => pnl = -3600
    const btc = report.byAsset.find((a) => a.symbol === "BTC");
    expect(btc?.lots[0]?.pnl).toBeCloseTo(-3600);

    // Derived FX USD->GBP = BTC_gbp / BTC_usd = 50000 / 65000
    const usdToGbp = 50000 / 65000;
    const btcGbpCost = 10100 * usdToGbp;
    const btcGbpVal = 0.1 * 50000;
    expect(btc?.lots[0]?.gbpCostBasis).toBeCloseTo(btcGbpCost);
    expect(btc?.lots[0]?.gbpValue).toBeCloseTo(btcGbpVal);

    // Total GBP is sum of BTC+ETH
    expect(report.total.gbpValue).toBeCloseTo(btcGbpVal + 2000);
  });
});

describe("fetchCoinGeckoPrices", () => {
  it("maps CoinGecko ids to symbol snapshot", async () => {
    const fetchMock = vi.fn(async () => {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          bitcoin: { gbp: 1, eur: 2, chf: 3, usd: 4 },
          ethereum: { gbp: 5, eur: 6, chf: 7, usd: 8 },
          solana: { gbp: 9, eur: 10, chf: 11, usd: 12 },
          dogecoin: { gbp: 13, eur: 14, chf: 15, usd: 16 },
        }),
      };
    });

    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    const prices = await fetchCoinGeckoPrices();
    expect(prices.BTC.gbp).toBe(1);
    expect(prices.ETH.usd).toBe(8);
    expect(fetchMock).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

