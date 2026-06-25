// routes/backup.js
// Data safety: download a consistent .sqlite backup, or a human-readable CSV.
//
// Why VACUUM INTO: the live DB runs in WAL mode, so recent writes may sit in a
// -wal sidecar file. VACUUM INTO writes a single, fully-consistent copy in one
// step, so the downloaded file is always complete and restorable on its own.

const express = require("express");
const fs = require("fs");
const os = require("os");
const path = require("path");
const db = require("../db");

const router = express.Router();

// Build a YYYY-MM-DD stamp for filenames.
function dateStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// GET /api/backup/sqlite -> downloads a consistent copy of the database
router.get("/sqlite", (req, res) => {
  // Write the backup to a temp file, stream it, then clean up.
  const tmp = path.join(os.tmpdir(), `ct-backup-${Date.now()}.sqlite`);
  try {
    // VACUUM INTO requires the target file not to exist.
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    // Single quotes in the path are escaped for the SQL string literal.
    db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
  } catch (err) {
    return res.status(500).json({ error: "Could not create backup." });
  }

  const filename = `commitment-tracker-backup-${dateStamp()}.sqlite`;
  res.download(tmp, filename, (err) => {
    // Always try to remove the temp file afterwards.
    fs.unlink(tmp, () => {});
  });
});

// --- CSV export -------------------------------------------------------------

// Escape one CSV field per RFC 4180 (quote if it contains comma, quote, or newline).
function csvField(value) {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function rowsToCsv(rows) {
  if (!rows.length) return "(no rows)\n";
  const headers = Object.keys(rows[0]);
  const lines = [headers.map(csvField).join(",")];
  for (const r of rows) {
    lines.push(headers.map((h) => csvField(r[h])).join(","));
  }
  return lines.join("\n") + "\n";
}

// GET /api/backup/csv -> one combined CSV with a section per table
router.get("/csv", (req, res) => {
  const tables = ["commitments", "monthly_records", "debt_accounts", "debt_payments"];
  let out = `# Commitment Tracker export — ${new Date().toISOString()}\n`;

  for (const t of tables) {
    const rows = db.prepare(`SELECT * FROM ${t} ORDER BY id`).all();
    out += `\n# ===== ${t} (${rows.length} rows) =====\n`;
    out += rowsToCsv(rows);
  }

  const filename = `commitment-tracker-export-${dateStamp()}.csv`;
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(out);
});

// GET /api/backup/location -> tells the UI where the live DB file is
router.get("/location", (req, res) => {
  res.json({ path: path.join(__dirname, "..", "data.sqlite") });
});

module.exports = router;