import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { getStripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(request: Request) {
  const signature = (await headers()).get("stripe-signature");
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!signature || !secret) return NextResponse.json({ error: "Stripe webhook is not configured." }, { status: 400 });
  try {
    const event = getStripe().webhooks.constructEvent(await request.text(), signature, secret);
    const admin = createAdminClient();
    if (event.type === "setup_intent.succeeded") {
      const intent = event.data.object;
      const orgId = intent.metadata?.organization_id;
      if (orgId) {
        await admin.from("organizations").update({ billing_setup_complete: true }).eq("id", orgId);
        await admin.from("profiles").update({ billing_setup_complete: true }).eq("stripe_customer_id", intent.customer as string);
      }
    }
    if (event.type === "payment_intent.succeeded") {
      const intent = event.data.object;
      const orgId = intent.metadata?.organization_id;
      const creditAmount = Number(intent.metadata?.credit_amount);
      if (orgId && creditAmount > 0) await admin.rpc("add_credits", { p_organization_id: orgId, p_amount: creditAmount, p_external_id: intent.id, p_metadata: { stripe_event: event.id } });
    }
    return NextResponse.json({ received: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid webhook." }, { status: 400 });
  }
}
