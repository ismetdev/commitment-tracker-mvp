// routes/monthly.js
// The monthly snapshot system.
//
// Key design rules (deliberate):
//   - Generating a month COPIES each active commitment into monthly_records as
//     a frozen row (name, type, amount snapshotted at that moment).
//   - A month cannot be generated twice. The DB unique index guards generated
//     rows; we also check explicitly to give a friendly error.
//   - Editing a commitment later does NOT change already-generated months.
//   - Ad-hoc lines (commitment_id = NULL) belong to one month only and never
//     touch your templates.

const express = require("express");
const db = require("../db");

const router = express.Router();

// 'YYYY-MM' shape check.
function isValidMonth(m) {
  if (typeof m !== "string") return false;
  if (!/^\d{4}-\d{2}$/.test(m)) return false;
  const month = Number(m.slice(5, 7));
  return month >= 1 && month <= 12;
}

// GET /api/monthly/months -> distinct months that exist, newest first
router.get("/months", (req, res) => {
  const rows = db
    .prepare("SELECT DISTINCT month FROM monthly_records ORDER BY month DESC")
    .all();
  res.json(rows.map((r) => r.month));
});

// GET /api/monthly/:month -> all lines for a month + totals
router.get("/:month", (req, res) => {
  const { month } = req.params;
  if (!isValidMonth(month)) {
    return res.status(400).json({ error: "Month must look like YYYY-MM." });
  }
  const lines = db
    .prepare(
      "SELECT * FROM monthly_records WHERE month = ? ORDER BY (commitment_id IS NULL), name COLLATE NOCASE"
    )
    .all(month);

  const summary = summarize(lines);
  res.json({ month, lines, summary });
});

// DELETE /api/monthly/:month -> delete an entire month's lines.
// Before deleting, restore the debt balance for any PAID debt line in this
// month, so balances stay correct. Then you can regenerate the month fresh.
router.delete("/:month", (req, res) => {
  const { month } = req.params;
  if (!isValidMonth(month)) {
    return res.status(400).json({ error: "Month must look like YYYY-MM." });
  }
  const lines = db
    .prepare("SELECT * FROM monthly_records WHERE month = ?")
    .all(month);
  if (lines.length === 0) {
    return res.status(404).json({ error: `Month ${month} does not exist.` });
  }

  try {
    db.exec("BEGIN");
    // Restore balances for paid debt lines before removing them.
    for (const l of lines) {
      if (l.debt_id && l.status === "paid") {
        adjustDebtBalance(l.debt_id, l.amount);
      }
    }
    db.prepare("DELETE FROM monthly_records WHERE month = ?").run(month);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    return res.status(500).json({ error: "Failed to delete month." });
  }

  res.json({ deleted: true, month, removed: lines.length });
});

