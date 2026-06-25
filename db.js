// db.js
// Owns the single local SQLite file and creates the schema on first run.
//
// Uses Node's BUILT-IN SQLite (node:sqlite), available in Node 22.5+ and
// stable to use in Node 24. No native compilation, no extra dependency.
//
// Design notes (deliberate, see our build decisions):
//   - Debt is fully decoupled from commitments. No `debt_ref` type.
//   - monthly_records are immutable snapshots: once a month is generated,
//     those rows are the source of truth for that month. Editing a
//     commitment template only affects FUTURE generations.
//   - Money stored as REAL (float). This is a personal tracker, not a bank.

const path = require("path");
const { DatabaseSync } = require("node:sqlite");

// The DB file lives next to this file, so it's easy to find and back up.
const dbPath = path.join(__dirname, "data.sqlite");
const db = new DatabaseSync(dbPath);

// Safer defaults for a long-lived local file.
// (node:sqlite uses exec() for pragmas rather than a dedicated method.)
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");

function init() {
  db.exec(`
    -- Recurring monthly templates. NOT debts.
    CREATE TABLE IF NOT EXISTS commitments (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      name           TEXT    NOT NULL,
      type           TEXT    NOT NULL CHECK (type IN ('fixed','variable','optional')),
      default_amount REAL    NOT NULL DEFAULT 0,
      active         INTEGER NOT NULL DEFAULT 1,  -- 1 = active, 0 = inactive
      created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    -- Frozen per-month snapshot lines. Includes generated commitment lines,
    -- per-month ad-hoc lines (commitment_id & debt_id NULL), AND debt lines
    -- (debt_id set). A debt line being marked 'paid' reduces the debt balance.
    CREATE TABLE IF NOT EXISTS monthly_records (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      month         TEXT    NOT NULL,            -- 'YYYY-MM'
      commitment_id INTEGER,                     -- set for commitment lines
      debt_id       INTEGER,                     -- set for debt lines
      name          TEXT    NOT NULL,            -- snapshotted name at generation time
      type          TEXT    NOT NULL,            -- snapshotted type ('fixed'/'variable'/'optional'/'debt')
      amount        REAL    NOT NULL DEFAULT 0,
      status        TEXT    NOT NULL DEFAULT 'pending' CHECK (status IN ('paid','pending')),
      updated_at    TEXT    NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (commitment_id) REFERENCES commitments(id) ON DELETE SET NULL,
      FOREIGN KEY (debt_id) REFERENCES debt_accounts(id) ON DELETE SET NULL
    );

    -- Light debt tracking. monthly_amount drives the auto-generated monthly line.
    CREATE TABLE IF NOT EXISTS debt_accounts (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      name            TEXT    NOT NULL,
      original_amount REAL    NOT NULL DEFAULT 0,
      current_balance REAL    NOT NULL DEFAULT 0,
      monthly_amount  REAL    NOT NULL DEFAULT 0,
      created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS debt_payments (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      debt_id      INTEGER NOT NULL,
      amount       REAL    NOT NULL,
      payment_date TEXT    NOT NULL DEFAULT (date('now')),
      notes        TEXT,
      FOREIGN KEY (debt_id) REFERENCES debt_accounts(id) ON DELETE CASCADE
    );

    -- Enforce "cannot duplicate same month" at the DB level for generated lines.
    -- (Ad-hoc lines have commitment_id NULL and are exempt; this index only
    -- guards one generated row per commitment per month.)
    CREATE UNIQUE INDEX IF NOT EXISTS idx_month_commitment
      ON monthly_records (month, commitment_id)
      WHERE commitment_id IS NOT NULL;
  `);
}

// Indexes that depend on columns added by migrate() must run AFTER migrate().
function createIndexes() {
  // One debt line per debt per month.
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_month_debt
      ON monthly_records (month, debt_id)
      WHERE debt_id IS NOT NULL;
  `);
}

// Lightweight migrations for databases created before a column existed.
// SQLite has no "ADD COLUMN IF NOT EXISTS", so we check the table info first.
function migrate() {
  const hasColumn = (table, column) => {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all();
    return cols.some((c) => c.name === column);
  };

  // debt_accounts.monthly_amount (existing debts default to 0 = no line until set).
  if (!hasColumn("debt_accounts", "monthly_amount")) {
    db.exec("ALTER TABLE debt_accounts ADD COLUMN monthly_amount REAL NOT NULL DEFAULT 0");
  }
  // monthly_records.debt_id (older rows are commitment/ad-hoc lines, debt_id stays NULL).
  if (!hasColumn("monthly_records", "debt_id")) {
    db.exec("ALTER TABLE monthly_records ADD COLUMN debt_id INTEGER");
  }
}

init();
migrate();
createIndexes();

module.exports = db;