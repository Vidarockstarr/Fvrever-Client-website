
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
    // 1. Autenticación
    const session = await readSession(req);

    if (!session || session.sub !== "fvrever") {
      return res.status(401).json({
        success: false,
        error: "Unauthorized"
      });
    }

    // 2. Validar configuración
    if (!process.env.BLOB_STORE_ID) {
      throw new Error("BLOB_STORE_ID is missing");
    }

    // 3. Leer datos
    let body = req.body;

    if (typeof body === "string") {
      body = JSON.parse(body);
    }

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

    // 4. Validar nombre y extensión
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

    const extension = path.extname(safeFilename).toLowerCase();

    if (!ALLOWED_EXTENSIONS.includes(extension)) {
      return res.status(400).json({
        success: false,
        error: "Only EXE, MSI and ZIP files are allowed"
      });
    }

    // 5. Comprobar límite de releases
    const existing = await list({
      prefix: "releases/",
      limit: MAX_RELEASES + 1
    });

    if (existing.blobs.length >= MAX_RELEASES) {
      return res.status(409).json({
        success: false,
        error: "Ya tienes 3 launchers almacenados. Elimina uno antes de subir otro."
      });
    }

    // 6. Crear una ruta única
    const uniqueName = `${crypto.randomUUID()}-${safeFilename}`;
    const pathname = `releases/${uniqueName}`;

    // 7. Generar token firmado
    const validUntil = Date.now() + URL_VALIDITY;

    const signedToken = await issueSignedToken({
      pathname,
      operations: ["put"],
      validUntil,
      allowedContentTypes: ALLOWED_TYPES,
      maximumSizeInBytes: MAX_FILE_SIZE
    });

    // 8. Generar URL temporal de subida
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

    console.log("Release upload authorized:", {
      filename: safeFilename,
      version,
      pathname
    });

    // 9. Respuesta compatible con admin.html
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
      error: "No se pudo autorizar la subida del launcher.",
      details: error.message || "Unknown error"
    });
  }
};
