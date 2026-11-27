const { get, list, del, put, issueSignedToken, presignUrl } = require("@vercel/blob");
const { Readable } = require("stream");
const path = require("path");
const crypto = require("crypto");
const { readSession } = require("../lib/auth");
const {
  getCookie,
  verifyDownloadToken,
  consumeAuthorizedDownload,
  hasAuthorizedDownload
} = require("../lib/release-access");

const MANIFEST = "release-manifest.json";
const MAX_FILE_SIZE = 500 * 1024 * 1024;
const MAX_RELEASES = 3;
const URL_VALIDITY = 10 * 60 * 1000;
const ALLOWED_EXTENSIONS = [".exe", ".msi", ".zip"];
const ALLOWED_TYPES = [
  "application/octet-stream",
  "application/x-msdownload",
  "application/vnd.microsoft.portable-executable",
  "application/x-msi",
  "application/zip"
];

function getReleasesStoreId() {
  const storeId = process.env.REALSES_STORE_ID;
  if (!storeId) throw new Error("REALSES_STORE_ID is missing");
  return storeId;
}

function storeOptions() {
  return { storeId: getReleasesStoreId() };
}

function validPath(value) {
  return typeof value === "string" &&
    value.startsWith("releases/") &&
    !value.includes("..") &&
    !value.includes("\\") &&
    value.length <= 1024;
}

async function readManifest() {
  const stored = await get(MANIFEST, { access: "private", ...storeOptions() });
  if (!stored || stored.statusCode !== 200 || !stored.stream) return {};
  const chunks = [];
  for await (const chunk of stored.stream) chunks.push(Buffer.from(chunk));
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { return {}; }
}

async function writeManifest(manifest) {
  await put(MANIFEST, JSON.stringify(manifest), {
    access: "private",
    ...storeOptions(),
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
    cacheControlMaxAge: 0
  });
}

async function requireAdmin(req, res) {
  const session = await readSession(req);
  if (!session || session.sub !== "fvrever") {
    res.status(401).json({ success: false, error: "Unauthorized" });
    return false;
  }
  return true;
}

async function handleDownload(req, res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).end("Method not allowed");
  }

  const token = getCookie(req, "fvrever_download");
  const downloadId = verifyDownloadToken(token);
  if (!downloadId) return res.status(403).end("Download access is not authorized.");

  const pathname = String(req.query?.pathname || "");
  if (!validPath(pathname)) return res.status(400).end("Invalid release.");
  if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error("BLOB_READ_WRITE_TOKEN is missing");

  const storeId = getReleasesStoreId();
  const inventory = await list({ prefix: "releases/", limit: 100, storeId });
  const blob = inventory.blobs.find(item => item.pathname === pathname);
  if (!blob) return res.status(404).end("Release not found.");

  const result = await get(pathname, { access: "private", storeId });
  if (!result || result.statusCode !== 200 || !result.stream) {
    return res.status(404).end("Release file not found.");
  }

  // Conserva el consumo atómico: cada autorización de descarga se usa una sola vez.
  if (!(await consumeAuthorizedDownload(downloadId))) {
    return res.status(409).end("This gift key download has already been used.");
  }

  const requestedName = String(req.query?.filename || "").trim();
  const filename = (requestedName || pathname.split("/").pop())
    .replace(/[\r\n"\\]/g, "_")
    .slice(0, 180);

  res.statusCode = 200;
  res.setHeader("Cache-Control", "no-store, private");
  res.setHeader("Content-Type", result.blob.contentType || "application/octet-stream");
  const size = result.blob.size || blob.size;
  if (Number.isFinite(Number(size)) && Number(size) > 0) {
    res.setHeader("Content-Length", String(size));
  }
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  Readable.fromWeb(result.stream)
    .on("error", error => {
      console.error("Release stream error:", error);
      res.destroy(error);
    })
    .pipe(res);
}

async function handleList(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }
  const token = getCookie(req, "fvrever_download");
  const downloadId = verifyDownloadToken(token);
  if (!downloadId || !(await hasAuthorizedDownload(downloadId))) {
    return res.status(403).json({ success: false, error: "Download access is not authorized." });
  }
  if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error("BLOB_READ_WRITE_TOKEN is missing");
  const storeId = getReleasesStoreId();
  const [manifest, inventory] = await Promise.all([
    readManifest(),
    list({ prefix: "releases/", limit: 100, storeId })
  ]);
  const byPath = new Map(inventory.blobs.map(blob => [blob.pathname, blob]));
  const releases = Object.values(manifest)
    .filter(item => item && byPath.has(item.pathname))
    .map(item => ({ ...item, size: byPath.get(item.pathname).size }))
    .sort((a, b) => new Date(b.uploadedAt || 0) - new Date(a.uploadedAt || 0));
  return res.status(200).json({ success: true, releases });
}

