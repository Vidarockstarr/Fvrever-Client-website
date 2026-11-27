
const { readSession } = require("../lib/auth");
const path = require("path");

const MAX_FILE_SIZE = 500 * 1024 * 1024;

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
    const session = await readSession(req);

    if (!session || session.sub !== "fvrever") {
      return res.status(401).json({
        success: false,
        error: "Unauthorized"
      });
    }

    const storeId = process.env.REALSES_STORE_ID;
    const webhookKey = process.env.REALSES_WEBHOOK_PUBLIC_KEY;

    if (!storeId || !webhookKey) {
      throw new Error("Private Blob configuration is missing");
    }

    const { handleUploadPresigned } =
      await import("@vercel/blob/client");

    const { issueSignedToken } =
      await import("@vercel/blob");

    const result = await handleUploadPresigned({
      body: req.body,
      request: req,
      webhookPublicKey: webhookKey,

      getSignedToken: async (pathname) => {
        const filename = path.basename(pathname);
        const extension = path.extname(filename).toLowerCase();

        if (!ALLOWED_EXTENSIONS.includes(extension)) {
          throw new Error("File type not allowed");
        }

        if (
          !pathname.startsWith("releases/") ||
          pathname.includes("..")
        ) {
          throw new Error("Invalid file path");
        }

        const token = await issueSignedToken({
          pathname,
          operations: ["put"],
          storeId,
          allowedContentTypes: ALLOWED_TYPES,
          maximumSizeInBytes: MAX_FILE_SIZE,
          validUntil: Date.now() + 10 * 60 * 1000
        });

        return {
          token,
          urlOptions: {
            allowedContentTypes: ALLOWED_TYPES,
            maximumSizeInBytes: MAX_FILE_SIZE,
            addRandomSuffix: true,
            allowOverwrite: false,
            validUntil: Date.now() + 10 * 60 * 1000
          }
        };
      },

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

    return res.status(500).json({
      success: false,
      error: "Upload failed"
    });
  }
};
