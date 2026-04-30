import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const { fetchCatalogProducts } = await import(
      "../../../../../src/integrations/catalogApiClient"
    );
    const url = new URL(req.url);
    const data = await fetchCatalogProducts(url.searchParams);
    return NextResponse.json(data);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    const status = message.includes("Missing catalog API URL") ? 503 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
