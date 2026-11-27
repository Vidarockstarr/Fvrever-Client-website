
const { readSession } = require("../lib/auth");
const { issueSignedToken, presignUrl, list } = require("@vercel/blob");
const path = require("path");
const crypto = require("crypto");

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

  if (!storeId) {
    throw new Error("REALSES_STORE_ID is missing");
  }

  return storeId;
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({
      success: false,
      error: "Method not allowed"
    });
  }

  try {
    const session = await readSession(req);

    if (!session || session.sub !== "fvrever") {
      return res.status(401).json({
        success: false,
        error: "Unauthorized"
      });
    }

    const storeId = getReleasesStoreId();

    let body = req.body;
    if (typeof body === "string") body = JSON.parse(body);

    const filename = body?.filename;
    const version = body?.version;

    if (
      typeof filename !== "string" ||
      typeof version !== "string" ||
      !filename.trim() ||
      !version.trim()
    ) {
      return res.status(400).json({
        success: false,
        error: "Invalid filename or version"
      });
    }

    const safeFilename = path.basename(filename.trim());

    if (
      safeFilename !== filename.trim() ||
      safeFilename.includes("..") ||
      safeFilename.includes("/") ||
      safeFilename.includes("\\")
    ) {
      return res.status(400).json({
        success: false,
        error: "Invalid filename"
      });
    }

    if (!ALLOWED_EXTENSIONS.includes(path.extname(safeFilename).toLowerCase())) {
      return res.status(400).json({
        success: false,
        error: "Only EXE, MSI and ZIP files are allowed"
      });
    }

    const { get } = await import("@vercel/blob");

    const [inventory, stored] = await Promise.all([
      list({
        prefix: "releases/",
        limit: 100,
        storeId
      }),
      get("release-manifest.json", {
        access: "private",
        storeId
      })
    ]);

    let manifest = {};

    if (stored?.statusCode === 200 && stored.stream) {
      const chunks = [];

      for await (const chunk of stored.stream) {
        chunks.push(Buffer.from(chunk));
      }

      try {
        manifest = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        manifest = {};
      }
    }

    const present = new Set(
      inventory.blobs.map(blob => blob.pathname)
    );

    const releases = Object.values(manifest).filter(
      item => item && present.has(item.pathname)
    );

    if (releases.length >= MAX_RELEASES) {
      return res.status(409).json({
        success: false,
        error: "Ya tienes 3 launchers almacenados. Elimina uno antes de subir otro."
      });
    }

    const pathname = `releases/${crypto.randomUUID()}-${safeFilename}`;
    const validUntil = Date.now() + URL_VALIDITY;

    const signedToken = await issueSignedToken({
      pathname,
      operations: ["put"],
      validUntil,
      allowedContentTypes: ALLOWED_TYPES,
      maximumSizeInBytes: MAX_FILE_SIZE,
      storeId
    });

    const { presignedUrl } = await presignUrl(signedToken, {
      pathname,
      operation: "put",
      access: "private",
      validUntil,
      allowedContentTypes: ALLOWED_TYPES,
      maximumSizeInBytes: MAX_FILE_SIZE,
      addRandomSuffix: false,
      allowOverwrite: false
    });

    return res.status(200).json({
      success: true,
      uploadUrl: presignedUrl,
      pathname,
      filename: safeFilename,
      version,
      expiresAt: validUntil
    });

  } catch (error) {
    console.error("Private release upload error:", error);

    return res.status(500).json({
      success: false,
      error: "No se pudo autorizar la subida del launcher."
    });
  }
};
