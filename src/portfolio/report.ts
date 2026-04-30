import type { FiatCurrency, PriceSnapshot, PurchaseLot } from "./types.js";

export type LotPnl = {
  lot: PurchaseLot;
  costBasis: number;
  currentPrice: number;
  currentValue: number;
  pnl: number;
  pct: number;
  gbpCostBasis: number;
  gbpValue: number;
  gbpPnl: number;
};

export type AssetSummary = {
  symbol: PurchaseLot["symbol"];
  totalQty: number;
  lots: LotPnl[];
  gbpValue: number;
  gbpCostBasis: number;
  gbpPnl: number;
};

export type PortfolioReport = {
  asOf: Date;
  fxToGbp: Record<FiatCurrency, number>;
  byAsset: AssetSummary[];
  total: {
    gbpValue: number;
    gbpCostBasis: number;
    gbpPnl: number;
  };
};

function safePct(pnl: number, cost: number): number {
  if (!Number.isFinite(cost) || cost === 0) return 0;
  return (pnl / cost) * 100;
}

export function deriveFxToGbp(
  prices: PriceSnapshot,
  baseSymbol: keyof PriceSnapshot = "BTC",
): Record<FiatCurrency, number> {
  const p = prices[baseSymbol];
  const gbp = p.gbp;
  return {
    GBP: 1,
    EUR: gbp / p.eur,
    CHF: gbp / p.chf,
    USD: gbp / p.usd,
  };
}

export function buildPortfolioReport(args: {
  lots: PurchaseLot[];
  prices: PriceSnapshot;
  asOf?: Date;
  includeFeesInCostBasis?: boolean;
}): PortfolioReport {
  const {
    lots,
    prices,
    asOf = new Date(),
    includeFeesInCostBasis = true,
  } = args;

  const fxToGbp = deriveFxToGbp(prices, "BTC");

  const lotPnls: LotPnl[] = lots
    .filter((l) => l.symbol !== "FIS")
    .map((lot) => {
      const symbol = lot.symbol as keyof PriceSnapshot;
      const row = prices[symbol];
      const currency = lot.currency;
      const currentPrice =
        row[currency.toLowerCase() as keyof typeof row] ?? NaN;
      if (!Number.isFinite(currentPrice)) {
        throw new Error(`Missing price for ${lot.symbol} in ${lot.currency}`);
      }

      const costBasis =
        lot.invested + (includeFeesInCostBasis ? (lot.fees ?? 0) : 0);
      const currentValue = lot.qty * currentPrice;
      const pnl = currentValue - costBasis;

      const gbpValue = lot.qty * row.gbp;
      const gbpCostBasis = costBasis * fxToGbp[currency];
      const gbpPnl = gbpValue - gbpCostBasis;

      return {
        lot,
        costBasis,
        currentPrice,
        currentValue,
        pnl,
        pct: safePct(pnl, costBasis),
        gbpCostBasis,
        gbpValue,
        gbpPnl,
      };
    });

  const byAssetMap = new Map<PurchaseLot["symbol"], AssetSummary>();
  for (const lp of lotPnls) {
    const sym = lp.lot.symbol;
    const curr = byAssetMap.get(sym);
    const base: AssetSummary =
      curr ?? ({
        symbol: sym,
        totalQty: 0,
        lots: [],
        gbpValue: 0,
        gbpCostBasis: 0,
        gbpPnl: 0,
      } satisfies AssetSummary);

    base.totalQty += lp.lot.qty;
    base.lots.push(lp);
    base.gbpValue += lp.gbpValue;
    base.gbpCostBasis += lp.gbpCostBasis;
    base.gbpPnl += lp.gbpPnl;

    byAssetMap.set(sym, base);
  }

  const byAsset = Array.from(byAssetMap.values()).sort((a, b) =>
    a.symbol.localeCompare(b.symbol),
  );

  const total = byAsset.reduce(
    (acc, a) => {
      acc.gbpValue += a.gbpValue;
      acc.gbpCostBasis += a.gbpCostBasis;
      acc.gbpPnl += a.gbpPnl;
      return acc;
    },
    { gbpValue: 0, gbpCostBasis: 0, gbpPnl: 0 },
  );

  return { asOf, fxToGbp, byAsset, total };
}

