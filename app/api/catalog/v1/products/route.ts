import { NextResponse } from "next/server";
import { fetchCatalogProducts } from "../../../../../src/integrations/catalogApiClient";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const data = await fetchCatalogProducts(url.searchParams);
    return NextResponse.json(data);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    const status = message.includes("Missing CATALOG_API_BASE_URL") ? 503 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
