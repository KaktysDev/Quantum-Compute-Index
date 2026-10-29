import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/contact/route";
const state = vi.hoisted(() => ({ configured: true, database: false, send: vi.fn(), insert: vi.fn(), guard: vi.fn() }));
vi.mock("@/lib/contact/email", () => ({ isContactEmailConfigured: () => state.configured, sendContactEmail: state.send }));
vi.mock("@/lib/supabase/config", () => ({ isSupabaseConfigured: () => state.database }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: () => ({ insert: state.insert }) }) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/security/public-form", () => ({ guardPublicForm: state.guard }));
const input = { name: "Test visitor", email: "visitor@example.com", phone: "+1 555 0100", message: "Test enquiry" };
function request(body: unknown = input) { return new Request("http://localhost/api/contact", { method: "POST", body: JSON.stringify(body) }); }
beforeEach(() => { state.configured = true; state.database = false; state.send.mockReset().mockResolvedValue(undefined); state.insert.mockReset().mockResolvedValue({ error: null }); state.guard.mockReset().mockResolvedValue(null); vi.spyOn(console, "error").mockImplementation(() => {}); });
afterEach(() => vi.restoreAllMocks());
describe("contact delivery endpoint", () => {
  it("supports email without a database and ignores caller-selected recipients", async () => {
    expect((await POST(request({ ...input, to: "attacker@example.com" }))).status).toBe(200);
    expect(state.send).toHaveBeenCalledWith(input); expect(state.insert).not.toHaveBeenCalled();
  });
  it("preserves private database storage on configured deployments", async () => {
    state.database = true; expect((await POST(request())).status).toBe(200);
    expect(state.insert).toHaveBeenCalledWith(input); expect(state.send).toHaveBeenCalledOnce();
  });
  it("never claims success when email is unconfigured", async () => {
    state.configured = false; const response = await POST(request()); expect(response.status).toBe(503);
    expect((await response.json()).error).toContain("lagodaoleg1357@gmail.com"); expect(state.send).not.toHaveBeenCalled(); expect(state.insert).not.toHaveBeenCalled();
  });
  it("reports provider failure safely even after database storage", async () => {
    state.database = true; state.send.mockRejectedValue(new Error("secret provider response"));
    const response = await POST(request()); expect(response.status).toBe(502);
    expect(JSON.stringify(await response.json())).not.toContain("secret provider response");
  });
  it("does not send when database storage fails", async () => {
    state.database = true; state.insert.mockResolvedValue({ error: { code: "42P01", message: "storage error" } });
    expect((await POST(request())).status).toBe(500); expect(state.send).not.toHaveBeenCalled();
  });
  it("does not send rate-limited submissions", async () => {
    state.guard.mockResolvedValue(Response.json({ error: "Limited" }, { status: 429 }));
    expect((await POST(request())).status).toBe(429); expect(state.send).not.toHaveBeenCalled();
  });
  it.each([null, [], { ...input, name: 42 }, { ...input, email: "v@example.com\r\nBcc: attacker@example.com" }])("rejects malformed input without sending: %j", async body => {
    expect((await POST(request(body))).status).toBe(400); expect(state.send).not.toHaveBeenCalled();
  });
});
