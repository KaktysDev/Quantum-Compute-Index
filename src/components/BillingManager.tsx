"use client";

// Billing: balance, credit purchases, the saved card, and the ledger. State is
// read from /api/billing/status, which reconciles the stored flag with Stripe,
// and the card form lives here so a card can be added without re-onboarding.

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { ConfirmDialog, InlineAlert, Panel, Stat, StatGrid, Timestamp } from "@/components/console/ui";
import { formatUsd } from "@/lib/qrouter/cost";

const AMOUNTS = [25, 50, 100, 250];

interface BillingStatus {
  billingComplete: boolean;
  stripeConfigured: boolean;
  demo?: boolean;
  reconciled?: boolean;
  card: { brand: string; last4: string; expMonth: number; expYear: number } | null;
  available: number;
  reserved: number;
}

export interface LedgerEntry {
  id: string;
  type: string;
  amount: number;
  balance_after: number;
  created_at: string;
  job_id: string | null;
}

const LEDGER_LABEL: Record<string, string> = {
  purchase: "Credit purchase",
  reserve: "Reserved for a run",
  release: "Reservation released",
  charge: "Run charged",
  refund: "Refund",
  adjustment: "Adjustment",
};

function CardForm({ onSaved }: { onSaved: () => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!stripe || !elements) return;
    setBusy(true);
    setError(null);
    const result = await stripe.confirmSetup({
      elements,
      redirect: "if_required",
      confirmParams: { return_url: `${location.origin}/dashboard/billing` },
    });
    if (result.error) {
      setError(result.error.message ?? "Card setup failed.");
      setBusy(false);
      return;
    }
    onSaved();
  }

  return (
    <form onSubmit={submit} className="stack">
      <PaymentElement />
      {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}
      <div className="form-actions">
        <button className="btn btn-primary" disabled={busy || !stripe}>
          {busy ? <Loader2 className="spin" size={14} /> : null} Save payment method
        </button>
      </div>
    </form>
  );
}

