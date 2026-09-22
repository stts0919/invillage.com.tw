#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createReadStream, existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const MANIFEST_PATH = resolve(ROOT, "assets/manifests/r2-upload-preview.json");
const WRANGLER_PATH = resolve(ROOT, "node_modules/.bin/wrangler");
const EXPECTED_BUCKET = "invillage-media-preview";
const EXPECTED_PUBLIC_BASE_URL = "https://pub-a73a77b87d504498bad6ae568754e572.r2.dev";
const EXPECTED_WRANGLER_VERSION = "4.136.1";
const EXPECTED_SUMMARY = {
  objectCount: 427,
  assetCount: 123,
  totalBytes: 113_523_148,
  avifCount: 65,
  runtimeEnabledCount: 362,
};
const EXPECTED_CACHE_CONTROL = "public, max-age=31536000, immutable";
const CONTENT_TYPES = new Map([
  [".avif", "image/avif"],
  [".jpg", "image/jpeg"],
  [".png", "image/png"],
  [".webp", "image/webp"],
]);

function parseArgs(argv) {
  const options = {
    apply: false,
    concurrency: 4,
    startIndex: 0,
    limit: null,
    expectedHead: null,
    expectedAccountId: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply") options.apply = true;
    else if (arg === "--concurrency") options.concurrency = Number(argv[++index]);
    else if (arg === "--start-index") options.startIndex = Number(argv[++index]);
    else if (arg === "--limit") options.limit = Number(argv[++index]);
    else if (arg === "--expected-head") options.expectedHead = argv[++index];
    else if (arg === "--expected-account-id") options.expectedAccountId = argv[++index];
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!Number.isInteger(options.concurrency) || options.concurrency < 1 || options.concurrency > 8) {
    throw new Error("--concurrency must be an integer from 1 to 8");
  }
  if (!Number.isInteger(options.startIndex) || options.startIndex < 0) {
    throw new Error("--start-index must be a non-negative integer");
  }
  if (options.limit !== null && (!Number.isInteger(options.limit) || options.limit < 1)) {
    throw new Error("--limit must be a positive integer");
  }
  return options;
}

function sha256File(path) {
  return new Promise((resolveHash, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolveHash(hash.digest("hex")));
  });
}

