import { NextResponse } from "next/server";
import { fetchCatalogProduct } from "../../../../../../src/integrations/catalogApiClient";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: RouteContext) {
  try {
    const { id } = await ctx.params;
    const data = await fetchCatalogProduct(decodeURIComponent(id));
    if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(data);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    const status = message.includes("Missing catalog API URL") ? 503 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
