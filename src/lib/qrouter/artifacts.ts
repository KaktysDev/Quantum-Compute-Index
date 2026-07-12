import { createHash } from "crypto";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { createAdminClient } from "@/lib/supabase/admin";

type ArtifactKind = "source" | "transpiled" | "result";

export async function storeArtifact(input: {
  jobId: string;
  organizationId: string;
  kind: ArtifactKind;
  content: string;
}) {
  const admin = createAdminClient();
  const encrypted = encryptSecret(input.content);
  const path = `${input.organizationId}/${input.jobId}/${input.kind}.enc`;
  const { error: storageError } = await admin.storage
    .from("qrouter-artifacts")
    .upload(path, encrypted, { contentType: "text/plain", upsert: true });
  if (storageError) throw new Error(`Artifact upload failed: ${storageError.message}`);
  const { error: rowError } = await admin.from("artifacts").upsert({
    job_id: input.jobId,
    organization_id: input.organizationId,
    kind: input.kind,
    storage_path: path,
    content_type: input.kind === "result" ? "application/json" : "text/plain",
    size_bytes: Buffer.byteLength(input.content),
    sha256: createHash("sha256").update(input.content).digest("hex"),
    encrypted: true,
  }, { onConflict: "job_id,kind" });
  if (rowError) throw new Error(`Artifact metadata write failed: ${rowError.message}`);
  return path;
}

export async function loadArtifact(jobId: string, kind: ArtifactKind) {
  const admin = createAdminClient();
  const { data: artifact, error: rowError } = await admin
    .from("artifacts")
    .select("storage_path")
    .eq("job_id", jobId)
    .eq("kind", kind)
    .maybeSingle();
  if (rowError) throw new Error(`Artifact lookup failed: ${rowError.message}`);
  if (!artifact) return null;
  const { data, error: storageError } = await admin.storage
    .from("qrouter-artifacts")
    .download(artifact.storage_path);
  if (storageError) throw new Error(`Artifact download failed: ${storageError.message}`);
  return decryptSecret(await data.text());
}
