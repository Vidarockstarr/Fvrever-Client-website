
const { list } = require("@vercel/blob");
const {
  getCookie,
  verifyDownloadToken,
  hasAuthorizedDownload
} = require("../lib/release-access");

const MANIFEST = "release-manifest.json";

function getReleasesStoreId() {
  const storeId = process.env.REALSES_STORE_ID;

  if (!storeId) {
    throw new Error("REALSES_STORE_ID is missing");
  }

  return storeId;
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, private");

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");

    return res.status(405).json({
      success: false,
      error: "Method not allowed"
    });
  }

  try {
    const token = getCookie(req, "fvrever_download");
    const downloadId = verifyDownloadToken(token);

    if (
      !downloadId ||
      !(await hasAuthorizedDownload(downloadId))
    ) {
      return res.status(403).json({
        success: false,
        error: "Download access is not authorized."
      });
    }

    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      throw new Error("BLOB_READ_WRITE_TOKEN is missing");
    }

    const storeId = getReleasesStoreId();

    const { get } = await import("@vercel/blob");

    const [stored, result] = await Promise.all([
      get(MANIFEST, {
        access: "private",
        storeId
      }),
      list({
        prefix: "releases/",
        limit: 100,
        storeId
      })
    ]);

    let manifest = {};

    if (stored?.statusCode === 200 && stored.stream) {
      const chunks = [];

      for await (const chunk of stored.stream) {
        chunks.push(Buffer.from(chunk));
      }

      manifest = JSON.parse(
        Buffer.concat(chunks).toString("utf8")
      );
    }

    const existing = new Set(
      result.blobs.map(blob => blob.pathname)
    );

    const releases = Object.values(manifest)
      .filter(
        item =>
          item &&
          existing.has(item.pathname)
      )
      .sort(
        (a, b) =>
          new Date(b.uploadedAt || 0) -
          new Date(a.uploadedAt || 0)
      );

    return res.status(200).json({
      success: true,
      releases
    });

  } catch (error) {
    console.error("Private releases list error:", error);

    return res.status(500).json({
      success: false,
      error: "Could not load releases."
    });
  }
};
