export type ProductCategory =
  | "tv"
  | "smartphone"
  | "laptop"
  | "appliance"
  | "audio"
  | "wearable";

export type ChunkSection = "overview" | "specs" | "faq";

export type ProductFaq = {
  question: string;
  answer: string;
};

export type Product = {
  id: string;
  name: string;
  category: ProductCategory;
  brand: string;
  price: number;
  currency: string;
  description: string;
  specs: Record<string, string>;
  faqs?: ProductFaq[];
  /**
   * Units in stock (when catalog-api is configured with Redis inventory).
   * Omitted when Redis is not enabled or the key is missing.
   */
  inStock?: number;
};

export type Catalog = {
  products: Product[];
};

export type CatalogChunk = {
  chunkId: string;
  productId: string;
  section: ChunkSection;
  text: string;
};

export type EmbeddedChunk = CatalogChunk & {
  embedding: number[];
};

export type StoreLocale = "it" | "en";

export type StoreRagQuery = {
  question: string;
  locale?: StoreLocale;
  topK?: number;
  /** Authoritative total products in the RAG catalog file (injected by the API). */
  catalogProductCount?: number;
};

export type RagSource = {
  productId: string;
  chunkId: string;
  score: number;
};

export type StoreRagAnswer = {
  answer: string;
  sources: RagSource[];
  chatModel?: string;
  embeddingModel?: string;
};

export function parseCatalog(raw: unknown): Catalog {
  if (!raw || typeof raw !== "object") {
    throw new Error("Catalog must be a JSON object");
  }
  const obj = raw as { products?: unknown };
  if (!Array.isArray(obj.products)) {
    throw new Error('Catalog must have a "products" array');
  }
  return { products: obj.products as Product[] };
}