export default function BillingManager({
  balance,
  billingComplete,
  ledger = [],
}: {
  balance: number;
  billingComplete: boolean;
  ledger?: LedgerEntry[];
}) {
  const router = useRouter();
  const [status, setStatus] = useState<BillingStatus>({
    billingComplete,
    stripeConfigured: true,
    card: null,
    available: balance,
    reserved: 0,
  });
  const [amount, setAmount] = useState(50);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [stripePromise, setStripePromise] = useState<Promise<Stripe | null> | null>(null);
  const [dark, setDark] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  // Stripe Elements is not theme-aware on its own; it has to be told, and the
  // appearance is fixed at mount, so watch the console's theme attribute.
  useEffect(() => {
    const read = () => setDark(document.documentElement.getAttribute("data-theme") === "dark");
    read();
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/billing/status", { cache: "no-store" });
      if (response.ok) setStatus((await response.json()) as BillingStatus);
    } catch {
      /* keep the server-rendered state */
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function startCardSetup() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/billing/setup-intent", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message ?? "Billing setup failed.");
      if (data.demo) {
        setMessage("Demo workspace — no real payment method is needed.");
        return;
      }
      if (!data.clientSecret || !data.publishableKey) throw new Error("Stripe publishable key is missing.");
      setClientSecret(data.clientSecret);
      setStripePromise(loadStripe(data.publishableKey));
    } catch (value) {
      setError(value instanceof Error ? value.message : "Billing setup failed.");
    } finally {
      setBusy(false);
    }
  }

  async function onCardSaved() {
    setClientSecret(null);
    setStripePromise(null);
    setMessage("Payment method saved.");
    await refresh();
    router.refresh();
  }

  async function purchase() {
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const response = await fetch("/api/billing/purchase", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({ amount }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message ?? "Purchase failed.");
      setMessage(
        data.message ??
          `$${amount.toFixed(2)} credit purchase ${data.demo ? "simulated" : "completed"}. Jobs waiting on payment resume automatically.`,
      );
      await refresh();
      router.refresh();
    } catch (value) {
      setError(value instanceof Error ? value.message : "Purchase failed.");
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setConfirmRemove(false);
    setBusy(true);
    setError(null);
    const response = await fetch("/api/billing/disconnect", { method: "DELETE" });
    setBusy(false);
    if (response.ok) {
      setMessage("Billing connection removed.");
      await refresh();
      router.refresh();
    } else {
      setError("Could not remove the billing connection.");
    }
  }

  const card = status.card
    ? `${status.card.brand[0].toUpperCase()}${status.card.brand.slice(1)} ending ${status.card.last4}`
    : status.billingComplete
      ? "Card on file"
      : "No payment method";

  return (
    <div className="stack">
      <StatGrid>
        <Stat label="Available balance" value={formatUsd(status.available)} meta="Reserved only when you approve a quote" />
        <Stat label="Reserved" value={formatUsd(status.reserved)} meta="Held for runs in progress" />
      </StatGrid>

      {message ? <InlineAlert tone="success">{message}</InlineAlert> : null}
      {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}
      {!status.stripeConfigured && !status.demo ? <InlineAlert tone="warning">Stripe is not configured on this deployment.</InlineAlert> : null}

      <div className="grid-2">
        <Panel title="Add credits" description="Runs waiting for credits start automatically after a purchase.">
          <div className="stack">
            <div className="segmented amount-picker" role="group" aria-label="Amount">
              {AMOUNTS.map((value) => (
                <button type="button" key={value} aria-pressed={amount === value} onClick={() => setAmount(value)}>
                  ${value}
                </button>
              ))}
            </div>
            {!status.billingComplete ? <p className="muted">Add a payment method before buying credits.</p> : null}
            <div className="row-between">
              <small className="dim">
                Subject to the <a href="/terms#credits" className="underline">credit terms</a> and <a href="/terms#refunds" className="underline">refund policy</a>.
              </small>
              <button className="btn btn-primary" disabled={busy || !status.billingComplete} onClick={purchase}>
                {busy ? <Loader2 className="spin" size={14} /> : null} Buy ${amount} in credits
              </button>
            </div>
          </div>
        </Panel>

        <Panel title="Payment method" description={status.billingComplete ? "Used for off-session credit purchases." : "Required to buy credits and run on QPUs."}>
          {clientSecret && stripePromise ? (
            <Elements
              stripe={stripePromise}
              options={{
                clientSecret,
                appearance: {
                  theme: dark ? "night" : "stripe",
                  variables: {
                    colorPrimary: dark ? "#ffffff" : "#0a0a0a",
                    colorBackground: dark ? "#0a0a0a" : "#ffffff",
                    colorText: dark ? "#ededed" : "#0a0a0a",
                    borderRadius: "4px",
                  },
                },
              }}
            >
              <CardForm onSaved={onCardSaved} />
            </Elements>
          ) : (
            <div className="row-between">
              <span className="cell-main">
                <b>{card}</b>
                <small>
                  {status.card
                    ? `Expires ${String(status.card.expMonth).padStart(2, "0")}/${String(status.card.expYear).slice(-2)}`
                    : status.billingComplete ? "Ready for purchases" : "Not set up"}
                </small>
              </span>
              <span className="row">
                {status.billingComplete ? (
                  <button className="btn btn-ghost" onClick={() => setConfirmRemove(true)} disabled={busy}>Remove</button>
                ) : null}
                <button className="btn btn-secondary" onClick={startCardSetup} disabled={busy}>
                  {busy ? <Loader2 className="spin" size={14} /> : null}
                  {status.billingComplete ? "Replace card" : "Add payment method"}
                </button>
              </span>
            </div>
          )}
        </Panel>
      </div>

      <Panel title="Transactions" description="Most recent 50 ledger entries." flush>
        <div className="table-wrap">
          <table className="qr-table">
            <thead>
              <tr>
                <th>Event</th>
                <th className="hide-sm">When</th>
                <th className="num">Amount</th>
                <th className="num hide-sm">Balance after</th>
              </tr>
            </thead>
            <tbody>
              {ledger.length === 0 ? (
                <tr><td colSpan={4} className="empty-row">No transactions yet. Purchases and run charges appear here.</td></tr>
              ) : (
                ledger.map((entry) => {
                  const amountValue = Number(entry.amount);
                  return (
                    <tr key={entry.id}>
                      <td>
                        <span className="cell-main">
                          <b>{LEDGER_LABEL[entry.type] ?? entry.type}</b>
                          {entry.job_id ? (
                            <small><Link href={`/dashboard/activity?job=${entry.job_id}`} className="mono">{entry.job_id.slice(0, 8)}</Link></small>
                          ) : null}
                        </span>
                      </td>
                      <td className="hide-sm"><Timestamp value={entry.created_at} /></td>
                      <td className={`num${amountValue > 0 ? " ledger-credit" : ""}`}>
                        {amountValue > 0 ? "+" : amountValue < 0 ? "−" : ""}{formatUsd(Math.abs(amountValue))}
                      </td>
                      <td className="num hide-sm">{formatUsd(Number(entry.balance_after))}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Panel>

      <ConfirmDialog
        open={confirmRemove}
        title="Remove payment method?"
        body="Saved cards are removed from this workspace. Runs already in progress are not affected, but you will not be able to buy credits until you add a card again."
        confirmLabel="Remove"
        tone="danger"
        busy={busy}
        onConfirm={disconnect}
        onClose={() => setConfirmRemove(false)}
      />
    </div>
  );
}
