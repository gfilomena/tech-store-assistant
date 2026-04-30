import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  buildPortfolioReport,
  fetchCoinGeckoPrices,
  formatReportMarkdown,
  parseMarkdownPurchases,
} from "../src/portfolio/index.js";

async function main() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    throw new Error(
      'Usage: npm run dev -- examples/crypto-portfolio.ts -- "/path/to/crypto_portfolio_tracker.md"',
    );
  }

  const md = await readFile(resolve(inputPath), "utf8");
  const lots = parseMarkdownPurchases(md);
  const prices = await fetchCoinGeckoPrices();
  const report = buildPortfolioReport({ lots, prices, includeFeesInCostBasis: true });
  process.stdout.write(formatReportMarkdown(report));
  process.stdout.write("\n");
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});

