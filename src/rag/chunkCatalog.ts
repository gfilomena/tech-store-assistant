import type { Catalog, CatalogChunk, Product } from "../domain/product";

function formatSpecs(specs: Record<string, string>): string {
  return Object.entries(specs)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
}

function overviewChunk(product: Product): CatalogChunk {
  const lines = [
    `Product: ${product.name}`,
    `ID: ${product.id}`,
    `Brand: ${product.brand}`,
    `Category: ${product.category}`,
    `Price: ${product.price} ${product.currency}`,
    "",
    product.description,
  ];
  return {
    chunkId: `${product.id}:overview`,
    productId: product.id,
    section: "overview",
    text: lines.join("\n"),
  };
}

function specsChunk(product: Product): CatalogChunk {
  const text = [
    `Product: ${product.name} (${product.id})`,
    "Specifications:",
    formatSpecs(product.specs),
  ].join("\n");
  return {
    chunkId: `${product.id}:specs`,
    productId: product.id,
    section: "specs",
    text,
  };
}

function faqChunks(product: Product): CatalogChunk[] {
  if (!product.faqs?.length) return [];
  return product.faqs.map((faq, index) => ({
    chunkId: `${product.id}:faq:${index}`,
    productId: product.id,
    section: "faq" as const,
    text: [
      `Product: ${product.name} (${product.id})`,
      `FAQ: ${faq.question}`,
      `Answer: ${faq.answer}`,
    ].join("\n"),
  }));
}

/** RAG ingestion: convert the structured product catalog into small text chunks for embedding + retrieval. */
export function chunkCatalog(catalog: Catalog): CatalogChunk[] {
  const out: CatalogChunk[] = [];
  for (const product of catalog.products) {
    out.push(overviewChunk(product));
    out.push(specsChunk(product));
    out.push(...faqChunks(product));
  }
  return out;
}
