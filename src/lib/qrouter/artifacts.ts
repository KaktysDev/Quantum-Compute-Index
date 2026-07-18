import { createHash } from "crypto";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { createAdminClient } from "@/lib/supabase/admin";

type ArtifactKind = "source" | "transpiled" | "result";
const SUPABASE_BUCKET = "qrouter-artifacts";
const VULTR_SCHEME = "vultr-object://";

function objectStorageConfig() {
  const endpoint = process.env.VULTR_OBJECT_STORAGE_ENDPOINT;
  const bucket = process.env.VULTR_OBJECT_STORAGE_BUCKET;
  const accessKeyId = process.env.VULTR_OBJECT_STORAGE_ACCESS_KEY_ID;
  const secretAccessKey = process.env.VULTR_OBJECT_STORAGE_SECRET_ACCESS_KEY;
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return null;
  if ([bucket, accessKeyId, secretAccessKey].some((value) => value.startsWith("your-"))) return null;
  return {
    endpoint: endpoint.replace(/\/+$/, ""),
    bucket,
    region: process.env.VULTR_OBJECT_STORAGE_REGION ?? "us-east-1",
    accessKeyId,
    secretAccessKey,
  };
}

function objectStorageClient() {
  const config = objectStorageConfig();
  if (!config) return null;
  return {
    bucket: config.bucket,
    client: new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      forcePathStyle: false,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    }),
  };
}

function objectStoragePath(bucket: string, key: string) {
  return `${VULTR_SCHEME}${bucket}/${key}`;
}

function parseObjectStoragePath(storagePath: string) {
  if (!storagePath.startsWith(VULTR_SCHEME)) return null;
  const value = storagePath.slice(VULTR_SCHEME.length);
  const separator = value.indexOf("/");
  if (separator < 1) throw new Error("Artifact object storage path is invalid.");
  return { bucket: value.slice(0, separator), key: value.slice(separator + 1) };
}

async function streamToString(body: unknown) {
  const stream = body as { transformToString?: () => Promise<string> };
  if (!stream.transformToString) throw new Error("Unable to read artifact object body.");
  return stream.transformToString();
}

async function uploadEncryptedArtifact(path: string, encrypted: string, contentType: string) {
  const objectStorage = objectStorageClient();
  if (objectStorage) {
    await objectStorage.client.send(new PutObjectCommand({
      Bucket: objectStorage.bucket,
      Key: path,
      Body: encrypted,
      ContentType: "text/plain",
      Metadata: {
        "qrouter-content-type": contentType,
        encrypted: "true",
      },
    }));
    return objectStoragePath(objectStorage.bucket, path);
  }

  const { error } = await createAdminClient().storage
    .from(SUPABASE_BUCKET)
    .upload(path, encrypted, { contentType: "text/plain", upsert: true });
  if (error) throw new Error(`Artifact upload failed: ${error.message}`);
  return path;
}

async function downloadEncryptedArtifact(storagePath: string) {
  const objectPath = parseObjectStoragePath(storagePath);
  if (objectPath) {
    const objectStorage = objectStorageClient();
    if (!objectStorage) throw new Error("Object storage credentials are required to load this artifact.");
    const response = await objectStorage.client.send(new GetObjectCommand({ Bucket: objectPath.bucket, Key: objectPath.key }));
    if (!response.Body) throw new Error("Artifact object did not include a readable body.");
    return streamToString(response.Body);
  }

  const { data, error } = await createAdminClient().storage
    .from(SUPABASE_BUCKET)
    .download(storagePath);
  if (error) throw new Error(`Artifact download failed: ${error.message}`);
  return data.text();
}

export async function storeArtifact(input: {
  jobId: string;
  organizationId: string;
  kind: ArtifactKind;
  content: string;
}) {
  const admin = createAdminClient();
  const encrypted = encryptSecret(input.content);
  const path = `${input.organizationId}/${input.jobId}/${input.kind}.enc`;
  const contentType = input.kind === "result" ? "application/json" : "text/plain";
  const storagePath = await uploadEncryptedArtifact(path, encrypted, contentType);
  const { error: rowError } = await admin.from("artifacts").upsert({
    job_id: input.jobId,
    organization_id: input.organizationId,
    kind: input.kind,
    storage_path: storagePath,
    content_type: contentType,
    size_bytes: Buffer.byteLength(input.content),
    sha256: createHash("sha256").update(input.content).digest("hex"),
    encrypted: true,
  }, { onConflict: "job_id,kind" });
  if (rowError) throw new Error(`Artifact metadata write failed: ${rowError.message}`);
  return storagePath;
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
  return decryptSecret(await downloadEncryptedArtifact(artifact.storage_path));
}
