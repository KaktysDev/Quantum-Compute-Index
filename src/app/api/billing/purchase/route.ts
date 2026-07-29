import { NextResponse } from "next/server";
import Stripe from "stripe";
import { resolvePrincipal } from "@/lib/qrouter/auth";
import { requeueAwaitingPaymentJobs } from "@/lib/qrouter/credits";
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

    let intent: Stripe.PaymentIntent;
    try {
      const idempotencyKey = request.headers.get("idempotency-key")?.trim() || undefined;
      intent = await getStripe().paymentIntents.create({
        amount, currency: "usd", customer: org.stripe_customer_id, payment_method: methods.data[0].id,
        confirm: true, off_session: true,
        metadata: { organization_id: principal.organizationId, credit_amount: String(amount / 100) },
      }, idempotencyKey ? { idempotencyKey } : undefined);
    } catch (stripeError) {
      if (stripeError instanceof Stripe.errors.StripeCardError) {
        return NextResponse.json({
          error: { type: "payment_error", code: stripeError.code, message: stripeError.message },
        }, { status: 402 });
      }
      throw stripeError;
    }

    if (intent.status === "succeeded") {
      // add_credits is idempotent on the intent id, so the webhook double-fire
      // is a no-op; granting here means credits arrive even if webhook delivery
      // fails, and parked jobs unlock immediately.
      await admin.rpc("add_credits", { p_organization_id: principal.organizationId, p_amount: amount / 100, p_external_id: intent.id, p_metadata: { source: "purchase_route" } });
      await requeueAwaitingPaymentJobs(admin, principal.organizationId).catch((requeueError) => {
        console.error(`Failed to requeue parked jobs for ${principal.organizationId}`, requeueError);
      });
      return NextResponse.json({ id: intent.id, status: intent.status, amount: amount / 100 });
    }
    if (intent.status === "processing") {
      return NextResponse.json({ id: intent.id, status: intent.status, amount: amount / 100, message: "Payment is processing; credits arrive when it settles." }, { status: 202 });
    }
    return NextResponse.json({
      error: { type: "payment_error", message: `The payment did not complete (${intent.status}). Confirm the payment method and try again.`, intent_id: intent.id },
    }, { status: 402 });
  } catch (error) { return apiError(error); }
}
