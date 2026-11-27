
const { readSession } = require("../lib/auth");
const path = require("path");

const MAX_FILE_SIZE = 500 * 1024 * 1024;
const MAX_RELEASES = 3;

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
    // 1. Verificar sesión de administrador
    const session = await readSession(req);

    if (!session || session.sub !== "fvrever") {
      return res.status(401).json({
        success: false,
        error: "Unauthorized"
      });
    }

    // 2. Configuración del Blob privado
    const storeId = process.env.REALSES_STORE_ID;
    const webhookKey = process.env.REALSES_WEBHOOK_PUBLIC_KEY;

    if (!storeId || !webhookKey) {
      throw new Error("Private Blob configuration is missing");
    }

    const {
      handleUploadPresigned
    } = await import("@vercel/blob/client");

    const {
      issueSignedToken,
      list
    } = await import("@vercel/blob");

    // 3. Gestionar autorización de subida
    const result = await handleUploadPresigned({
      body: req.body,
      request: req,
      webhookPublicKey: webhookKey,

      getSignedToken: async (pathname) => {
        // Validar ruta
        if (
          typeof pathname !== "string" ||
          !pathname.startsWith("releases/") ||
          pathname.includes("..") ||
          pathname.includes("\\")
        ) {
          throw new Error("Invalid file path");
        }

        // Validar extensión
        const filename = path.basename(pathname);
        const extension = path.extname(filename).toLowerCase();

        if (!ALLOWED_EXTENSIONS.includes(extension)) {
          throw new Error("Only EXE, MSI and ZIP files are allowed");
        }

        // 4. Comprobar límite de archivos
        const existing = await list({
          prefix: "releases/",
          limit: 100,
          storeId
        });

        if (existing.blobs.length >= MAX_RELEASES) {
          throw new Error(
            "MAX_RELEASES_REACHED: You can only store 3 launchers. Delete one before uploading another."
          );
        }

        // 5. Crear autorización temporal
        const validUntil = Date.now() + 10 * 60 * 1000;

        const token = await issueSignedToken({
          pathname,
          operations: ["put"],
          storeId,
          allowedContentTypes: ALLOWED_TYPES,
          maximumSizeInBytes: MAX_FILE_SIZE,
          validUntil
        });

        return {
          token,
          urlOptions: {
            allowedContentTypes: ALLOWED_TYPES,
            maximumSizeInBytes: MAX_FILE_SIZE,
            addRandomSuffix: true,
            allowOverwrite: false,
            validUntil
          }
        };
      },

      // 6. Confirmar subida
      onUploadCompleted: async ({ blob }) => {
        console.log("Private release uploaded:", {
          pathname: blob.pathname,
          size: blob.size,
          contentType: blob.contentType
        });
      }
    });

    return res.status(200).json({
      success: true,
      result
    });

  } catch (error) {
    console.error("Private release upload error:", error);

    const message = error.message || "";

    if (message.includes("MAX_RELEASES_REACHED")) {
      return res.status(409).json({
        success: false,
        error: "Ya tienes 3 launchers almacenados. Elimina uno antes de subir otro."
      });
    }

    if (
      message === "Unauthorized" ||
      message.includes("Unauthorized")
    ) {
      return res.status(401).json({
        success: false,
        error: "Unauthorized"
      });
    }

    if (
      message.includes("Invalid file path") ||
      message.includes("Only EXE")
    ) {
      return res.status(400).json({
        success: false,
        error: message
      });
    }

    return res.status(500).json({
      success: false,
      error: "No se pudo autorizar la subida del launcher."
    });
  }
};
