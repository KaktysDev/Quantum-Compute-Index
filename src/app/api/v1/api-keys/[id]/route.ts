import { NextResponse } from "next/server";
import { resolvePrincipal } from "@/lib/qrouter/auth";
import { apiError } from "@/lib/qrouter/http";
import { createAdminClient } from "@/lib/supabase/admin";

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const principal = await resolvePrincipal(request);
    const { id } = await params;
    if (principal.demo) return new NextResponse(null, { status: 204 });
    const { error } = await createAdminClient().from("api_keys").update({ revoked_at: new Date().toISOString() }).eq("id", id).eq("organization_id", principal.organizationId);
    if (error) throw error;
    return new NextResponse(null, { status: 204 });
  } catch (error) { return apiError(error); }
}

