#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const manifest = JSON.parse(readFileSync(resolve(ROOT, "assets/manifests/r2-upload-preview.json"), "utf8"));
const expectedCacheControl = "public, max-age=31536000, immutable";
const expectedPublicBaseUrl = "https://pub-a73a77b87d504498bad6ae568754e572.r2.dev";
const concurrencyIndex = process.argv.indexOf("--concurrency");
const concurrency = concurrencyIndex === -1 ? 6 : Number(process.argv[concurrencyIndex + 1]);
const expectedHeadIndex = process.argv.indexOf("--expected-head");
const expectedHead = expectedHeadIndex === -1 ? null : process.argv[expectedHeadIndex + 1];

function gitOutput(args) {
  const result = spawnSync("git", args, { cwd: ROOT, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args[0]} failed`);
  return result.stdout.trim();
}

function requireTrackedHeadFile(relativePath) {
  gitOutput(["ls-files", "--error-unmatch", relativePath]);
  const result = spawnSync("git", ["diff", "--quiet", "HEAD", "--", relativePath], { cwd: ROOT });
  if (result.status !== 0) throw new Error(`tracked verification input differs from HEAD: ${relativePath}`);
}

if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 12) {
  throw new Error("--concurrency must be an integer from 1 to 12");
}
if (!process.env.CLOUDFLARE_API_TOKEN || !/^[a-f0-9]{32}$/i.test(process.env.CLOUDFLARE_ACCOUNT_ID || "")) {
  throw new Error("Cloudflare token/account environment is missing or invalid");
}
if (!expectedHead || !/^[a-f0-9]{40}$/i.test(expectedHead) || gitOutput(["rev-parse", "HEAD"]) !== expectedHead) {
  throw new Error("--expected-head must match the current 40-character commit SHA");
}
for (const relativePath of [
  "scripts/verification/verify_r2_preview.mjs",
  "assets/manifests/r2-upload-preview.json",
]) {
  requireTrackedHeadFile(relativePath);
}
if (gitOutput(["status", "--porcelain", "--untracked-files=all"])) {
  throw new Error("working tree must be clean before remote verification");
}
if (manifest.bucketName !== "invillage-media-preview" || manifest.items.length !== 427) {
  throw new Error("unexpected R2 Preview manifest");
}
if (!manifest.bucketCreationAuthorized || !manifest.publicAccessAuthorized || !manifest.uploadAuthorized) {
  throw new Error("Preview remote authorization flags are not all true");
}
const baseUrl = new URL(manifest.publicBaseUrl);
if (baseUrl.href.replace(/\/$/, "") !== expectedPublicBaseUrl) {
  throw new Error("Preview publicBaseUrl does not match provider readback");
}
if (new Set(manifest.items.map((item) => item.r2Key)).size !== manifest.items.length) {
  throw new Error("duplicate R2 keys in manifest");
}
for (const item of manifest.items) {
  if (item.remoteUrl !== `${expectedPublicBaseUrl}/${item.r2Key}`) {
    throw new Error(`remote URL mismatch: ${item.r2Key}`);
  }
}

async function verifyManagedDomain() {
  const url = `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/r2/buckets/${manifest.bucketName}/domains/managed`;
  const response = await fetch(url, { headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` } });
  const payload = await response.json().catch(() => ({}));
  const providerOrigin = payload.result?.domain ? `https://${payload.result.domain}` : null;
  if (!response.ok || payload.success !== true || payload.result?.enabled !== true ||
      providerOrigin !== expectedPublicBaseUrl) {
    throw new Error("provider managed-domain readback does not match the target bucket and manifest");
  }
}

async function listRemoteObjects() {
  const objects = [];
  let cursor = null;
  do {
    const url = new URL(
      `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/r2/buckets/${manifest.bucketName}/objects`,
    );
    url.searchParams.set("per_page", "1000");
    if (cursor) url.searchParams.set("cursor", cursor);
    const response = await fetch(url, { headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.success !== true || !Array.isArray(payload.result)) {
      throw new Error(`R2 object list failed with HTTP ${response.status}`);
    }
    objects.push(...payload.result);
    cursor = payload.result_info?.is_truncated ? payload.result_info?.cursor : null;
  } while (cursor);
  return objects;
}

await verifyManagedDomain();
const remoteObjects = await listRemoteObjects();
const remoteByKey = new Map(remoteObjects.map((item) => [item.key, item]));
const metadataFailures = [];
for (const expected of manifest.items) {
  const actual = remoteByKey.get(expected.r2Key);
  if (!actual) {
    metadataFailures.push({ key: expected.r2Key, reason: "missing" });
    continue;
  }
  if (actual.size !== expected.bytes) metadataFailures.push({ key: expected.r2Key, reason: "bytes" });
  if (actual.storage_class !== "Standard") metadataFailures.push({ key: expected.r2Key, reason: "storageClass" });
  if (actual.http_metadata?.contentType !== expected.contentType) {
    metadataFailures.push({ key: expected.r2Key, reason: "contentType" });
  }
  if (actual.http_metadata?.cacheControl !== expectedCacheControl) {
    metadataFailures.push({ key: expected.r2Key, reason: "cacheControl" });
  }
}
for (const key of remoteByKey.keys()) {
  if (!manifest.items.some((item) => item.r2Key === key)) metadataFailures.push({ key, reason: "unexpected" });
}

let cursor = 0;
let verified = 0;
let stopped = false;
const contentFailures = [];
async function verifyContent(item) {
  const response = await fetch(item.remoteUrl, { redirect: "error" });
  if (!response.ok || !response.body) return { key: item.r2Key, reason: `http-${response.status}` };
  if ((response.headers.get("content-type") || "").split(";")[0] !== item.contentType) {
    return { key: item.r2Key, reason: "public-content-type" };
  }
  if (response.headers.get("cache-control") !== expectedCacheControl) {
    return { key: item.r2Key, reason: "public-cache-control" };
  }
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of response.body) {
    hash.update(chunk);
    bytes += chunk.length;
  }
  if (bytes !== item.bytes) return { key: item.r2Key, reason: "public-bytes" };
  if (hash.digest("hex") !== item.sha256) return { key: item.r2Key, reason: "public-sha256" };
  return null;
}

async function worker() {
  while (!stopped) {
    const index = cursor;
    cursor += 1;
    if (index >= manifest.items.length) return;
    const failure = await verifyContent(manifest.items[index]).catch(() => ({
      key: manifest.items[index].r2Key,
      reason: "request-failed",
    }));
    if (failure) {
      contentFailures.push(failure);
      stopped = true;
      return;
    }
    verified += 1;
    if (verified % 50 === 0 || verified === manifest.items.length) {
      console.log(JSON.stringify({ progress: verified, expected: manifest.items.length }));
    }
  }
}

if (remoteObjects.length === manifest.items.length && metadataFailures.length === 0) {
  await Promise.all(Array.from({ length: Math.min(concurrency, manifest.items.length) }, () => worker()));
}

const report = {
  bucket: manifest.bucketName,
  expectedObjects: manifest.items.length,
  remoteObjects: remoteObjects.length,
  metadataFailureCount: metadataFailures.length,
  metadataFailures: metadataFailures.slice(0, 20),
  contentVerified: verified,
  contentFailureCount: contentFailures.length,
  contentFailures: contentFailures.slice(0, 20),
};
console.log(JSON.stringify(report));
if (metadataFailures.length > 0 || contentFailures.length > 0 || verified !== manifest.items.length) process.exit(1);
