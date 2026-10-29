import { afterEach, describe, expect, it, vi } from "vitest";
import { CONTACT_RECIPIENT, isContactEmailConfigured, sendContactEmail } from "@/lib/contact/email";

const message = { name: "Test <script>", email: "visitor@example.com", phone: "+1 555 0100", message: "A workload question.\nSecond line." };
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
function configure() {
  vi.stubEnv("RESEND_API_KEY", "test-key-not-a-real-secret");
  vi.stubEnv("CONTACT_EMAIL_FROM", "QRouter <contact@example.com>");
}
describe("contact email transport", () => {
  it("requires both a key and sender and rejects header newlines", async () => {
    vi.stubEnv("RESEND_API_KEY", ""); vi.stubEnv("CONTACT_EMAIL_FROM", "");
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    expect(isContactEmailConfigured()).toBe(false);
    await expect(sendContactEmail(message)).rejects.toThrow("not configured");
    expect(fetchMock).not.toHaveBeenCalled();
    configure(); vi.stubEnv("CONTACT_EMAIL_FROM", "sender@example.com\nBcc: attacker@example.com");
    expect(isContactEmailConfigured()).toBe(false);
  });
  it("sends plain text only to the fixed inbox, with visitor Reply-To", async () => {
    configure(); const fetchMock = vi.fn().mockResolvedValue(Response.json({ id: "email-test-id" })); vi.stubGlobal("fetch", fetchMock);
    await sendContactEmail(message);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    const payload = JSON.parse(init.body);
    expect(payload.to).toEqual([CONTACT_RECIPIENT]);
    expect(payload.to).toEqual(["lagodaoleg1357@gmail.com"]);
    expect(payload.reply_to).toBe(message.email);
    expect(payload.subject).toBe("New QRouter website enquiry");
    expect(payload.text).toContain(message.message);
    expect(payload.html).toBeUndefined();
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
  it("does not expose provider errors containing submitted data", async () => {
    configure(); vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("private message and credentials", { status: 403 })));
    await expect(sendContactEmail(message)).rejects.toThrow("Contact email provider rejected request (403)");
  });
  it("requires a provider acceptance ID", async () => {
    configure(); vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({})));
    await expect(sendContactEmail(message)).rejects.toThrow("did not confirm acceptance");
  });
  it("does not treat transport failure as delivery success", async () => {
    configure(); vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new DOMException("Timed out", "TimeoutError")));
    await expect(sendContactEmail(message)).rejects.toThrow("Timed out");
  });
});
