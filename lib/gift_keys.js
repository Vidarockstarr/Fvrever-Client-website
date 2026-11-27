
const crypto = require("crypto");
const { neon } = require("@neondatabase/serverless");

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_VALID_DAYS = 30;

function getConfig() {
  const secret = process.env.GIFT_KEY_SECRET;
  const databaseUrl = process.env.DATABASE_URL;

  if (!secret || !/^[a-f0-9]{64}$/i.test(secret)) {
    throw new Error("GIFT_KEY_SECRET is missing or invalid");
  }

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is missing");
  }

  return {
    sql: neon(databaseUrl),
    key: Buffer.from(secret, "hex")
  };
}

function normalizeCode(code) {
  return String(code || "").trim().toUpperCase();
}

function hashCode(code, key) {
  return crypto
    .createHmac("sha256", key)
    .update(normalizeCode(code))
    .digest("hex");
}

function encryptCode(code, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);

  const encrypted = Buffer.concat([
    cipher.update(code, "utf8"),
    cipher.final()
  ]);

  return [
    iv.toString("hex"),
    cipher.getAuthTag().toString("hex"),
    encrypted.toString("hex")
  ].join(":");
}

function decryptCode(value, key) {
  const [ivHex, tagHex, encryptedHex] = value.split(":");

  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(ivHex, "hex")
  );

  decipher.setAuthTag(Buffer.from(tagHex, "hex"));

  return Buffer.concat([
    decipher.update(Buffer.from(encryptedHex, "hex")),
    decipher.final()
  ]).toString("utf8");
}

function generateCode() {
  function block() {
    let result = "";

    for (let i = 0; i < 4; i++) {
      result += CODE_ALPHABET[
        crypto.randomInt(0, CODE_ALPHABET.length)
      ];
    }

    return result;
  }

  return `FVR-${block()}-${block()}`;
}

async function createGiftKeys(quantity = 1) {
  const { sql, key } = getConfig();

  quantity = Number(quantity);

  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 500) {
    throw new Error("Quantity must be between 1 and 500");
  }

  const created = [];

  while (created.length < quantity) {
    const code = generateCode();
    const hash = hashCode(code, key);
    const encrypted = encryptCode(code, key);
    const hint = code.slice(-4);

    const rows = await sql`
      INSERT INTO public.gift_keys
        (code_hash, code_encrypted, code_hint, status, expires_at)
      VALUES (
        ${hash},
        ${encrypted},
        ${hint},
        'available',
        NOW() + INTERVAL '30 days'
      )
      ON CONFLICT (code_hash) DO NOTHING
      RETURNING id, created_at, expires_at
    `;

    if (rows.length) {
      created.push({
        id: rows[0].id,
        code,
        status: "available",
        createdAt: rows[0].created_at,
        expiresAt: rows[0].expires_at
      });
    }
  }

  return created;
}

async function listGiftKeys({ status = "all", search = "", limit = 100, offset = 0 } = {}) {
  const { sql, key } = getConfig();

  limit = Math.min(Math.max(Number(limit) || 100, 1), 500);
  offset = Math.max(Number(offset) || 0, 0);

  const rows = await sql`
    SELECT
      id,
      code_encrypted,
      code_hint,
      status,
      created_at,
      expires_at,
      used_at,
      revoked_at,
      CASE
        WHEN status = 'available' AND expires_at <= NOW()
          THEN 'expired'
        ELSE status
      END AS display_status
    FROM public.gift_keys
    ORDER BY created_at DESC
    LIMIT ${limit}
    OFFSET ${offset}
  `;

  const normalizedSearch = String(search).trim().toUpperCase();

  return rows
    .map(row => ({
      id: row.id,
      code: decryptCode(row.code_encrypted, key),
      codeHint: row.code_hint,
      status: row.display_status,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      usedAt: row.used_at,
      revokedAt: row.revoked_at
    }))
    .filter(row => {
      const matchesStatus =
        status === "all" || row.status === status;

      const matchesSearch =
        !normalizedSearch ||
        row.code.includes(normalizedSearch);

      return matchesStatus && matchesSearch;
    });
}

async function getGiftKeyStats() {
  const { sql } = getConfig();

  const rows = await sql`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (
        WHERE status = 'available' AND expires_at > NOW()
      )::int AS available,
      COUNT(*) FILTER (
        WHERE status = 'used'
      )::int AS used,
      COUNT(*) FILTER (
        WHERE status = 'revoked'
      )::int AS revoked,
      COUNT(*) FILTER (
        WHERE status = 'available' AND expires_at <= NOW()
      )::int AS expired
    FROM public.gift_keys
  `;

  return rows[0];
}

async function revokeGiftKey(id) {
  const { sql } = getConfig();

  const rows = await sql`
    UPDATE public.gift_keys
    SET
      status = 'revoked',
      revoked_at = NOW()
    WHERE
      id = ${Number(id)}
      AND status = 'available'
      AND expires_at > NOW()
    RETURNING id, revoked_at
  `;

  return rows[0] || null;
}

async function redeemGiftKey(code) {
  const { sql, key } = getConfig();

  const normalized = normalizeCode(code);

  if (!/^FVR-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/.test(normalized)) {
    return { success: false, reason: "invalid" };
  }

  const hash = hashCode(normalized, key);

  // One atomic statement: a code can only be claimed once.
  const rows = await sql`
    WITH claimed AS (
      UPDATE public.gift_keys
      SET status = 'used', used_at = NOW()
      WHERE
        code_hash = ${hash}
        AND status = 'available'
        AND expires_at > NOW()
      RETURNING id
    ),
    logged AS (
      INSERT INTO public.gift_key_downloads
        (gift_key_id, status)
      SELECT id, 'authorized'
      FROM claimed
      RETURNING id, gift_key_id
    )
    SELECT id, gift_key_id FROM logged
  `;

  if (!rows.length) {
    const existing = await sql`
      SELECT
        status,
        expires_at <= NOW() AS expired
      FROM public.gift_keys
      WHERE code_hash = ${hash}
      LIMIT 1
    `;

    if (!existing.length) {
      return { success: false, reason: "invalid" };
    }

    if (existing[0].expired) {
      return { success: false, reason: "expired" };
    }

    return { success: false, reason: existing[0].status };
  }

  return {
    success: true,
    downloadId: rows[0].id,
    giftKeyId: rows[0].gift_key_id
  };
}

module.exports = {
  createGiftKeys,
  listGiftKeys,
  getGiftKeyStats,
  revokeGiftKey,
  redeemGiftKey
};

