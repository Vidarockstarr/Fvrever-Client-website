const { get } = require("@vercel/blob");
const { Readable } = require("stream");
const { getCookie, verifyDownloadToken, consumeAuthorizedDownload } = require("../lib/release-access");
module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, private");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (req.method !== "GET") { res.setHeader("Allow", "GET"); return res.status(405).end("Method not allowed"); }
  try {
    const token = getCookie(req, "fvrever_download");
    const downloadId = verifyDownloadToken(token);
    if (!downloadId) return res.status(403).end("Download access is not authorized.");
    const pathname = String(req.query?.pathname || "");
    if (!pathname.startsWith("releases/") || pathname.includes("..") || pathname.includes("\\") || pathname.length > 1024) return res.status(400).end("Invalid release.");
    const storeId = process.env.BLOB_STORE_ID || process.env.REALSES_STORE_ID;
    const { list } = await import("@vercel/blob");
    const inventory = await list({ prefix: "releases/", limit: 100, ...(storeId ? { storeId } : {}) });
    const blob = inventory.blobs.find(item => item.pathname === pathname);
    if (!blob) return res.status(404).end("Release not found.");
    const result = await get(pathname, { access: "private" });
    if (!result || result.statusCode !== 200 || !result.stream) return res.status(404).end("Release file not found.");
    // Atomic transition: even simultaneous requests can consume this authorization only once.
    if (!(await consumeAuthorizedDownload(downloadId))) return res.status(409).end("This gift key download has already been used.");
    const requestedName = String(req.query?.filename || "").trim();
    const filename = (requestedName || pathname.split("/").pop()).replace(/[\r\n"\\]/g, "_").slice(0, 180);
    res.statusCode = 200;
    res.setHeader("Content-Type", result.blob.contentType || "application/octet-stream");
    const size = result.blob.size || blob.size;
    if (Number.isFinite(Number(size)) && Number(size) > 0) res.setHeader("Content-Length", String(size));
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    Readable.fromWeb(result.stream).on("error", error => { console.error("Release stream error:", error); res.destroy(error); }).pipe(res);
  } catch (error) {
    console.error("Release download error:", error);
    if (!res.headersSent) res.status(500).end("Could not download this release."); else res.destroy(error);
  }
};
