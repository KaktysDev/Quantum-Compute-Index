import { NextResponse } from "next/server";
import { resolvePrincipal } from "@/lib/qrouter/auth";
import { apiError } from "@/lib/qrouter/http";
import { getStripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(request: Request) {
  try {
    const principal = await resolvePrincipal(request);
    const body = await request.json() as { amount?: number };
    const amount = Math.round(Number(body.amount) * 100);
    if (!Number.isInteger(amount) || amount < 500 || amount > 1000000) return NextResponse.json({ error: { type: "invalid_amount", message: "Purchase between $5 and $10,000." } }, { status: 400 });
    if (principal.demo) return NextResponse.json({ demo: true, amount: amount / 100 });
    const admin = createAdminClient();
    const { data: org, error } = await admin.from("organizations").select("stripe_customer_id").eq("id", principal.organizationId).single();
    if (error) throw error;
    if (!org.stripe_customer_id) return NextResponse.json({ error: { type: "billing_required", message: "Add a payment method first." } }, { status: 409 });
    const methods = await getStripe().paymentMethods.list({ customer: org.stripe_customer_id, type: "card", limit: 1 });
    if (!methods.data[0]) return NextResponse.json({ error: { type: "billing_required", message: "Add a payment method first." } }, { status: 409 });
    const intent = await getStripe().paymentIntents.create({ amount, currency: "usd", customer: org.stripe_customer_id, payment_method: methods.data[0].id, confirm: true, off_session: true, metadata: { organization_id: principal.organizationId, credit_amount: String(amount / 100) } });
    return NextResponse.json({ id: intent.id, status: intent.status, amount: amount / 100 });
  } catch (error) { return apiError(error); }
}

