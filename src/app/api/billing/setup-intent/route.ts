import { NextResponse } from "next/server";
import { resolvePrincipal } from "@/lib/qrouter/auth";
import { apiError } from "@/lib/qrouter/http";
import { getStripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(request: Request) {
  try {
    const principal = await resolvePrincipal(request);
    if (principal.demo) return NextResponse.json({ demo: true });
    const admin = createAdminClient();
    const { data: org, error } = await admin.from("organizations").select("name,stripe_customer_id").eq("id", principal.organizationId).single();
    if (error) throw error;
    const stripe = getStripe();
    let customerId = org.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({ name: org.name, metadata: { organization_id: principal.organizationId } });
      customerId = customer.id;
      await admin.from("organizations").update({ stripe_customer_id: customerId }).eq("id", principal.organizationId);
      if (principal.userId) await admin.from("profiles").update({ stripe_customer_id: customerId }).eq("id", principal.userId);
    }
    const intent = await stripe.setupIntents.create({ customer: customerId, usage: "off_session", metadata: { organization_id: principal.organizationId } });
    return NextResponse.json({ clientSecret: intent.client_secret, publishableKey: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY });
  } catch (error) { return apiError(error); }
}