// POST /api/monthly/generate { month } -> create the snapshot
router.post("/generate", (req, res) => {
  const month = (req.body.month || "").trim();
  if (!isValidMonth(month)) {
    return res.status(400).json({ error: "Month must look like YYYY-MM (e.g. 2026-07)." });
  }

  // Already generated? (any line at all for this month counts.)
  const existing = db
    .prepare("SELECT COUNT(*) AS n FROM monthly_records WHERE month = ?")
    .get(month);
  if (existing.n > 0) {
    return res.status(409).json({ error: `Month ${month} already exists.` });
  }

  const active = db
    .prepare("SELECT * FROM commitments WHERE active = 1 ORDER BY id")
    .all();

  // Debts that still owe money and have a monthly payment set produce a line.
  const debts = db
    .prepare(
      "SELECT * FROM debt_accounts WHERE monthly_amount > 0 AND current_balance > 0 ORDER BY id"
    )
    .all();

  if (active.length === 0 && debts.length === 0) {
    return res.status(400).json({
      error:
        "Nothing to generate. Add active commitments or a debt with a monthly amount first.",
    });
  }

  const insertCommitment = db.prepare(
    `INSERT INTO monthly_records (month, commitment_id, name, type, amount, status)
     VALUES (?, ?, ?, ?, ?, 'pending')`
  );
  const insertDebt = db.prepare(
    `INSERT INTO monthly_records (month, debt_id, name, type, amount, status)
     VALUES (?, ?, ?, 'debt', ?, 'pending')`
  );

  // Wrap in a transaction so the whole month generates atomically.
  // node:sqlite uses plain SQL transactions (no db.transaction helper).
  try {
    db.exec("BEGIN");
    for (const c of active) {
      insertCommitment.run(month, c.id, c.name, c.type, c.default_amount);
    }
    for (const d of debts) {
      // Auto-cap the line to the remaining balance (never schedule an overpayment).
      const lineAmount = Math.min(d.monthly_amount, d.current_balance);
      insertDebt.run(month, d.id, d.name, lineAmount);
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    return res.status(500).json({ error: "Failed to generate month." });
  }

  const lines = db
    .prepare("SELECT * FROM monthly_records WHERE month = ? ORDER BY name COLLATE NOCASE")
    .all(month);
  res.status(201).json({ month, lines, summary: summarize(lines) });
});

// Adjust a debt's balance by delta, clamped to [0, original_amount].
// Positive delta increases balance (restore), negative reduces it (payment).
function adjustDebtBalance(debtId, delta) {
  const d = db.prepare("SELECT * FROM debt_accounts WHERE id = ?").get(debtId);
  if (!d) return; // debt may have been deleted; line is now orphaned, ignore.
  let next = d.current_balance + delta;
  if (next < 0) next = 0;
  if (next > d.original_amount) next = d.original_amount;
  db.prepare("UPDATE debt_accounts SET current_balance = ? WHERE id = ?").run(next, debtId);
}

// PATCH /api/monthly/line/:id/status -> flip paid/pending.
// For DEBT lines this also moves the debt balance: paying reduces it,
// un-paying restores it.
router.patch("/line/:id/status", (req, res) => {
  const id = Number(req.params.id);
  const line = db.prepare("SELECT * FROM monthly_records WHERE id = ?").get(id);
  if (!line) return res.status(404).json({ error: "Line not found." });

  const next = line.status === "paid" ? "pending" : "paid";

  try {
    db.exec("BEGIN");
    db.prepare(
      "UPDATE monthly_records SET status = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(next, id);

    if (line.debt_id) {
      // Paying reduces the balance; un-paying restores it.
      const delta = next === "paid" ? -line.amount : line.amount;
      adjustDebtBalance(line.debt_id, delta);
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    return res.status(500).json({ error: "Failed to update line." });
  }

  res.json(db.prepare("SELECT * FROM monthly_records WHERE id = ?").get(id));
});

// PATCH /api/monthly/line/:id/amount -> correct a line's amount for this month.
// This is a deliberate per-month correction (e.g. a variable bill's real value),
// distinct from template edits which never touch generated months.
router.patch("/line/:id/amount", (req, res) => {
  const id = Number(req.params.id);
  const line = db.prepare("SELECT * FROM monthly_records WHERE id = ?").get(id);
  if (!line) return res.status(404).json({ error: "Line not found." });

  const amount = Number(req.body.amount);
  if (!Number.isFinite(amount) || amount < 0) {
    return res.status(400).json({ error: "Amount must be a number of 0 or more." });
  }

  try {
    db.exec("BEGIN");
    db.prepare(
      "UPDATE monthly_records SET amount = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(amount, id);

    // If this is a debt line that's ALREADY paid, the balance reflects the old
    // amount. Apply the difference so the balance stays correct.
    // old amount was subtracted; now subtract the new amount instead:
    //   delta to balance = oldAmount - newAmount
    if (line.debt_id && line.status === "paid") {
      adjustDebtBalance(line.debt_id, line.amount - amount);
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    return res.status(500).json({ error: "Failed to update amount." });
  }

  res.json(db.prepare("SELECT * FROM monthly_records WHERE id = ?").get(id));
});

// POST /api/monthly/:month/line -> add an ad-hoc one-off line to that month
router.post("/:month/line", (req, res) => {
  const { month } = req.params;
  if (!isValidMonth(month)) {
    return res.status(400).json({ error: "Month must look like YYYY-MM." });
  }
  // The month must already exist (be generated) before adding lines to it.
  const monthExists = db
    .prepare("SELECT COUNT(*) AS n FROM monthly_records WHERE month = ?")
    .get(month);
  if (monthExists.n === 0) {
    return res.status(400).json({ error: "Generate this month before adding lines." });
  }

  const name = (req.body.name || "").trim();
  if (!name) return res.status(400).json({ error: "Name is required." });
  const amount = Number(req.body.amount);
  if (!Number.isFinite(amount) || amount < 0) {
    return res.status(400).json({ error: "Amount must be a number of 0 or more." });
  }

  // Ad-hoc lines are typed 'optional' and have no commitment link.
  const info = db
    .prepare(
      `INSERT INTO monthly_records (month, commitment_id, name, type, amount, status)
       VALUES (?, NULL, ?, 'optional', ?, 'pending')`
    )
    .run(month, name, amount);

  res
    .status(201)
    .json(db.prepare("SELECT * FROM monthly_records WHERE id = ?").get(info.lastInsertRowid));
});

// DELETE /api/monthly/line/:id -> remove a line.
// If a PAID debt line is removed, restore its amount to the debt balance.
router.delete("/line/:id", (req, res) => {
  const id = Number(req.params.id);
  const line = db.prepare("SELECT * FROM monthly_records WHERE id = ?").get(id);
  if (!line) return res.status(404).json({ error: "Line not found." });

  try {
    db.exec("BEGIN");
    db.prepare("DELETE FROM monthly_records WHERE id = ?").run(id);
    if (line.debt_id && line.status === "paid") {
      adjustDebtBalance(line.debt_id, line.amount);
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    return res.status(500).json({ error: "Failed to delete line." });
  }

  res.json({ deleted: true, id });
});

// Shared total calculation.
function summarize(lines) {
  let total = 0;
  let paid = 0;
  let pending = 0;
  for (const l of lines) {
    total += l.amount;
    if (l.status === "paid") paid += l.amount;
    else pending += l.amount;
  }
  return {
    count: lines.length,
    total,
    paid,
    pending,
  };
}

module.exports = router;