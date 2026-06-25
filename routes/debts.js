// routes/debts.js
// Light personal debt tracking: accounts + manual payments.
//
// Rules (deliberate):
//   - Creating an account sets current_balance (defaults to original_amount
//     if not given).
//   - Recording a payment reduces current_balance and logs the payment.
//   - Deleting a payment restores that amount to current_balance.
//   - Balance never goes below 0 (a payment is clamped so you can mark a debt
//     fully paid without going negative).
//   - No interest, no schedules. This is light tracking by design.

const express = require("express");
const db = require("../db");

const router = express.Router();

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

// Attach computed fields (progress %, totals) to an account row.
function decorate(account) {
  const paidOff = account.original_amount - account.current_balance;
  const pct =
    account.original_amount > 0
      ? Math.min(100, Math.max(0, (paidOff / account.original_amount) * 100))
      : 0;

  const payments = db
    .prepare("SELECT * FROM debt_payments WHERE debt_id = ? ORDER BY payment_date DESC, id DESC")
    .all(account.id);

  const totalPaid = payments.reduce((s, p) => s + p.amount, 0);

  // Simple recent pace: average of the last 3 payments (honest, not a forecast).
  const recent = payments.slice(0, 3);
  const recentAvg = recent.length
    ? recent.reduce((s, p) => s + p.amount, 0) / recent.length
    : 0;

  return {
    ...account,
    paid_off: paidOff,
    progress_pct: Math.round(pct * 10) / 10,
    total_paid: totalPaid,
    payment_count: payments.length,
    recent_avg_payment: Math.round(recentAvg * 100) / 100,
    payments,
  };
}

// GET /api/debts -> all accounts (with computed fields, no payment list each)
router.get("/", (req, res) => {
  const accounts = db
    .prepare("SELECT * FROM debt_accounts ORDER BY name COLLATE NOCASE")
    .all();
  // For the list view we include computed fields but drop the heavy payments array.
  const out = accounts.map((a) => {
    const d = decorate(a);
    delete d.payments;
    return d;
  });
  res.json(out);
});

// GET /api/debts/:id -> one account with full payment history
router.get("/:id", (req, res) => {
  const id = Number(req.params.id);
  const account = db.prepare("SELECT * FROM debt_accounts WHERE id = ?").get(id);
  if (!account) return res.status(404).json({ error: "Debt account not found." });
  res.json(decorate(account));
});

// POST /api/debts -> create account
router.post("/", (req, res) => {
  const name = (req.body.name || "").trim();
  if (!name) return res.status(400).json({ error: "Name is required." });

  const original = num(req.body.original_amount);
  if (!Number.isFinite(original) || original < 0) {
    return res.status(400).json({ error: "Original amount must be 0 or more." });
  }

  // Starting balance defaults to the original amount if not provided.
  let balance = req.body.current_balance === undefined || req.body.current_balance === ""
    ? original
    : num(req.body.current_balance);
  if (!Number.isFinite(balance) || balance < 0) {
    return res.status(400).json({ error: "Current balance must be 0 or more." });
  }

  // Monthly amount: how much is paid toward this debt each month.
  const monthly = req.body.monthly_amount === undefined || req.body.monthly_amount === ""
    ? 0
    : num(req.body.monthly_amount);
  if (!Number.isFinite(monthly) || monthly < 0) {
    return res.status(400).json({ error: "Monthly amount must be 0 or more." });
  }

  const info = db
    .prepare(
      "INSERT INTO debt_accounts (name, original_amount, current_balance, monthly_amount) VALUES (?, ?, ?, ?)"
    )
    .run(name, original, balance, monthly);

  res
    .status(201)
    .json(decorate(db.prepare("SELECT * FROM debt_accounts WHERE id = ?").get(info.lastInsertRowid)));
});

