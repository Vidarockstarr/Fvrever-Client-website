
const { readSession } = require("../lib/auth");

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  try {
    // Only the administrator can manage private releases.
    const session = await readSession(req);

    if (!session || session.sub !== "fvrever") {
      return res.status(401).json({
        success: false,
        error: "Unauthorized"
      });
    }

    const storeId = process.env.REALSES_STORE_ID;

    if (!storeId) {
      throw new Error("Private Blob configuration is missing");
    }

    const { list, del } = await import("@vercel/blob");

    // GET: List uploaded launchers.
    if (req.method === "GET") {
      const result = await list({
        prefix: "releases/",
        limit: 100,
        storeId
      });

      const releases = result.blobs.map(blob => ({
        pathname: blob.pathname,
        size: blob.size,
        uploadedAt: blob.uploadedAt,
        etag: blob.etag
      }));

      return res.status(200).json({
        success: true,
        releases
      });
    }

    // DELETE: Remove a launcher.
    if (req.method === "DELETE") {
      const pathname = req.body?.pathname;

      if (
        typeof pathname !== "string" ||
        !pathname.startsWith("releases/") ||
        pathname.includes("..") ||
        pathname.length > 1024
      ) {
        return res.status(400).json({
          success: false,
          error: "Invalid release pathname"
        });
      }

      // Confirm that the exact file exists in the private store.
      const result = await list({
        prefix: "releases/",
        limit: 100,
        storeId
      });

      const exists = result.blobs.some(
        blob => blob.pathname === pathname
      );

      if (!exists) {
        return res.status(404).json({
          success: false,
          error: "Launcher not found"
        });
      }

      await del(pathname, { storeId });

      return res.status(200).json({
        success: true,
        message: "Launcher deleted successfully"
      });
    }

    res.setHeader("Allow", "GET, DELETE");

    return res.status(405).json({
      success: false,
      error: "Method not allowed"
    });

  } catch (error) {
    console.error("Release manager error:", error);

    return res.status(500).json({
      success: false,
      error: "Could not manage private releases"
    });
  }
};
