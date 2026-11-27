
const { readSession } = require("../lib/auth");
const { randomBytes } = require("crypto");

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generateSegment() {
  let result = "";
  const bytes = randomBytes(4);

  for (let i = 0; i < 4; i++) {
    result += ALPHABET[bytes[i] % ALPHABET.length];
  }

  return result;
}

function generateCode() {
  return `FVR-${generateSegment()}-${generateSegment()}`;
}

function send(res, status, data) {
  return res.status(status).json(data);
}

module.exports = async function handler(req, res) {
  if (!["GET", "POST"].includes(req.method)) {
    return send(res, 405, { error: "Method not allowed" });
  }

  const session = readSession(req);

  if (!session || session.sub !== "fvrever") {
    return send(res, 401, { error: "Unauthorized" });
  }

  if (!process.env.DATABASE_URL) {
    return send(res, 500, { error: "DATABASE_URL is not configured" });
  }

  try {
    const { neon } = await import("@neondatabase/serverless");
    const sql = neon(process.env.DATABASE_URL);

    // Initialize the database tables.
    if (req.method === "POST" && req.body?.action === "setup") {
      await sql`
        CREATE TABLE IF NOT EXISTS fvrever_gift_keys (
          id BIGSERIAL PRIMARY KEY,
          code VARCHAR(32) NOT NULL UNIQUE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days'),
          redeemed_at TIMESTAMPTZ,
          revoked_at TIMESTAMPTZ
        )
      `;

      await sql`
        CREATE INDEX IF NOT EXISTS gift_keys_created_idx
        ON fvrever_gift_keys (created_at DESC)
      `;

      await sql`
        CREATE INDEX IF NOT EXISTS gift_keys_expiry_idx
        ON fvrever_gift_keys (expires_at)
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS fvrever_gift_downloads (
          id BIGSERIAL PRIMARY KEY,
          gift_key_id BIGINT NOT NULL REFERENCES fvrever_gift_keys(id),
          downloaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          download_type VARCHAR(40) NOT NULL DEFAULT 'installer'
        )
      `;

      return send(res, 200, {
        success: true,
        message: "Gift Keys database initialized"
      });
    }

    // List and filter gift keys.
    if (req.method === "GET") {
      const filter = String(req.query?.status || "all").toLowerCase();
      const search = String(req.query?.search || "").trim().slice(0, 80);

      let rows;

      if (filter === "available") {
        rows = await sql`
          SELECT *,
            CASE
              WHEN revoked_at IS NOT NULL THEN 'revoked'
              WHEN redeemed_at IS NOT NULL THEN 'used'
              WHEN expires_at <= NOW() THEN 'expired'
              ELSE 'available'
            END AS status
          FROM fvrever_gift_keys
          WHERE revoked_at IS NULL
            AND redeemed_at IS NULL
            AND expires_at > NOW()
            AND code ILIKE ${"%" + search + "%"}
          ORDER BY created_at DESC
          LIMIT 500
        `;
      } else if (filter === "used") {
        rows = await sql`
          SELECT *,
            CASE
              WHEN revoked_at IS NOT NULL THEN 'revoked'
              WHEN redeemed_at IS NOT NULL THEN 'used'
              WHEN expires_at <= NOW() THEN 'expired'
              ELSE 'available'
            END AS status
          FROM fvrever_gift_keys
          WHERE redeemed_at IS NOT NULL
            AND code ILIKE ${"%" + search + "%"}
          ORDER BY redeemed_at DESC
          LIMIT 500
        `;
      } else if (filter === "expired") {
        rows = await sql`
          SELECT *,
            CASE
              WHEN revoked_at IS NOT NULL THEN 'revoked'
              WHEN redeemed_at IS NOT NULL THEN 'used'
              WHEN expires_at <= NOW() THEN 'expired'
              ELSE 'available'
            END AS status
          FROM fvrever_gift_keys
          WHERE expires_at <= NOW()
            AND redeemed_at IS NULL
            AND revoked_at IS NULL
            AND code ILIKE ${"%" + search + "%"}
          ORDER BY expires_at DESC
          LIMIT 500
        `;
      } else if (filter === "revoked") {
        rows = await sql`
          SELECT *,
            'revoked' AS status
          FROM fvrever_gift_keys
          WHERE revoked_at IS NOT NULL
            AND code ILIKE ${"%" + search + "%"}
          ORDER BY revoked_at DESC
          LIMIT 500
        `;
      } else {
        rows = await sql`
          SELECT *,
            CASE
              WHEN revoked_at IS NOT NULL THEN 'revoked'
              WHEN redeemed_at IS NOT NULL THEN 'used'
              WHEN expires_at <= NOW() THEN 'expired'
              ELSE 'available'
            END AS status
          FROM fvrever_gift_keys
          WHERE code ILIKE ${"%" + search + "%"}
          ORDER BY created_at DESC
          LIMIT 500
        `;
      }

      const [stats] = await sql`
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (
            WHERE redeemed_at IS NULL
              AND revoked_at IS NULL
              AND expires_at > NOW()
          )::int AS available,
          COUNT(*) FILTER (
            WHERE redeemed_at IS NOT NULL
          )::int AS used,
          COUNT(*) FILTER (
            WHERE expires_at <= NOW()
              AND redeemed_at IS NULL
              AND revoked_at IS NULL
          )::int AS expired,
          COUNT(*) FILTER (
            WHERE revoked_at IS NOT NULL
          )::int AS revoked
        FROM fvrever_gift_keys
      `;

      return send(res, 200, {
        success: true,
        stats,
        keys: rows
      });
    }

    // Generate new gift keys.
    if (req.body?.action === "generate") {
      const amount = Number(req.body.amount);

      if (!Number.isInteger(amount) || amount < 1 || amount > 500) {
        return send(res, 400, {
          error: "Generate between 1 and 500 codes"
        });
      }

      const codes = new Set();

      while (codes.size < amount) {
        codes.add(generateCode());
      }

      const queries = Array.from(codes, code => sql`
        INSERT INTO fvrever_gift_keys (code)
        VALUES (${code})
        RETURNING code, created_at, expires_at
      `);

      const results = await sql.transaction(queries);
      const created = results.flat();

      return send(res, 201, {
        success: true,
        count: created.length,
        codes: created
      });
    }

    // Revoke an unused code.
    if (req.body?.action === "revoke") {
      const code = String(req.body.code || "").trim().toUpperCase();

      if (!/^FVR-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/.test(code)) {
        return send(res, 400, { error: "Invalid code format" });
      }

      const result = await sql`
        UPDATE fvrever_gift_keys
        SET revoked_at = NOW()
        WHERE code = ${code}
          AND redeemed_at IS NULL
          AND revoked_at IS NULL
          AND expires_at > NOW()
        RETURNING code, revoked_at
      `;

      if (!result.length) {
        return send(res, 409, {
          error: "Code not found, expired, used or already revoked"
        });
      }

      return send(res, 200, {
        success: true,
        key: result[0]
      });
    }

    return send(res, 400, { error: "Unknown action" });

  } catch (error) {
    console.error("Gift Keys API error:", error);
    return send(res, 500, {
      error: "Gift Keys operation failed"
    });
  }
};