// PUT /api/debts/:id -> edit name / original amount
router.put("/:id", (req, res) => {
  const id = Number(req.params.id);
  const account = db.prepare("SELECT * FROM debt_accounts WHERE id = ?").get(id);
  if (!account) return res.status(404).json({ error: "Debt account not found." });

  const name = (req.body.name || "").trim();
  if (!name) return res.status(400).json({ error: "Name is required." });
  const original = num(req.body.original_amount);
  if (!Number.isFinite(original) || original < 0) {
    return res.status(400).json({ error: "Original amount must be 0 or more." });
  }
  const monthly = req.body.monthly_amount === undefined || req.body.monthly_amount === ""
    ? 0
    : num(req.body.monthly_amount);
  if (!Number.isFinite(monthly) || monthly < 0) {
    return res.status(400).json({ error: "Monthly amount must be 0 or more." });
  }

  db.prepare("UPDATE debt_accounts SET name = ?, original_amount = ?, monthly_amount = ? WHERE id = ?")
    .run(name, original, monthly, id);

  res.json(decorate(db.prepare("SELECT * FROM debt_accounts WHERE id = ?").get(id)));
});

// DELETE /api/debts/:id -> remove account (payments cascade away)
router.delete("/:id", (req, res) => {
  const id = Number(req.params.id);
  const account = db.prepare("SELECT * FROM debt_accounts WHERE id = ?").get(id);
  if (!account) return res.status(404).json({ error: "Debt account not found." });
  db.prepare("DELETE FROM debt_accounts WHERE id = ?").run(id);
  res.json({ deleted: true, id });
});

// POST /api/debts/:id/payments -> record a payment, reduce balance
router.post("/:id/payments", (req, res) => {
  const id = Number(req.params.id);
  const account = db.prepare("SELECT * FROM debt_accounts WHERE id = ?").get(id);
  if (!account) return res.status(404).json({ error: "Debt account not found." });

  const amount = num(req.body.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ error: "Payment amount must be greater than 0." });
  }
  const notes = (req.body.notes || "").trim() || null;
  // Optional date; default handled by the table (today) if blank.
  const date = (req.body.payment_date || "").trim();

  // Clamp balance reduction so it never goes below zero.
  const newBalance = Math.max(0, account.current_balance - amount);

  try {
    db.exec("BEGIN");
    if (date) {
      db.prepare(
        "INSERT INTO debt_payments (debt_id, amount, payment_date, notes) VALUES (?, ?, ?, ?)"
      ).run(id, amount, date, notes);
    } else {
      db.prepare(
        "INSERT INTO debt_payments (debt_id, amount, notes) VALUES (?, ?, ?)"
      ).run(id, amount, notes);
    }
    db.prepare("UPDATE debt_accounts SET current_balance = ? WHERE id = ?").run(newBalance, id);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    return res.status(500).json({ error: "Failed to record payment." });
  }

  res.status(201).json(decorate(db.prepare("SELECT * FROM debt_accounts WHERE id = ?").get(id)));
});

// DELETE /api/debts/:debtId/payments/:paymentId -> remove a payment, restore balance
router.delete("/:debtId/payments/:paymentId", (req, res) => {
  const debtId = Number(req.params.debtId);
  const paymentId = Number(req.params.paymentId);

  const account = db.prepare("SELECT * FROM debt_accounts WHERE id = ?").get(debtId);
  if (!account) return res.status(404).json({ error: "Debt account not found." });
  const payment = db
    .prepare("SELECT * FROM debt_payments WHERE id = ? AND debt_id = ?")
    .get(paymentId, debtId);
  if (!payment) return res.status(404).json({ error: "Payment not found." });

  // Restore the amount, but don't exceed the original amount.
  const restored = Math.min(account.original_amount, account.current_balance + payment.amount);

  try {
    db.exec("BEGIN");
    db.prepare("DELETE FROM debt_payments WHERE id = ?").run(paymentId);
    db.prepare("UPDATE debt_accounts SET current_balance = ? WHERE id = ?").run(restored, debtId);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    return res.status(500).json({ error: "Failed to delete payment." });
  }

  res.json(decorate(db.prepare("SELECT * FROM debt_accounts WHERE id = ?").get(debtId)));
});

module.exports = router;