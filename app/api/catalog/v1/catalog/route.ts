import { NextResponse } from "next/server";
import { fetchCatalogDocument } from "../../../../../src/integrations/catalogApiClient";

export const runtime = "nodejs";

export async function GET() {
  try {
    const catalog = await fetchCatalogDocument();
    return NextResponse.json(catalog);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    const status = message.includes("Missing catalog API URL") ? 503 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
