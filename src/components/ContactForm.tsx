"use client";

import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { useState } from "react";

const MAX_MESSAGE = 2000;
export default function ContactForm() {
  const [form, setForm] = useState({ name: "", email: "", phone: "", message: "" });
  const [status, setStatus] = useState<"idle" | "sending" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (status === "sending") return;
    setError(null); setStatus("sending");
    try {
      const response = await fetch("/api/contact", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Something went wrong.");
      setStatus("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong."); setStatus("idle");
    }
  }
  if (status === "done") {
    return <div className="qt-form-success" role="status"><h2>Message sent.</h2><p>Thanks, {form.name.split(" ")[0] || "there"}. Our team will be in touch.</p><Link className="qt-text-link" href="/research">Explore the research <ArrowUpRight size={16} /></Link></div>;
  }
  return <form onSubmit={onSubmit} className="qt-contact-form" aria-label="Contact QRouter" aria-busy={status === "sending"}>
    {error && <p className="qt-form-error" role="alert">{error}</p>}
    <div className="qt-field-pair">
      <div className="qt-field"><label htmlFor="contact-name">Name</label><input id="contact-name" name="name" value={form.name} onChange={set("name")} required maxLength={120} autoComplete="name" placeholder="Jane Doe" /></div>
      <div className="qt-field"><label htmlFor="contact-email">Work email</label><input id="contact-email" name="email" type="email" value={form.email} onChange={set("email")} required maxLength={200} autoComplete="email" placeholder="jane@company.com" /></div>
    </div>
    <div className="qt-field"><label htmlFor="contact-phone">Phone</label><input id="contact-phone" name="phone" type="tel" value={form.phone} onChange={set("phone")} required minLength={5} maxLength={40} autoComplete="tel" placeholder="+1 555 000 1234" /></div>
    <div className="qt-field"><div className="qt-field-title"><label htmlFor="contact-message">Your workload or question</label><span id="message-count">{MAX_MESSAGE - form.message.length} characters left</span></div><textarea id="contact-message" name="message" value={form.message} onChange={set("message")} required maxLength={MAX_MESSAGE} aria-describedby="message-count" placeholder="What does your software need to solve?" /></div>
    <button type="submit" disabled={status === "sending"} className="qt-button qt-button-dark">{status === "sending" ? "Sending…" : "Send message"}<ArrowUpRight size={16} /></button>
    <p className="qt-form-privacy">You can also email <a href="mailto:lagodaoleg1357@gmail.com">lagodaoleg1357@gmail.com</a>. We use these details to respond to your request. See our <Link href="/privacy">Privacy Policy</Link> for retention and deletion.</p>
  </form>;
}
