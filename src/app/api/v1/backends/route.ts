import { NextResponse } from "next/server";
import { BACKENDS } from "@/lib/qrouter/catalog";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ object: "list", data: BACKENDS, updated_at: new Date().toISOString() });
}