function gitOutput(args) {
  const result = spawnSync("git", args, { cwd: ROOT, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args[0]} failed`);
  return result.stdout.trim();
}

function requireTrackedHeadFile(relativePath) {
  gitOutput(["ls-files", "--error-unmatch", relativePath]);
  const result = spawnSync("git", ["diff", "--quiet", "HEAD", "--", relativePath], { cwd: ROOT });
  if (result.status !== 0) throw new Error(`tracked deployment input differs from HEAD: ${relativePath}`);
}

async function validateManifest() {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
  if (manifest.bucketName !== EXPECTED_BUCKET) throw new Error("unexpected Preview bucket name");
  if (!manifest.bucketCreationAuthorized || !manifest.publicAccessAuthorized || !manifest.uploadAuthorized) {
    throw new Error("Preview remote authorization flags are not all true");
  }
  if (JSON.stringify(manifest.summary) !== JSON.stringify(EXPECTED_SUMMARY)) {
    throw new Error("unexpected R2 Preview manifest summary");
  }
  const baseUrl = new URL(manifest.publicBaseUrl);
  if (baseUrl.href.replace(/\/$/, "") !== EXPECTED_PUBLIC_BASE_URL) {
    throw new Error("publicBaseUrl does not match the provider readback");
  }
  const items = manifest.items;
  if (!Array.isArray(items) || items.length !== EXPECTED_SUMMARY.objectCount) {
    throw new Error("unexpected R2 Preview item count");
  }
  if (new Set(items.map((item) => item.r2Key)).size !== items.length) {
    throw new Error("duplicate R2 keys in manifest");
  }

  let totalBytes = 0;
  for (const item of items) {
    const absolutePath = resolve(ROOT, item.localPath);
    if (!absolutePath.startsWith(`${ROOT}${sep}`) || !existsSync(absolutePath)) {
      throw new Error(`missing or out-of-root source: ${item.localPath}`);
    }
    if (lstatSync(absolutePath).isSymbolicLink() || realpathSync(absolutePath) !== absolutePath) {
      throw new Error(`symlinked source is not allowed: ${item.localPath}`);
    }
    const extension = item.r2Key.slice(item.r2Key.lastIndexOf(".")).toLowerCase();
    if (CONTENT_TYPES.get(extension) !== item.contentType) throw new Error(`content type mismatch: ${item.r2Key}`);
    if (item.cacheControl !== EXPECTED_CACHE_CONTROL) throw new Error(`cache policy mismatch: ${item.r2Key}`);
    if (item.remoteUrl !== `${manifest.publicBaseUrl}/${item.r2Key}`) throw new Error(`remote URL mismatch: ${item.r2Key}`);
    const stat = lstatSync(absolutePath);
    if (!stat.isFile() || stat.size !== item.bytes) throw new Error(`bytes mismatch: ${item.r2Key}`);
    if ((await sha256File(absolutePath)) !== item.sha256) throw new Error(`sha256 mismatch: ${item.r2Key}`);
    totalBytes += stat.size;
  }
  if (totalBytes !== EXPECTED_SUMMARY.totalBytes) throw new Error("total bytes mismatch");
  return { manifest, items };
}

function uploadObject(item) {
  const args = [
    "r2", "object", "put", `${EXPECTED_BUCKET}/${item.r2Key}`,
    "--file", resolve(ROOT, item.localPath),
    "--content-type", item.contentType,
    "--cache-control", item.cacheControl,
    "--storage-class", "Standard",
    "--remote",
    "--force",
  ];
  return new Promise((resolveUpload) => {
    const child = spawn(WRANGLER_PATH, args, {
      cwd: ROOT,
      env: {
        ...process.env,
        WRANGLER_LOG_PATH: process.env.WRANGLER_LOG_PATH || "/tmp/invillage-wrangler-logs",
        WRANGLER_LOG_SANITIZE: "true",
        WRANGLER_SEND_METRICS: "false",
        FORCE_COLOR: "0",
      },
      stdio: ["ignore", "ignore", "ignore"],
    });
    child.on("error", () => resolveUpload({ ok: false, status: null }));
    child.on("exit", (status) => resolveUpload({ ok: status === 0, status }));
  });
}

const options = parseArgs(process.argv.slice(2));
const { manifest, items } = await validateManifest();
if (!existsSync(WRANGLER_PATH)) throw new Error("project-local Wrangler is missing");
const versionResult = spawnSync(WRANGLER_PATH, ["--version"], {
  cwd: ROOT,
  encoding: "utf8",
  env: {
    ...process.env,
    WRANGLER_LOG_PATH: process.env.WRANGLER_LOG_PATH || "/tmp/invillage-wrangler-logs",
    WRANGLER_LOG_SANITIZE: "true",
    WRANGLER_SEND_METRICS: "false",
  },
});
if (versionResult.status !== 0 || versionResult.stdout.trim() !== EXPECTED_WRANGLER_VERSION) {
  throw new Error("project-local Wrangler version mismatch");
}

if (!options.apply) {
  console.log(JSON.stringify({ mode: "dry-run", bucket: manifest.bucketName, ...manifest.summary }));
  process.exit(0);
}

if (!process.env.CLOUDFLARE_API_TOKEN || !/^[a-f0-9]{32}$/i.test(process.env.CLOUDFLARE_ACCOUNT_ID || "")) {
  throw new Error("Cloudflare token/account environment is missing or invalid");
}
if (!/^[a-f0-9]{32}$/i.test(options.expectedAccountId || "") ||
    options.expectedAccountId !== process.env.CLOUDFLARE_ACCOUNT_ID) {
  throw new Error("--expected-account-id must match the injected Cloudflare account");
}
if (process.env.INVILLAGE_R2_PREVIEW_WRITE !== "authorized") {
  throw new Error("INVILLAGE_R2_PREVIEW_WRITE=authorized is required for --apply");
}
if (!options.expectedHead || !/^[a-f0-9]{40}$/i.test(options.expectedHead)) {
  throw new Error("--expected-head must be an explicit 40-character commit SHA");
}
const actualHead = gitOutput(["rev-parse", "HEAD"]);
if (actualHead !== options.expectedHead) throw new Error("HEAD does not match --expected-head");
for (const relativePath of [
  "scripts/deployment/upload_r2_preview.mjs",
  "assets/manifests/r2-upload-preview.json",
  "package.json",
  "package-lock.json",
]) {
  requireTrackedHeadFile(relativePath);
}
if (gitOutput(["status", "--porcelain", "--untracked-files=all"])) {
  throw new Error("working tree must be clean before upload");
}

const selected = items.slice(options.startIndex, options.limit === null ? undefined : options.startIndex + options.limit);
if (selected.length === 0) throw new Error("upload selection is empty");

let cursor = 0;
let uploaded = 0;
let stopped = false;
const failures = [];
async function worker() {
  while (!stopped) {
    const index = cursor;
    cursor += 1;
    if (index >= selected.length) return;
    const item = selected[index];
    const result = await uploadObject(item);
    if (!result.ok) {
      stopped = true;
      failures.push({ selectionIndex: index, r2Key: item.r2Key, exitCode: result.status });
      return;
    }
    uploaded += 1;
    if (uploaded % 25 === 0 || uploaded === selected.length) {
      console.log(JSON.stringify({ progress: uploaded, selected: selected.length }));
    }
  }
}

await Promise.all(Array.from({ length: Math.min(options.concurrency, selected.length) }, () => worker()));
console.log(JSON.stringify({
  mode: "apply",
  expectedHead: options.expectedHead,
  bucket: manifest.bucketName,
  startIndex: options.startIndex,
  selected: selected.length,
  uploaded,
  failures,
}));
if (failures.length > 0 || uploaded !== selected.length) process.exit(1);
