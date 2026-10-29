/** Server-side contact delivery. The public form cannot choose a recipient. */
export const CONTACT_RECIPIENT = "lagodaoleg1357@gmail.com";
export type ContactMessage = { name: string; email: string; phone: string; message: string };

function configuration() {
  const key = process.env.RESEND_API_KEY?.trim();
  const from = process.env.CONTACT_EMAIL_FROM?.trim();
  if (!key || !from || /[\r\n]/.test(from)) return null;
  return { key, from };
}

export function isContactEmailConfigured() { return configuration() !== null; }

export async function sendContactEmail(message: ContactMessage) {
  const config = configuration();
  if (!config) throw new Error("Contact email is not configured");
  // Plain text keeps visitor-supplied content out of HTML and email headers.
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${config.key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: config.from,
      to: [CONTACT_RECIPIENT],
      reply_to: message.email,
      subject: "New QRouter website enquiry",
      text: `Name: ${message.name}\nEmail: ${message.email}\nPhone: ${message.phone}\n\n${message.message}`,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  // Never log a provider response: it may echo message content or credentials.
  if (!response.ok) throw new Error(`Contact email provider rejected request (${response.status})`);
  const result: unknown = await response.json();
  if (!result || typeof result !== "object" || !("id" in result) || typeof result.id !== "string" || !result.id) {
    throw new Error("Contact email provider did not confirm acceptance");
  }
}
