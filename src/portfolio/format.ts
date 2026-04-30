import type { PortfolioReport } from "./report.js";

function money(amount: number, currency: string): string {
  const sign = amount < 0 ? "-" : "";
  const abs = Math.abs(amount);
  const formatted = abs.toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${sign}${currency}${formatted}`;
}

function pct(n: number): string {
  const sign = n < 0 ? "-" : "";
  return `${sign}${Math.abs(n).toFixed(2)}%`;
}

export function formatReportMarkdown(report: PortfolioReport): string {
  const lines: string[] = [];
  lines.push(`## Portfolio P&L (GBP total)`);
  lines.push(``);
  lines.push(`As of: ${report.asOf.toISOString()}`);
  lines.push(``);
  lines.push(
    `Total value: **${money(report.total.gbpValue, "£")}** — Cost basis (GBP equiv.): **${money(report.total.gbpCostBasis, "£")}** — P&L: **${money(report.total.gbpPnl, "£")}**`,
  );
  lines.push(``);

  for (const asset of report.byAsset) {
    lines.push(`### ${asset.symbol}`);
    lines.push(``);
    lines.push(
      `Total qty: **${asset.totalQty.toLocaleString("en-GB", {
        maximumFractionDigits: 8,
      })}** — Value (GBP): **${money(asset.gbpValue, "£")}** — P&L (GBP): **${money(asset.gbpPnl, "£")}**`,
    );
    lines.push(``);
    lines.push(
      `| Date | Qty | Buy Price | Cost Basis | Current Price | Current Value | P&L | % | Currency |`,
    );
    lines.push(
      `|------|-----:|----------:|-----------:|--------------:|--------------:|----:|--:|:--------|`,
    );

    for (const lp of asset.lots) {
      const c = lp.lot.currency;
      const curPrefix =
        c === "GBP" ? "£" : c === "EUR" ? "€" : c === "USD" ? "$" : "";
      const buy = money(lp.lot.buyPrice, curPrefix);
      const cost = money(lp.costBasis, curPrefix);
      const curPrice = money(lp.currentPrice, curPrefix);
      const curValue = money(lp.currentValue, curPrefix);
      const pnl = money(lp.pnl, curPrefix);

      lines.push(
        `| ${lp.lot.date} | ${lp.lot.qty.toLocaleString("en-GB", {
          maximumFractionDigits: 8,
        })} | ${buy} | ${cost} | ${curPrice} | ${curValue} | ${pnl} | ${pct(
          lp.pct,
        )} | ${c} |`,
      );
    }
    lines.push(``);
  }

  return lines.join("\n");
}

