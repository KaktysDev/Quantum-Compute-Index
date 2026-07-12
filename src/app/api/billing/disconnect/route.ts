import { NextResponse } from "next/server";
import { resolvePrincipal } from "@/lib/qrouter/auth";
import { apiError } from "@/lib/qrouter/http";
import { getStripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";

export async function DELETE(request: Request) {
  try {
    const principal = await resolvePrincipal(request);
    if (principal.demo) return new NextResponse(null, { status: 204 });
    const admin = createAdminClient();
    const { data: org } = await admin.from("organizations").select("stripe_customer_id").eq("id", principal.organizationId).single();
    if (org?.stripe_customer_id) {
      const stripe = getStripe();
      const methods = await stripe.paymentMethods.list({ customer: org.stripe_customer_id, type: "card" });
      await Promise.all(methods.data.map((method) => stripe.paymentMethods.detach(method.id)));
    }
    await admin.from("organizations").update({ billing_setup_complete: false }).eq("id", principal.organizationId);
    if (principal.userId) await admin.from("profiles").update({ billing_setup_complete: false }).eq("id", principal.userId);
    return new NextResponse(null, { status: 204 });
  } catch (error) { return apiError(error); }
}

