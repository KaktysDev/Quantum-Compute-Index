import { createHash, randomBytes } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";

export interface Principal { organizationId: string; userId: string | null; apiKeyId: string | null; demo: boolean }
export class AuthenticationError extends Error {}
export class RateLimitError extends Error {}
export const hashApiKey = (key: string) => createHash("sha256").update(key).digest("hex");
export function createApiKey(environment: "test"|"live" = "live") { const key = `qci_${environment}_${randomBytes(24).toString("base64url")}`; return { key, prefix: key.slice(0,17), hash: hashApiKey(key) }; }

export async function resolvePrincipal(request: Request): Promise<Principal> {
  const authorization = request.headers.get("authorization");
  if (authorization?.startsWith("Bearer ")) {
    const raw = authorization.slice(7).trim(); if (!raw.startsWith("qci_")) throw new AuthenticationError("Invalid API key format.");
    if (!isSupabaseConfigured()) { if (process.env.NODE_ENV !== "production" && raw === "qci_test_local_development") return { organizationId:"demo",userId:null,apiKeyId:"demo",demo:true }; throw new AuthenticationError("API key storage is not configured."); }
    const admin = createAdminClient(); const { data } = await admin.from("api_keys").select("id,organization_id,revoked_at,expires_at").eq("key_hash",hashApiKey(raw)).maybeSingle();
    if (!data || data.revoked_at || (data.expires_at && new Date(data.expires_at)<=new Date())) throw new AuthenticationError("Invalid or expired API key.");
    const{data:allowed}=await admin.rpc("consume_api_rate_limit",{p_api_key_id:data.id,p_limit:120});if(allowed===false)throw new RateLimitError("API key rate limit exceeded. Retry after the current minute.");
    await admin.from("api_keys").update({last_used_at:new Date().toISOString()}).eq("id",data.id); return {organizationId:data.organization_id,userId:null,apiKeyId:data.id,demo:false};
  }
  if (!isSupabaseConfigured()) { if (process.env.NODE_ENV === "production") throw new AuthenticationError("Authentication is not configured."); return {organizationId:"demo",userId:"demo",apiKeyId:null,demo:true}; }
  const supabase = await createClient(); const {data:{user}} = await supabase.auth.getUser(); if (!user) throw new AuthenticationError("Authentication required.");
  const {data} = await supabase.from("organization_members").select("organization_id").eq("user_id",user.id).limit(1).maybeSingle(); if (!data) throw new AuthenticationError("No workspace is associated with this account.");
  return {organizationId:data.organization_id,userId:user.id,apiKeyId:null,demo:false};
}
