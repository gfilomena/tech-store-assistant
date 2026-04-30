import type { PurchaseLot } from "./types.js";

function parseNumber(raw: string): number {
  const cleaned = raw.replace(/[,£€$]/g, "").trim();
  const n = Number(cleaned);
  if (!Number.isFinite(n)) {
    throw new Error(`Invalid number: "${raw}"`);
  }
  return n;
}

function parseRowCells(line: string): string[] {
  // Markdown table row: | a | b | ... |
  const trimmed = line.trim();
  if (!trimmed.startsWith("|")) return [];
  return trimmed
    .split("|")
    .slice(1, -1)
    .map((c) => c.trim());
}

export function parseMarkdownPurchases(markdown: string): PurchaseLot[] {
  const lines = markdown.split(/\r?\n/);
  const startIdx = lines.findIndex((l) =>
    l.toLowerCase().includes("## all purchases"),
  );
  if (startIdx < 0) {
    throw new Error('Could not find section "All Purchases"');
  }

  // Find the first table row after the header.
  let headerIdx = -1;
  for (let i = startIdx; i < lines.length; i++) {
    if (lines[i]?.trim().startsWith("| Symbol |")) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx < 0) {
    throw new Error('Could not find purchases table header "| Symbol |"');
  }

  // Data rows start after the separator row.
  let i = headerIdx + 1;
  while (i < lines.length && !lines[i]?.includes("---")) {
    if (lines[i]?.includes("|--------")) {
      i++;
      break;
    }
    i++;
  }

  const lots: PurchaseLot[] = [];
  for (; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (!line.trim()) continue;
    if (line.trim().startsWith("---")) break;
    if (!line.trim().startsWith("|")) continue;

    const cells = parseRowCells(line);
    if (cells.length === 0) continue;
    if (cells[0]?.toLowerCase() === "symbol") continue;
    if (cells[0]?.includes("----")) continue;

    // Expected header in your doc:
    // | Symbol | Date | Qty | Buy Price | Invested | Fees | Currency |
    const [
      symbolRaw,
      dateRaw,
      qtyRaw,
      buyPriceRaw,
      investedRaw,
      feesRaw,
      currencyRaw,
    ] = cells;

    if (!symbolRaw || !dateRaw || !qtyRaw || !buyPriceRaw || !investedRaw) {
      continue;
    }
    if (!currencyRaw) {
      throw new Error(`Missing currency in row: "${line}"`);
    }

    const symbol = symbolRaw.toUpperCase() as PurchaseLot["symbol"];
    const currency = currencyRaw.toUpperCase() as PurchaseLot["currency"];

    lots.push({
      symbol,
      date: dateRaw,
      qty: parseNumber(qtyRaw),
      buyPrice: parseNumber(buyPriceRaw),
      invested: parseNumber(investedRaw),
      fees: feesRaw ? parseNumber(feesRaw) : undefined,
      currency,
    });
  }

  return lots;
}

