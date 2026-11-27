
const { readSession } = require("../lib/auth");

const MANIFEST = "release-manifest.json";

function getReleasesStoreId() {
  const storeId = process.env.REALSES_STORE_ID;

  if (!storeId) {
    throw new Error("REALSES_STORE_ID is missing");
  }

  return storeId;
}

function storeOptions() {
  return {
    storeId: getReleasesStoreId()
  };
}

function validPath(value) {
  return (
    typeof value === "string" &&
    value.startsWith("releases/") &&
    !value.includes("..") &&
    !value.includes("\\") &&
    value.length <= 1024
  );
}

async function readManifest(get) {
  const stored = await get(MANIFEST, {
    access: "private",
    ...storeOptions()
  });

  if (!stored || stored.statusCode !== 200 || !stored.stream) {
    return {};
  }

  const chunks = [];

  for await (const chunk of stored.stream) {
    chunks.push(Buffer.from(chunk));
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return {};
  }
}

async function writeManifest(put, manifest) {
  await put(
    MANIFEST,
    JSON.stringify(manifest),
    {
      access: "private",
      ...storeOptions(),
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json",
      cacheControlMaxAge: 0
    }
  );
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  try {
    const session = await readSession(req);

    if (!session || session.sub !== "fvrever") {
      return res.status(401).json({
        success: false,
        error: "Unauthorized"
      });
    }

    const { list, del, get, put } = await import("@vercel/blob");

    if (req.method === "GET") {
      const [inventory, manifest] = await Promise.all([
        list({
          prefix: "releases/",
          limit: 100,
          ...storeOptions()
        }),
        readManifest(get)
      ]);

      const present = new Set(
        inventory.blobs.map(blob => blob.pathname)
      );

      const releases = Object.values(manifest)
        .filter(item => item && present.has(item.pathname))
        .sort(
          (a, b) =>
            new Date(b.uploadedAt || 0) -
            new Date(a.uploadedAt || 0)
        );

      return res.status(200).json({
        success: true,
        releases
      });
    }

    let body = req.body;
    if (typeof body === "string") body = JSON.parse(body);

    if (req.method === "PUT") {
      const {
        pathname,
        version,
        name,
        description = "",
        icon = "📦",
        filename = "",
        uploadedAt = new Date().toISOString()
      } = body || {};

      if (
        !validPath(pathname) ||
        typeof version !== "string" ||
        !version.trim() ||
        typeof name !== "string" ||
        !name.trim()
      ) {
        return res.status(400).json({
          success: false,
          error: "Invalid release metadata."
        });
      }

      const inventory = await list({
        prefix: "releases/",
        limit: 100,
        ...storeOptions()
      });

      if (!inventory.blobs.some(blob => blob.pathname === pathname)) {
        return res.status(404).json({
          success: false,
          error: "Uploaded release not found."
        });
      }

      const manifest = await readManifest(get);

      manifest[pathname] = {
        pathname,
        version: version.trim().slice(0, 40),
        name: name.trim().slice(0, 100),
        description: String(description).slice(0, 1000),
        icon: String(icon).slice(0, 12),
        filename: String(filename).slice(0, 180),
        uploadedAt
      };

      await writeManifest(put, manifest);

      return res.status(200).json({
        success: true,
        release: manifest[pathname]
      });
    }

    if (req.method === "DELETE") {
      const pathname = body?.pathname;

      if (!validPath(pathname)) {
        return res.status(400).json({
          success: false,
          error: "Invalid release pathname."
        });
      }

      const inventory = await list({
        prefix: "releases/",
        limit: 100,
        ...storeOptions()
      });

      if (!inventory.blobs.some(blob => blob.pathname === pathname)) {
        return res.status(404).json({
          success: false,
          error: "Release not found."
        });
      }

      await del(pathname, storeOptions());

      const manifest = await readManifest(get);
      delete manifest[pathname];

      await writeManifest(put, manifest);

      return res.status(200).json({
        success: true
      });
    }

    res.setHeader("Allow", "GET, PUT, DELETE");

    return res.status(405).json({
      success: false,
      error: "Method not allowed"
    });

  } catch (error) {
    console.error("Release manager error:", error);

    return res.status(500).json({
      success: false,
      error: "Could not manage private releases."
    });
  }
};
