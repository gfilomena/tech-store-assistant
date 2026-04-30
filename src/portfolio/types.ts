export type AssetSymbol = "BTC" | "ETH" | "SOL" | "DOGE" | "FIS";

export type FiatCurrency = "GBP" | "EUR" | "CHF" | "USD";

export type PurchaseLot = {
  symbol: AssetSymbol;
  date: string;
  qty: number;
  buyPrice: number;
  invested: number;
  fees?: number;
  currency: FiatCurrency;
};

export type PriceSnapshot = Record<
  Exclude<AssetSymbol, "FIS">,
  Record<Lowercase<FiatCurrency>, number>
>;

