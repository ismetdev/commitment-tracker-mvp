// routes/reset.js
// Destructive "start fresh" operations. These are intentionally explicit and
// guarded on the frontend (confirm dialogs; type-to-confirm for full wipe).
//
// Dependency handling:
//   - Clearing debts also clears debt_payments, and nulls out debt_id on any
//     monthly_records debt lines (so they don't point at deleted debts).
//   - Clearing commitments nulls out commitment_id on monthly_records (past
//     snapshots remain as frozen history, just unlinked from templates).
//   - Clearing monthly wipes all month snapshots.
//
// Note: clearing monthly does NOT change debt balances. Balances are the
// debt's own state; if you want balances reset too, clear debts.

const express = require("express");
const db = require("../db");

const router = express.Router();

// POST /api/reset/monthly -> delete all monthly records
router.post("/monthly", (req, res) => {
  try {
    db.exec("DELETE FROM monthly_records;");
    res.json({ ok: true, cleared: "monthly" });
  } catch (err) {
    res.status(500).json({ error: "Failed to clear monthly records." });
  }
});

// POST /api/reset/debts -> delete all debts + their payments, unlink debt lines
router.post("/debts", (req, res) => {
  try {
    db.exec("BEGIN");
    db.exec("UPDATE monthly_records SET debt_id = NULL WHERE debt_id IS NOT NULL;");
    db.exec("DELETE FROM debt_payments;");
    db.exec("DELETE FROM debt_accounts;");
    db.exec("COMMIT");
    res.json({ ok: true, cleared: "debts" });
  } catch (err) {
    db.exec("ROLLBACK");
    res.status(500).json({ error: "Failed to clear debts." });
  }
});

// POST /api/reset/commitments -> delete all commitments, unlink commitment lines
router.post("/commitments", (req, res) => {
  try {
    db.exec("BEGIN");
    db.exec("UPDATE monthly_records SET commitment_id = NULL WHERE commitment_id IS NOT NULL;");
    db.exec("DELETE FROM commitments;");
    db.exec("COMMIT");
    res.json({ ok: true, cleared: "commitments" });
  } catch (err) {
    db.exec("ROLLBACK");
    res.status(500).json({ error: "Failed to clear commitments." });
  }
});

// POST /api/reset/all -> wipe everything. Requires { confirm: "RESET" }.
router.post("/all", (req, res) => {
  if (req.body.confirm !== "RESET") {
    return res
      .status(400)
      .json({ error: 'To clear everything, confirm must be exactly "RESET".' });
  }
  try {
    db.exec("BEGIN");
    db.exec("DELETE FROM debt_payments;");
    db.exec("DELETE FROM monthly_records;");
    db.exec("DELETE FROM debt_accounts;");
    db.exec("DELETE FROM commitments;");
    // Reset autoincrement counters so fresh data starts at id 1 again.
    db.exec("DELETE FROM sqlite_sequence;");
    db.exec("COMMIT");
    res.json({ ok: true, cleared: "all" });
  } catch (err) {
    db.exec("ROLLBACK");
    res.status(500).json({ error: "Failed to clear database." });
  }
});

module.exports = router;