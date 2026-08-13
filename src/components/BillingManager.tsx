"use client";

// ─────────────────────────────────────────────────────────────────────────────
// Billing.
//
// The page used to be a dead end whenever `billing_setup_complete` was false:
// "Purchase" was disabled and the only guidance was to add a card "during
// onboarding", which never runs twice. Two things fix that here:
//
//   · State is read from /api/billing/status, which reconciles the stored flag
//     against Stripe instead of trusting a webhook that may never have fired.
//   · The card form lives on this page, so adding or replacing a payment method
//     never requires going back through onboarding.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import {
  AlertCircle,
  Check,
  Coins,
  CreditCard,
  Loader2,
  Plus,
  ShieldCheck,
  Unplug,
} from "lucide-react";

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
  reserve: "Reserved for job",
  release: "Reservation released",
  charge: "Job charged",
  refund: "Refunded",
  adjustment: "Adjustment",
};

/** Green when credits arrive, red when they leave, neutral while merely held. */
function ledgerTone(type: string) {
  if (type === "purchase" || type === "refund" || type === "release") return "credit";
  if (type === "charge") return "debit";
  return "neutral";
}

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
    <form onSubmit={submit} className="stripe-form">
      <PaymentElement />
      <button className="console-primary full" disabled={busy || !stripe}>
        {busy ? <Loader2 className="spin" size={16} /> : <Check size={15} />} Save payment method
      </button>
      {error && <p className="form-error">{error}</p>}
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
    if (!confirm("Remove every saved payment method? Running jobs are not affected.")) return;
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

  return (
    <div className="console-grid billing-grid">
      <section className="console-panel balance-panel">
        <p className="qr-eyebrow">Available balance</p>
        <strong>${status.available.toFixed(2)}</strong>
        <span>Compute credits{status.reserved > 0 ? ` · $${status.reserved.toFixed(2)} reserved` : ""}</span>
        <div>
          <ShieldCheck size={14} /> Reserved only on approved quotes.
        </div>
      </section>

      <section className="console-panel add-credit">
        <div className="panel-title">
          <Plus size={16} />
          <h2>Add credits</h2>
        </div>
        <div className="amount-options">
          {AMOUNTS.map((value) => (
            <button className={amount === value ? "active" : ""} onClick={() => setAmount(value)} key={value}>
              ${value}
            </button>
          ))}
        </div>
        <button className="console-primary full" disabled={busy || !status.billingComplete} onClick={purchase}>
          {busy ? <Loader2 className="spin" size={16} /> : <CreditCard size={15} />} Purchase ${amount}
        </button>
        {/* The terms still have to be linked at the point of purchase — they
            just do not need three lines of preamble to get there. */}
        <p className="billing-fineprint">
          By purchasing you accept the{" "}
          <a href="/terms#credits" className="underline underline-offset-2">
            credit terms
          </a>{" "}
          and{" "}
          <a href="/terms#refunds" className="underline underline-offset-2">
            refund policy
          </a>
          .
        </p>
        {!status.billingComplete && (
          <p className="form-error">
            <AlertCircle size={12} /> Add a payment method before buying credits.
          </p>
        )}
        {message && <p className="form-message">{message}</p>}
        {error && <p className="form-error">{error}</p>}
      </section>

      <section className="console-panel billing-connection">
        <div className="panel-title">
          <CreditCard size={16} />
          <h2>Payment method</h2>
        </div>
        <div className="connection-state">
          <i className={status.billingComplete ? "connected" : ""} />
          <span>
            <b>
              {status.card
                ? `${status.card.brand.toUpperCase()} ···· ${status.card.last4}`
                : status.billingComplete
                  ? "Card on file"
                  : "No payment method"}
            </b>
            <small>
              {status.card
                ? `Expires ${String(status.card.expMonth).padStart(2, "0")}/${String(status.card.expYear).slice(-2)} · off-session purchases enabled`
                : status.billingComplete
                  ? "Ready for off-session credit purchases"
                  : "Add a card to buy credits and run physical QPUs"}
            </small>
          </span>
        </div>

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
                  borderRadius: "6px",
                },
              },
            }}
          >
            <CardForm onSaved={onCardSaved} />
          </Elements>
        ) : (
          <div className="billing-connection-actions">
            <button className="console-secondary" onClick={startCardSetup} disabled={busy}>
              {busy ? <Loader2 className="spin" size={14} /> : <CreditCard size={14} />}
              {status.billingComplete ? "Replace card" : "Add payment method"}
            </button>
            {status.billingComplete && (
              <button className="console-danger" onClick={disconnect} disabled={busy}>
                <Unplug size={14} /> Remove
              </button>
            )}
          </div>
        )}
        {!status.stripeConfigured && !status.demo && (
          <p className="form-error">
            <AlertCircle size={12} /> Stripe is not configured on this deployment.
          </p>
        )}
      </section>

      <section className="console-panel billing-history">
        <div className="panel-title">
          <Coins size={16} />
          <div>
            <h2>Transactions</h2>
            <small>Purchases, reservations, and charges</small>
          </div>
          <span>{ledger.length} recent</span>
        </div>
        <div className="billing-history-head">
          <span>Event</span>
          <span>When</span>
          <span>Amount</span>
          <span>Balance after</span>
        </div>
        {ledger.length === 0 ? (
          <div className="console-empty">
            <CreditCard />
            <p>No transactions yet</p>
            <small>Credit purchases and job charges appear here.</small>
          </div>
        ) : (
          ledger.map((entry) => (
            <div className={`billing-history-row ${ledgerTone(entry.type)}`} key={entry.id}>
              <span>
                <b>{LEDGER_LABEL[entry.type] ?? entry.type}</b>
                {entry.job_id && <small>job {entry.job_id.slice(0, 8)}</small>}
              </span>
              <span>{new Date(entry.created_at).toLocaleString()}</span>
              <span className="billing-amount">
                {Number(entry.amount) >= 0 ? "+" : "−"}${Math.abs(Number(entry.amount)).toFixed(4)}
              </span>
              <span>${Number(entry.balance_after).toFixed(2)}</span>
            </div>
          ))
        )}
      </section>
    </div>
  );
}
