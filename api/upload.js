
const { readSession } = require("../lib/auth");

const IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "video/mp4"
];

const RELEASE_TYPES = [
  "application/octet-stream",
  "application/x-msdownload",
  "application/vnd.microsoft.portable-executable",
  "application/x-msi",
  "application/zip"
];

function send(res, status, data) {
  return res.status(status).json(data);
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return send(res, 405, { error: "Method not allowed" });
  }

  try {
    const body = req.body;

    const { handleUpload } = await import("@vercel/blob/client");

    const result = await handleUpload({
      body,
      request: req,

      onBeforeGenerateToken: async (pathname) => {
        const session = readSession(req);

        if (!session) {
          throw new Error("Unauthorized");
        }

        if (
          typeof pathname !== "string" ||
          pathname.includes("..") ||
          pathname.includes("\\")
        ) {
          throw new Error("Invalid file path");
        }

        const isGallery = pathname.startsWith("gallery/");
        const isRelease = pathname.startsWith("releases/");

        if (!isGallery && !isRelease) {
          throw new Error("Invalid upload folder");
        }

        const extension = pathname.split(".").pop().toLowerCase();

        const galleryExtensions = [
          "jpg", "jpeg", "png", "webp", "gif", "mp4"
        ];

        const releaseExtensions = [
          "exe", "msi", "zip"
        ];

        if (
          isGallery &&
          !galleryExtensions.includes(extension)
        ) {
          throw new Error("Unsupported gallery file");
        }

        if (
          isRelease &&
          !releaseExtensions.includes(extension)
        ) {
          throw new Error("Unsupported installer file");
        }

        return {
          allowedContentTypes: isGallery
            ? IMAGE_TYPES
            : RELEASE_TYPES,
          addRandomSuffix: true
        };
      },

      onUploadCompleted: async ({ blob }) => {
        console.log("FVREVER upload completed:", blob.url);
      }
    });

    return send(res, 200, result);

  } catch (error) {
    console.error("Upload error:", error);

    const message =
      error.message === "Unauthorized"
        ? "Unauthorized"
        : "Upload failed";

    return send(
      res,
      message === "Unauthorized" ? 401 : 400,
      { error: message }
    );
  }
};
