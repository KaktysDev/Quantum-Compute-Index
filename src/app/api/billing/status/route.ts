import { NextResponse } from "next/server";
import { resolvePrincipal } from "@/lib/qrouter/auth";
import { apiError } from "@/lib/qrouter/http";
import { getStripe, isStripeConfigured } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * Billing state, reconciled against Stripe.
 *
 * `organizations.billing_setup_complete` was previously written in exactly one
 * place: the `setup_intent.succeeded` webhook. Any environment where that
 * webhook is not reachable or STRIPE_WEBHOOK_SECRET is unset — local dev,
 * preview deploys, a misconfigured endpoint — left users who had genuinely
 * saved a card stuck behind a permanently disabled "Purchase" button and a
 * message telling them to add the card during onboarding they had already
 * finished.
 *
 * Stripe is the source of truth for whether a usable card exists, so this reads
 * it directly and repairs the flag when the two disagree. The repair is
 * idempotent, so it is safe on every page load and the webhook stays the fast
 * path rather than the only path.
 */
export async function GET(request: Request) {
  try {
    const principal = await resolvePrincipal(request);
    if (principal.demo) {
      return NextResponse.json({
        billingComplete: true,
        stripeConfigured: false,
        demo: true,
        card: null,
        available: 10,
        reserved: 0,
      });
    }

    const admin = createAdminClient();
    const [orgResult, creditsResult] = await Promise.all([
      admin
        .from("organizations")
        .select("stripe_customer_id,billing_setup_complete")
        .eq("id", principal.organizationId)
        .maybeSingle(),
      admin
        .from("credit_accounts")
        .select("available,reserved")
        .eq("organization_id", principal.organizationId)
        .maybeSingle(),
    ]);
    if (orgResult.error) throw orgResult.error;

    const org = orgResult.data;
    const available = Number(creditsResult.data?.available ?? 0);
    const reserved = Number(creditsResult.data?.reserved ?? 0);
    let billingComplete = Boolean(org?.billing_setup_complete);
    let card: { brand: string; last4: string; expMonth: number; expYear: number } | null = null;

    if (isStripeConfigured() && org?.stripe_customer_id) {
      try {
        const methods = await getStripe().paymentMethods.list({
          customer: org.stripe_customer_id,
          type: "card",
          limit: 1,
        });
        const method = methods.data[0];
        const hasCard = Boolean(method);
        if (method?.card) {
          card = {
            brand: method.card.brand,
            last4: method.card.last4,
            expMonth: method.card.exp_month,
            expYear: method.card.exp_year,
          };
        }
        // Repair the flag in either direction: a card that arrived without the
        // webhook firing, or one detached outside the console.
        if (hasCard !== billingComplete) {
          billingComplete = hasCard;
          await admin
            .from("organizations")
            .update({ billing_setup_complete: hasCard })
            .eq("id", principal.organizationId);
          if (principal.userId) {
            await admin
              .from("profiles")
              .update({ billing_setup_complete: hasCard })
              .eq("id", principal.userId);
          }
        }
      } catch (stripeError) {
        // A Stripe outage must not make the billing page unusable — fall back
        // to the stored flag and report that the check did not run.
        console.error("Stripe payment method lookup failed", stripeError);
        return NextResponse.json({
          billingComplete,
          stripeConfigured: true,
          reconciled: false,
          card: null,
          available,
          reserved,
        });
      }
    }

    return NextResponse.json({
      billingComplete,
      stripeConfigured: isStripeConfigured(),
      reconciled: true,
      card,
      available,
      reserved,
    });
  } catch (error) {
    return apiError(error);
  }
}
