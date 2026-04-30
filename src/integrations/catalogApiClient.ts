import type { Catalog, Product, ProductCategory } from "../domain/product.js";
import {
  getLocalCatalogDocument,
  getLocalCategories,
  getLocalProduct,
  getLocalProducts,
} from "./catalogLocal";

export type CatalogProductsResponse = {
  products: Product[];
  count: number;
};

export type CatalogProductResponse = {
  product: Product;
};

export type CatalogDocumentResponse = {
  products: Product[];
};

export type CatalogCategoriesResponse = {
  categories: ProductCategory[];
};

function baseUrl(): string {
  const raw = process.env.CATALOG_API_BASE_URL?.trim();
  let u = raw;

  if (!u && process.env.VERCEL && process.env.VERCEL_URL) {
    u = `https://${process.env.VERCEL_URL}/_/catalog-api`;
  }

  if (!u) {
    throw new Error(
      "Missing CATALOG_API_BASE_URL. Set it to the catalog-api origin, e.g. http://127.0.0.1:4001",
    );
  }

  if (u.startsWith("/")) {
    const host = process.env.VERCEL_URL;
    if (!host) {
      throw new Error(
        "CATALOG_API_BASE_URL is a path-only URL; set VERCEL_URL (Vercel) or use an absolute URL like http://127.0.0.1:4001",
      );
    }
    u = `https://${host}${u}`;
  }

  return u.replace(/\/$/, "");
}

function hasRemoteCatalogApi(): boolean {
  if (process.env.CATALOG_API_BASE_URL?.trim()) return true;
  if (process.env.VERCEL && process.env.VERCEL_URL) return true;
  return false;
}

function authHeaders(): HeadersInit {
  const t = process.env.CATALOG_API_TOKEN?.trim();
  if (!t) return {};
  return { Authorization: `Bearer ${t}` };
}

async function catalogFetch(pathWithQuery: string): Promise<Response> {
  const url = `${baseUrl()}${pathWithQuery}`;
  return fetch(url, { headers: authHeaders(), cache: "no-store" });
}

export async function fetchCatalogDocument(): Promise<Catalog> {
  if (!hasRemoteCatalogApi()) {
    return await getLocalCatalogDocument();
  }
  const res = await catalogFetch("/v1/catalog");
  if (!res.ok) {
    throw new Error(`catalog-api GET /v1/catalog failed: ${res.status}`);
  }
  const body = (await res.json()) as CatalogDocumentResponse;
  return { products: body.products };
}

export async function fetchCatalogCategories(): Promise<CatalogCategoriesResponse> {
  if (!hasRemoteCatalogApi()) {
    return await getLocalCategories();
  }
  const res = await catalogFetch("/v1/categories");
  if (!res.ok) {
    throw new Error(`catalog-api GET /v1/categories failed: ${res.status}`);
  }
  return (await res.json()) as CatalogCategoriesResponse;
}

export async function fetchCatalogProducts(
  searchParams: URLSearchParams,
): Promise<CatalogProductsResponse> {
  if (!hasRemoteCatalogApi()) {
    return await getLocalProducts(searchParams);
  }
  const q = new URLSearchParams(searchParams);
  const res = await catalogFetch(`/v1/products?${q.toString()}`);
  if (!res.ok) {
    throw new Error(`catalog-api GET /v1/products failed: ${res.status}`);
  }
  return (await res.json()) as CatalogProductsResponse;
}

export async function fetchCatalogProduct(
  id: string,
): Promise<CatalogProductResponse | null> {
  if (!hasRemoteCatalogApi()) {
    return await getLocalProduct(id);
  }
  const enc = encodeURIComponent(id);
  const res = await catalogFetch(`/v1/products/${enc}`);
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`catalog-api GET /v1/products/${id} failed: ${res.status}`);
  }
  return (await res.json()) as CatalogProductResponse;
}