async function handleManage(req, res) {
  if (!(await requireAdmin(req, res))) return;
  if (req.method === "GET") {
    const [inventory, manifest] = await Promise.all([
      list({ prefix: "releases/", limit: 100, ...storeOptions() }),
      readManifest()
    ]);
    const blobByPath = new Map(inventory.blobs.map(blob => [blob.pathname, blob]));
    const releases = Object.values(manifest)
      .filter(item => item && blobByPath.has(item.pathname))
      .map(item => {
        const blob = blobByPath.get(item.pathname);
        return { ...item, sizeBytes: blob.size, sizeValid: Number(blob.size) > 0 };
      })
      .sort((a, b) => new Date(b.uploadedAt || 0) - new Date(a.uploadedAt || 0));
    return res.status(200).json({ success: true, releases });
  }

  let body = req.body;
  if (typeof body === "string") body = JSON.parse(body);

  if (req.method === "PUT") {
    const {
      pathname, version, name, description = "", icon = "📦", filename = "",
      uploadedAt = new Date().toISOString()
    } = body || {};
    if (!validPath(pathname) || typeof version !== "string" || !version.trim() ||
        typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ success: false, error: "Invalid release metadata." });
    }
    const inventory = await list({ prefix: "releases/", limit: 100, ...storeOptions() });
    const blob = inventory.blobs.find(item => item.pathname === pathname);
    if (!blob) return res.status(404).json({ success: false, error: "Uploaded release not found." });

    const storedSizeBytes = Number(blob.size);
    console.log("Release storage verification:", {
      pathname, storedSizeBytes,
      sizeValid: Number.isFinite(storedSizeBytes) && storedSizeBytes > 0
    });
    if (!Number.isFinite(storedSizeBytes) || storedSizeBytes <= 0) {
      return res.status(409).json({
        success: false,
        error: "El archivo existe en Blob, pero está vacío o su tamaño no pudo verificarse.",
        pathname,
        storedSizeBytes: Number.isFinite(storedSizeBytes) ? storedSizeBytes : null
      });
    }

    const manifest = await readManifest();
    manifest[pathname] = {
      pathname,
      version: version.trim().slice(0, 40),
      name: name.trim().slice(0, 100),
      description: String(description).slice(0, 1000),
      icon: String(icon).slice(0, 12),
      filename: String(filename).slice(0, 180),
      sizeBytes: storedSizeBytes,
      uploadedAt
    };
    await writeManifest(manifest);
    return res.status(200).json({ success: true, release: manifest[pathname], storedSizeBytes });
  }

  if (req.method === "DELETE") {
    const pathname = body?.pathname;
    if (!validPath(pathname)) {
      return res.status(400).json({ success: false, error: "Invalid release pathname." });
    }
    const inventory = await list({ prefix: "releases/", limit: 100, ...storeOptions() });
    if (!inventory.blobs.some(blob => blob.pathname === pathname)) {
      return res.status(404).json({ success: false, error: "Release not found." });
    }
    await del(pathname, storeOptions());
    const manifest = await readManifest();
    delete manifest[pathname];
    await writeManifest(manifest);
    return res.status(200).json({ success: true });
  }

  res.setHeader("Allow", "GET, PUT, DELETE");
  return res.status(405).json({ success: false, error: "Method not allowed" });
}

async function handleUpload(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }
  if (!(await requireAdmin(req, res))) return;
  const storeId = getReleasesStoreId();
  let body = req.body;
  if (typeof body === "string") body = JSON.parse(body);
  const filename = body?.filename;
  const version = body?.version;
  if (typeof filename !== "string" || typeof version !== "string" || !filename.trim() || !version.trim()) {
    return res.status(400).json({ success: false, error: "Invalid filename or version" });
  }
  const safeFilename = path.basename(filename.trim());
  if (safeFilename !== filename.trim() || safeFilename.includes("..") ||
      safeFilename.includes("/") || safeFilename.includes("\\")) {
    return res.status(400).json({ success: false, error: "Invalid filename" });
  }
  if (!ALLOWED_EXTENSIONS.includes(path.extname(safeFilename).toLowerCase())) {
    return res.status(400).json({ success: false, error: "Only EXE, MSI and ZIP files are allowed" });
  }

  const [inventory, manifest] = await Promise.all([
    list({ prefix: "releases/", limit: 100, storeId }),
    readManifest()
  ]);
  const present = new Set(inventory.blobs.map(blob => blob.pathname));
  const releases = Object.values(manifest).filter(item => item && present.has(item.pathname));
  if (releases.length >= MAX_RELEASES) {
    return res.status(409).json({
      success: false,
      error: "Ya tienes 3 launchers almacenados. Elimina uno antes de subir otro."
    });
  }

  const pathname = `releases/${crypto.randomUUID()}-${safeFilename}`;
  const validUntil = Date.now() + URL_VALIDITY;
  const signedToken = await issueSignedToken({
    pathname, operations: ["put"], validUntil,
    allowedContentTypes: ALLOWED_TYPES,
    maximumSizeInBytes: MAX_FILE_SIZE,
    storeId
  });
  const { presignedUrl } = await presignUrl(signedToken, {
    pathname, operation: "put", access: "private", validUntil,
    allowedContentTypes: ALLOWED_TYPES,
    maximumSizeInBytes: MAX_FILE_SIZE,
    addRandomSuffix: false,
    allowOverwrite: false
  });
  return res.status(200).json({
    success: true, uploadUrl: presignedUrl, pathname,
    filename: safeFilename, version, expiresAt: validUntil
  });
}

module.exports = async function handler(req, res) {
  const action = String(req.query?.action || "").toLowerCase();
  res.setHeader("Cache-Control", "no-store, private");
  try {
    if (action === "download") return await handleDownload(req, res);
    if (action === "list") return await handleList(req, res);
    if (action === "manage") return await handleManage(req, res);
    if (action === "upload") return await handleUpload(req, res);
    return res.status(400).json({
      success: false,
      error: "Invalid releases action. Use list, download, manage or upload."
    });
  } catch (error) {
    console.error(`Releases API (${action || "unknown"}) error:`, error);
    if (res.headersSent) {
      res.destroy(error);
      return;
    }
    if (action === "download") return res.status(500).end("Could not download this release.");
    if (action === "list") return res.status(500).json({ success: false, error: "Could not load releases." });
    if (action === "manage") return res.status(500).json({ success: false, error: "Could not manage private releases." });
    if (action === "upload") return res.status(500).json({ success: false, error: "No se pudo autorizar la subida del launcher." });
    return res.status(500).json({ success: false, error: "Could not process releases request." });
  }
};
