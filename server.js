// sv13-tcg-data / server.js
// Minimal JSON file store for the Duel Bot backend.
// Exposes GET/PUT for JSON files (root + nested paths), with safe path handling.

import express from "express";
import cors from "cors";
import helmet from "helmet";
import fs from "fs/promises";
import fssync from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Where files are read/written (defaults to repo root)
const DATA_ROOT = path.resolve(process.env.DATA_ROOT || __dirname);

// Optional shared key (set on both services if you want)
const STORAGE_KEY = process.env.STORAGE_KEY || "";

// ────────────────────────────────────────────────────────────
// Middleware
// ────────────────────────────────────────────────────────────
app.set("trust proxy", 1);
app.use(helmet());
app.use(cors({
  origin: true,
  credentials: false,
}));
app.use(express.json({ limit: "1mb" }));

// Small access log
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
  next();
});

// Optional key check
function requireKey(req, res, next) {
  if (!STORAGE_KEY) return next(); // open mode
  if (req.headers["x-storage-key"] === STORAGE_KEY) return next();
  return res.status(403).json({ error: "forbidden" });
}

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────
function sanitize(pth) {
  // Remove leading slashes and normalize
  const cleaned = path.normalize(pth).replace(/^(\.\.(\/|\\|$))+/, "");
  // Disallow path going up
  if (cleaned.includes("..")) return null;
  // Only allow .json files
  if (!cleaned.toLowerCase().endsWith(".json")) return null;
  return cleaned.replace(/^[/\\]+/, "");
}

async function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
}

function sendNoStore(res) {
  res.set("Cache-Control", "no-store");
}

// ────────────────────────────────────────────────────────────
// Health
// ────────────────────────────────────────────────────────────
app.get("/_health", (_req, res) => {
  res.json({
    ok: true,
    ts: new Date().toISOString(),
    data_root: DATA_ROOT,
  });
});

// Optional: quick listing (top-level only, for debugging)
app.get("/_list", async (_req, res) => {
  try {
    const items = fssync.readdirSync(DATA_ROOT, { withFileTypes: true })
      .map(d => ({ name: d.name, dir: d.isDirectory(), file: d.isFile() }));
    sendNoStore(res);
    res.json({ root: DATA_ROOT, items });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// ────────────────────────────────────────────────────────────
// GET any JSON file (root or nested), e.g.:
//   /linked_decks.json
//   /public/data/duel_summary.json
//   /data/summaries/<id>.json
// ────────────────────────────────────────────────────────────
app.get("/*", async (req, res) => {
  try {
    const cleaned = sanitize(req.path);
    if (!cleaned) return res.status(400).json({ error: "invalid path" });

    const filePath = path.join(DATA_ROOT, cleaned);

    if (!fssync.existsSync(filePath)) {
      sendNoStore(res);
      return res.status(404).json({ error: "not found" });
    }

    const txt = await fs.readFile(filePath, "utf8");
    const pretty = req.query.pretty !== "0";
    const data = txt ? JSON.parse(txt) : {};
    sendNoStore(res);
    res.type("application/json").send(pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data));
  } catch (e) {
    console.error("GET error:", e);
    res.status(500).json({ error: "read failed" });
  }
});

// ────────────────────────────────────────────────────────────
/*
  PUT any JSON file (root or nested). Overwrites the file.

  Examples:
    PUT /linked_decks.json
    PUT /public/data/reveal_123.json
    PUT /data/summaries/b3a4c5dc.json
*/
// ────────────────────────────────────────────────────────────
app.put("/*", requireKey, async (req, res) => {
  try {
    const cleaned = sanitize(req.path);
    if (!cleaned) return res.status(400).json({ error: "invalid path" });

    if (typeof req.body === "undefined") {
      return res.status(400).json({ error: "missing JSON body" });
    }

    const filePath = path.join(DATA_ROOT, cleaned);
    await ensureDir(filePath);

    const pretty = req.query.pretty !== "0";
    const text = pretty ? JSON.stringify(req.body, null, 2) : JSON.stringify(req.body);

    await fs.writeFile(filePath, text, "utf8");

    sendNoStore(res);
    res.status(200).json({ ok: true, path: cleaned, bytes: Buffer.byteLength(text) });
  } catch (e) {
    console.error("PUT error:", e);
    res.status(500).json({ error: "write failed" });
  }
});

// Fallback
app.use((_req, res) => res.status(404).json({ error: "not found" }));

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🗂️  SV13 TCG Data service listening on :${PORT}`);
  console.log(`📁 DATA_ROOT = ${DATA_ROOT}`);
  if (STORAGE_KEY) console.log("🔐 STORAGE_KEY enabled (require X-Storage-Key)");
});

