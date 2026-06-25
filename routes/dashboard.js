// routes/dashboard.js
// One aggregated endpoint so the dashboard loads in a single request.
// Pulls together: active commitments, the latest generated month's totals,
// and an overview of all debts.

const express = require("express");
const db = require("../db");

const router = express.Router();

// GET /api/dashboard -> everything the landing page needs
router.get("/", (req, res) => {
  // Active commitments count + their template total (for "expected" monthly load).
  const commitmentAgg = db
    .prepare(
      "SELECT COUNT(*) AS count, COALESCE(SUM(default_amount), 0) AS total FROM commitments WHERE active = 1"
    )
    .get();

  // Latest generated month (if any).
  const latest = db
    .prepare("SELECT month FROM monthly_records ORDER BY month DESC LIMIT 1")
    .get();

  let latestMonth = null;
  if (latest) {
    const lines = db
      .prepare("SELECT amount, status FROM monthly_records WHERE month = ?")
      .all(latest.month);
    let total = 0, paid = 0, pending = 0;
    for (const l of lines) {
      total += l.amount;
      if (l.status === "paid") paid += l.amount;
      else pending += l.amount;
    }
    latestMonth = {
      month: latest.month,
      count: lines.length,
      total,
      paid,
      pending,
    };
  }

  // Debt overview.
  const debts = db.prepare("SELECT * FROM debt_accounts").all();
  let totalOriginal = 0, totalBalance = 0, totalMonthly = 0;
  for (const d of debts) {
    totalOriginal += d.original_amount;
    totalBalance += d.current_balance;
    // Only count toward monthly if still owing.
    if (d.current_balance > 0) totalMonthly += d.monthly_amount;
  }
  const totalPaidOff = totalOriginal - totalBalance;
  const debtPct =
    totalOriginal > 0
      ? Math.round(((totalPaidOff / totalOriginal) * 100) * 10) / 10
      : 0;

  // How many months exist (for history quick stat).
  const monthCount = db
    .prepare("SELECT COUNT(DISTINCT month) AS n FROM monthly_records")
    .get().n;

  // Carry-forward: any month with pending lines. We separate "past" months
  // (before the latest generated month) from the current/latest one, since an
  // old unpaid month is the real concern.
  const pendingByMonth = db
    .prepare(
      `SELECT month,
              COUNT(*)        AS pending_count,
              SUM(amount)     AS pending_amount
       FROM monthly_records
       WHERE status = 'pending'
       GROUP BY month
       ORDER BY month ASC`
    )
    .all();

  const latestMonthKey = latest ? latest.month : null;
  const carryForward = pendingByMonth
    .filter((m) => latestMonthKey && m.month < latestMonthKey)
    .map((m) => ({
      month: m.month,
      pending_count: m.pending_count,
      pending_amount: m.pending_amount,
    }));

  res.json({
    commitments: {
      active_count: commitmentAgg.count,
      template_total: commitmentAgg.total,
    },
    expected_monthly_total: commitmentAgg.total + totalMonthly,
    latest_month: latestMonth,
    debts: {
      account_count: debts.length,
      total_original: totalOriginal,
      total_balance: totalBalance,
      total_paid_off: totalPaidOff,
      progress_pct: debtPct,
    },
    month_count: monthCount,
    carry_forward: carryForward,
  });
});

module.exports = router;