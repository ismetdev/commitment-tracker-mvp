// app.js — single-page view switching + a health check to prove the API works.

// --- View switching ---------------------------------------------------------
const navButtons = document.querySelectorAll(".nav-btn");
const views = document.querySelectorAll(".view");

function showView(name) {
  navButtons.forEach((b) => b.classList.toggle("active", b.dataset.view === name));
  views.forEach((v) => v.classList.toggle("active", v.id === `view-${name}`));

  // Refresh data when entering a tab so figures are always current.
  if (name === "dashboard") loadDashboard();
  if (name === "commitments") loadCommitments();
  if (name === "debts") loadDebts();
  if (name === "history") loadHistory();
  if (name === "help") loadHelp();
}

navButtons.forEach((btn) => {
  btn.addEventListener("click", () => showView(btn.dataset.view));
});

// --- Health (small status line on the dashboard) ----------------------------
async function checkHealth() {
  const el = document.getElementById("health");
  try {
    const res = await fetch("/api/health");
    const data = await res.json();
    el.textContent = data.ok ? `Server + database OK.` : "Database check failed.";
  } catch (err) {
    el.textContent = "Could not reach the server.";
  }
}

checkHealth();

// --- Dashboard --------------------------------------------------------------
const dashContent = document.getElementById("dash-content");

async function loadDashboard() {
  try {
    const d = await api("/api/dashboard");
    renderDashboard(d);
  } catch (err) {
    dashContent.innerHTML = `<div class="empty">Could not load overview: ${escapeHtml(err.message)}</div>`;
  }
  checkHealth();
}

function renderDashboard(d) {
  const lm = d.latest_month;

  // First-run: no commitments at all. Show a welcome and a clear first step
  // instead of a wall of zeros.
  if (d.commitments.active_count === 0 && d.month_count === 0 && d.debts.account_count === 0) {
    dashContent.innerHTML = `
      <div class="card welcome">
        <h3 style="margin-top:0;">Welcome to your Commitment Tracker 👋</h3>
        <p class="muted">This is a local, private tool to track your monthly commitments, keep month-by-month history, and lightly track personal debts.</p>
        <p style="margin-bottom:16px;"><strong>Step 1:</strong> Add the recurring things you pay each month such as rent, subscriptions, gym, and so on.</p>
        <button class="btn btn-primary" id="welcome-go">Add your commitments →</button>
      </div>`;
    const go = document.getElementById("welcome-go");
    if (go) go.addEventListener("click", () => showView("commitments"));
    checkHealth();
    return;
  }

  // Contextual next-step nudge (have some data, but not fully set up yet).
  let nextStep = "";
  if (d.commitments.active_count === 0) {
    nextStep = `
      <div class="card nudge">
        <p style="margin:0 0 10px;"><strong>Next step:</strong> You have no active commitments. Add some so you can generate a month.</p>
        <button class="btn btn-primary btn-sm" id="nudge-commitments">Go to Commitments →</button>
      </div>`;
  } else if (d.month_count === 0) {
    nextStep = `
      <div class="card nudge">
        <p style="margin:0 0 10px;"><strong>Next step:</strong> You have commitments set up. Generate your first month to start tracking.</p>
        <button class="btn btn-primary btn-sm" id="nudge-monthly">Go to Monthly →</button>
      </div>`;
  }

  const monthBlock = lm
    ? `
      <div class="card">
        <div class="top" style="display:flex;justify-content:space-between;align-items:baseline;">
          <h3 style="margin:0;">Latest month — ${lm.month}</h3>
          <button class="btn btn-sm" id="dash-open-month" data-month="${lm.month}">Open</button>
        </div>
        <div class="stats" style="margin-top:12px;">
          <div class="stat"><div class="label">Total</div><div class="value">${money(lm.total)}</div></div>
          <div class="stat paid"><div class="label">Paid</div><div class="value">${money(lm.paid)}</div></div>
          <div class="stat pending"><div class="label">Pending</div><div class="value">${money(lm.pending)}</div></div>
          <div class="stat"><div class="label">Lines</div><div class="value">${lm.count}</div></div>
        </div>
      </div>`
    : "";

  const debtProgress = d.debts.account_count
    ? `<div class="progress"><span style="width:${d.debts.progress_pct}%;"></span></div>
       <p class="pct-label">${d.debts.progress_pct}% paid off across ${d.debts.account_count} account(s)</p>`
    : `<p class="muted" style="margin:0;">No debts tracked.</p>`;

  // Carry-forward: past months still holding pending items.
  const cf = d.carry_forward || [];
  let carryBlock = "";
  if (cf.length) {
    const items = cf
      .map(
        (m) => `
        <button class="carry-item" data-carrymonth="${m.month}">
          <span class="carry-month">${m.month}</span>
          <span class="carry-detail">${money(m.pending_amount)} pending · ${m.pending_count} item(s)</span>
        </button>`
      )
      .join("");
    carryBlock = `
      <div class="card carry-card">
        <h3 style="margin-top:0;">⚠ Earlier months with pending items</h3>
        <p class="muted small" style="margin-top:0;">These months from before your latest aren't fully paid. Click to open and settle them.</p>
        <div class="carry-list">${items}</div>
      </div>`;
  } else if (d.month_count > 0) {
    carryBlock = `
      <div class="card">
        <p class="muted" style="margin:0;">No earlier months are left pending. You're on top of it.</p>
      </div>`;
  }

  dashContent.innerHTML = `
    <div class="stats">
      <div class="stat">
        <div class="label">Active commitments</div>
        <div class="value">${d.commitments.active_count}</div>
        <div class="pct-label">${money(d.expected_monthly_total)} / month expected</div>
      </div>
      <div class="stat">
        <div class="label">Months tracked</div>
        <div class="value">${d.month_count}</div>
      </div>
      <div class="stat">
        <div class="label">Total owed</div>
        <div class="value">${money(d.debts.total_balance)}</div>
        <div class="pct-label">of ${money(d.debts.total_original)} original</div>
      </div>
    </div>

    ${nextStep}

    ${carryBlock}

    ${monthBlock}

    <div class="card">
      <h3 style="margin-top:0;">Debt overview</h3>
      ${debtProgress}
    </div>

    <div class="card">
      <h3 style="margin-top:0;">Backup &amp; export</h3>
      <p class="muted small" style="margin-top:0;">Keep your data safe. The .sqlite backup can fully restore everything; the CSV is for reading or archiving.</p>
      <div class="inline-controls">
        <a class="btn btn-primary" href="/api/backup/sqlite">Download backup (.sqlite)</a>
        <a class="btn" href="/api/backup/csv">Export CSV</a>
      </div>
      <p class="muted small" id="db-location" style="margin-bottom:0;"></p>
    </div>`;

  const openBtn = document.getElementById("dash-open-month");
  if (openBtn) {
    openBtn.addEventListener("click", () => {
      mPicker.value = openBtn.dataset.month;
      showView("monthly");
      loadMonth(openBtn.dataset.month);
    });
  }

  // Next-step nudge buttons.
  const nudgeC = document.getElementById("nudge-commitments");
  if (nudgeC) nudgeC.addEventListener("click", () => showView("commitments"));
  const nudgeM = document.getElementById("nudge-monthly");
  if (nudgeM) nudgeM.addEventListener("click", () => showView("monthly"));

  // Show where the live database file lives (handy for manual backups).
  api("/api/backup/location")
    .then((d) => {
      const el = document.getElementById("db-location");
      if (el) el.textContent = `Live database file: ${d.path}`;
    })
    .catch(() => {});

  // Carry-forward items jump to that month in the Monthly view.
  dashContent.querySelectorAll("[data-carrymonth]").forEach((btn) => {
    btn.addEventListener("click", () => {
      mPicker.value = btn.dataset.carrymonth;
      showView("monthly");
      loadMonth(btn.dataset.carrymonth);
    });
  });
}

// --- How to Use page: inject + wire the danger zone at the bottom -----------
const helpDanger = document.getElementById("help-danger");

function loadHelp() {
  if (!helpDanger || helpDanger.dataset.wired === "yes") return;

  helpDanger.innerHTML = `
    <div class="card danger-zone">
      <h3 style="margin-top:0;">⚠ Danger zone — reset data</h3>
      <p class="muted small" style="margin-top:0;">These permanently delete data. Download a backup first.</p>
      <div class="inline-controls" style="margin-bottom:12px;">
        <a class="btn" href="/api/backup/sqlite">Download backup first</a>
      </div>
      <div class="reset-row">
        <button class="btn btn-danger btn-sm" id="reset-monthly">Clear all monthly records</button>
        <button class="btn btn-danger btn-sm" id="reset-debts">Clear all debts</button>
        <button class="btn btn-danger btn-sm" id="reset-commitments">Clear all commitments</button>
      </div>
      <hr style="border:none;border-top:1px solid var(--line);margin:14px 0;" />
      <p class="small" style="margin:0 0 8px;"><strong>Clear everything.</strong> Type <code>RESET</code> to enable.</p>
      <div class="inline-controls">
        <input type="text" id="reset-confirm" placeholder="Type RESET" style="width:140px;" />
        <button class="btn btn-danger btn-sm" id="reset-all" disabled>Clear everything</button>
      </div>
      <div id="reset-msg" class="error-msg"></div>
    </div>`;

  const resetMsg = document.getElementById("reset-msg");
  const doReset = async (path, label) => {
    if (resetMsg) resetMsg.textContent = "";
    try {
      await api(path, { method: "POST", body: JSON.stringify({}) });
      loadDashboard();
      loadCommitments();
      loadDebts();
      if (resetMsg) resetMsg.textContent = `Done: ${label} cleared.`;
    } catch (err) {
      if (resetMsg) resetMsg.textContent = err.message;
    }
  };

  const rm = document.getElementById("reset-monthly");
  if (rm) rm.addEventListener("click", () => {
    if (!confirm("Delete ALL monthly records? Past months and their snapshots will be gone. This cannot be undone.")) return;
    doReset("/api/reset/monthly", "monthly records");
  });

  const rd = document.getElementById("reset-debts");
  if (rd) rd.addEventListener("click", () => {
    if (!confirm("Delete ALL debts and their payment history? Debt lines in months will be unlinked. This cannot be undone.")) return;
    doReset("/api/reset/debts", "debts");
  });

  const rc = document.getElementById("reset-commitments");
  if (rc) rc.addEventListener("click", () => {
    if (!confirm("Delete ALL commitment templates? Past month snapshots stay but won't be linked to templates. This cannot be undone.")) return;
    doReset("/api/reset/commitments", "commitments");
  });

  const resetConfirm = document.getElementById("reset-confirm");
  const resetAll = document.getElementById("reset-all");
  if (resetConfirm && resetAll) {
    resetConfirm.addEventListener("input", () => {
      resetAll.disabled = resetConfirm.value.trim() !== "RESET";
    });
    resetAll.addEventListener("click", async () => {
      if (resetConfirm.value.trim() !== "RESET") return;
      if (!confirm("This wipes EVERYTHING — commitments, months, debts, payments. Absolutely sure?")) return;
      if (resetMsg) resetMsg.textContent = "";
      try {
        await api("/api/reset/all", {
          method: "POST",
          body: JSON.stringify({ confirm: "RESET" }),
        });
        selectedDebtId = null;
        currentMonth = null;
        resetConfirm.value = "";
        resetAll.disabled = true;
        loadDashboard();
        loadCommitments();
        loadDebts();
        if (resetMsg) resetMsg.textContent = "Everything cleared. Fresh start.";
      } catch (err) {
        if (resetMsg) resetMsg.textContent = err.message;
      }
    });
  }

  helpDanger.dataset.wired = "yes";
}

// --- History ----------------------------------------------------------------
const historyContent = document.getElementById("history-content");

async function loadHistory() {
  try {
    const months = await api("/api/monthly/months");
    if (!months.length) {
      historyContent.innerHTML = `<div class="empty">No months generated yet. Once you generate months in the Monthly tab, they'll appear here with their totals.</div>`;
      return;
    }
    // Fetch each month's summary. Sequential is fine for a personal app.
    const rows = [];
    for (const m of months) {
      const data = await api(`/api/monthly/${m}`);
      rows.push({ month: m, ...data.summary });
    }
    renderHistory(rows);
  } catch (err) {
    historyContent.innerHTML = `<div class="empty">Could not load history: ${escapeHtml(err.message)}</div>`;
  }
}

function renderHistory(rows) {
  const body = rows
    .map(
      (r) => `
      <tr>
        <td><button class="btn btn-sm" data-openmonth="${r.month}">${r.month}</button></td>
        <td class="right">${money(r.total)}</td>
        <td class="right">${money(r.paid)}</td>
        <td class="right">${money(r.pending)}</td>
        <td class="right">${r.count}</td>
      </tr>`
    )
    .join("");

  historyContent.innerHTML = `
    <table class="data">
      <thead>
        <tr><th>Month</th><th class="right">Total</th><th class="right">Paid</th><th class="right">Pending</th><th class="right">Lines</th></tr>
      </thead>
      <tbody>${body}</tbody>
    </table>`;

  historyContent.querySelectorAll("[data-openmonth]").forEach((btn) => {
    btn.addEventListener("click", () => {
      mPicker.value = btn.dataset.openmonth;
      showView("monthly");
      loadMonth(btn.dataset.openmonth);
    });
  });
}

// Load the dashboard immediately on first paint.
loadDashboard();

// --- Shared helpers ---------------------------------------------------------
async function api(path, options) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  let data = null;
  try { data = await res.json(); } catch (_) { /* no body */ }
  if (!res.ok) {
    const msg = (data && data.error) || `Request failed (${res.status}).`;
    throw new Error(msg);
  }
  return data;
}

function money(n) {
  return Number(n).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// --- Commitments ------------------------------------------------------------
const cForm = document.getElementById("commitment-form");
const cId = document.getElementById("c-id");
const cName = document.getElementById("c-name");
const cType = document.getElementById("c-type");
const cAmount = document.getElementById("c-amount");
const cSubmit = document.getElementById("c-submit");
const cCancel = document.getElementById("c-cancel");
const cError = document.getElementById("c-error");
const cList = document.getElementById("commitment-list");

function resetCommitmentForm() {
  cId.value = "";
  cName.value = "";
  cType.value = "fixed";
  cAmount.value = "0";
  cError.textContent = "";
  cSubmit.textContent = "Add commitment";
  cCancel.style.display = "none";
}

function startEditCommitment(c) {
  cId.value = c.id;
  cName.value = c.name;
  cType.value = c.type;
  cAmount.value = c.default_amount;
  cError.textContent = "";
  cSubmit.textContent = "Save changes";
  cCancel.style.display = "inline-block";
  cName.focus();
}

cCancel.addEventListener("click", resetCommitmentForm);

cForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  cError.textContent = "";
  const payload = {
    name: cName.value,
    type: cType.value,
    default_amount: cAmount.value,
  };
  try {
    if (cId.value) {
      await api(`/api/commitments/${cId.value}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });
    } else {
      await api("/api/commitments", {
        method: "POST",
        body: JSON.stringify(payload),
      });
    }
    resetCommitmentForm();
    loadCommitments();
  } catch (err) {
    cError.textContent = err.message;
  }
});

async function toggleCommitment(id) {
  try {
    await api(`/api/commitments/${id}/active`, { method: "PATCH" });
    loadCommitments();
  } catch (err) {
    cError.textContent = err.message;
  }
}

function renderCommitments(rows) {
  if (!rows.length) {
    cList.innerHTML = `<div class="empty">No commitments yet. These are the recurring things you pay each month — add your first one above, and it'll be available when you generate a month.</div>`;
    return;
  }
  const body = rows
    .map((c) => {
      const cls = c.active ? "" : "inactive";
      const toggleLabel = c.active ? "Deactivate" : "Reactivate";
      return `
        <tr class="${cls}">
          <td>${escapeHtml(c.name)}</td>
          <td><span class="badge ${c.type}">${c.type}</span></td>
          <td class="right">${money(c.default_amount)}</td>
          <td>${c.active ? "Active" : "Inactive"}</td>
          <td class="right">
            <button class="btn btn-sm" data-edit="${c.id}">Edit</button>
            <button class="btn btn-sm" data-toggle="${c.id}">${toggleLabel}</button>
          </td>
        </tr>`;
    })
    .join("");

  cList.innerHTML = `
    <table class="data">
      <thead>
        <tr><th>Name</th><th>Type</th><th class="right">Amount</th><th>Status</th><th></th></tr>
      </thead>
      <tbody>${body}</tbody>
    </table>`;

  // Wire row buttons (we keep the data on the element to avoid global lookups).
  cList.querySelectorAll("[data-edit]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const row = rows.find((r) => r.id === Number(btn.dataset.edit));
      if (row) startEditCommitment(row);
    });
  });
  cList.querySelectorAll("[data-toggle]").forEach((btn) => {
    btn.addEventListener("click", () => toggleCommitment(Number(btn.dataset.toggle)));
  });
}

async function loadCommitments() {
  try {
    const rows = await api("/api/commitments");
    renderCommitments(rows);
  } catch (err) {
    cList.innerHTML = `<div class="empty">Could not load commitments: ${escapeHtml(err.message)}</div>`;
  }
}

// Basic HTML escaping so names with < > & don't break the markup.
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Load commitments once at startup so the list is ready when you open the tab.
loadCommitments();

// --- Monthly ----------------------------------------------------------------
const mPicker = document.getElementById("m-picker");
const mGenerate = document.getElementById("m-generate");
const mLoad = document.getElementById("m-load");
const mError = document.getElementById("m-error");
const mSummary = document.getElementById("m-summary");
const mLines = document.getElementById("m-lines");
const mAdhocCard = document.getElementById("m-adhoc-card");
const mAdhocName = document.getElementById("m-adhoc-name");
const mAdhocAmount = document.getElementById("m-adhoc-amount");
const mAdhocAdd = document.getElementById("m-adhoc-add");
const mAdhocError = document.getElementById("m-adhoc-error");

// Default the picker to the current month for convenience.
(function initMonthPicker() {
  const now = new Date();
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  mPicker.value = ym;
})();

let currentMonth = null;

// Show a gentle hint in the Monthly view until a month is loaded/generated.
(function initMonthlyHint() {
  if (mLines && !mLines.innerHTML.trim()) {
    mLines.innerHTML = `<div class="empty">Pick a month above and click <strong>Generate month</strong> to snapshot your active commitments, or <strong>Load</strong> to view a month you've already generated.</div>`;
  }
})();

mGenerate.addEventListener("click", async () => {
  mError.textContent = "";
  const month = mPicker.value;
  if (!month) { mError.textContent = "Pick a month first."; return; }
  try {
    const data = await api("/api/monthly/generate", {
      method: "POST",
      body: JSON.stringify({ month }),
    });
    currentMonth = data.month;
    renderMonth(data);
  } catch (err) {
    mError.textContent = err.message;
    // If it already exists, offer to load it instead.
    if (/already exists/i.test(err.message)) {
      loadMonth(month);
    }
  }
});

mLoad.addEventListener("click", () => {
  mError.textContent = "";
  const month = mPicker.value;
  if (!month) { mError.textContent = "Pick a month first."; return; }
  loadMonth(month);
});

async function loadMonth(month) {
  try {
    const data = await api(`/api/monthly/${month}`);
    currentMonth = month;
    if (data.lines.length === 0) {
      mSummary.innerHTML = "";
      mLines.innerHTML = `<div class="empty">Month ${month} hasn't been generated yet. Click "Generate month".</div>`;
      mAdhocCard.style.display = "none";
    } else {
      renderMonth(data);
    }
  } catch (err) {
    mError.textContent = err.message;
  }
}

async function toggleLineStatus(id) {
  try {
    await api(`/api/monthly/line/${id}/status`, { method: "PATCH" });
    loadMonth(currentMonth);
  } catch (err) {
    mError.textContent = err.message;
  }
}

async function deleteLine(id) {
  try {
    await api(`/api/monthly/line/${id}`, { method: "DELETE" });
    loadMonth(currentMonth);
  } catch (err) {
    mError.textContent = err.message;
  }
}

mAdhocAdd.addEventListener("click", async () => {
  mAdhocError.textContent = "";
  if (!currentMonth) { mAdhocError.textContent = "Load or generate a month first."; return; }
  try {
    await api(`/api/monthly/${currentMonth}/line`, {
      method: "POST",
      body: JSON.stringify({ name: mAdhocName.value, amount: mAdhocAmount.value }),
    });
    mAdhocName.value = "";
    mAdhocAmount.value = "";
    loadMonth(currentMonth);
  } catch (err) {
    mAdhocError.textContent = err.message;
  }
});

function renderMonth(data) {
  const { month, lines, summary } = data;

  mSummary.innerHTML = `
    <div class="stats">
      <div class="stat"><div class="label">Month</div><div class="value">${month}</div></div>
      <div class="stat"><div class="label">Total</div><div class="value">${money(summary.total)}</div></div>
      <div class="stat paid"><div class="label">Paid</div><div class="value">${money(summary.paid)}</div></div>
      <div class="stat pending"><div class="label">Pending</div><div class="value">${money(summary.pending)}</div></div>
    </div>
    <div style="margin-bottom:14px;">
      <button class="link-danger" id="m-delete-month" data-month="${month}">Delete this month</button>
    </div>`;

  const body = lines
    .map((l) => {
      const isDebt = l.debt_id != null;
      const isAdhoc = l.commitment_id == null && l.debt_id == null;
      const delBtn = isAdhoc
        ? `<button class="link-danger" data-del="${l.id}" data-del-name="${escapeHtml(l.name)}" data-del-amount="${l.amount}">remove</button>`
        : "";
      let tag = "";
      if (isAdhoc) tag = ' <span class="badge optional">one-off</span>';
      else if (isDebt) tag = ' <span class="badge debt">debt</span>';
      return `
        <tr>
          <td>${escapeHtml(l.name)}${tag}</td>
          <td><span class="badge ${l.type}">${l.type}</span></td>
          <td class="right"><span class="editable-amount" data-amount-id="${l.id}" data-amount="${l.amount}" title="Click to edit">${money(l.amount)}</span></td>
          <td><button class="pill ${l.status}" data-status="${l.id}">${l.status}</button></td>
          <td class="right">${delBtn}</td>
        </tr>`;
    })
    .join("");

  mLines.innerHTML = `
    <table class="data">
      <thead>
        <tr><th>Name</th><th>Type</th><th class="right">Amount</th><th>Status</th><th></th></tr>
      </thead>
      <tbody>${body}</tbody>
    </table>`;

  mLines.querySelectorAll("[data-status]").forEach((btn) => {
    btn.addEventListener("click", () => toggleLineStatus(Number(btn.dataset.status)));
  });
  mLines.querySelectorAll("[data-del]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const name = btn.dataset.delName;
      const amt = money(Number(btn.dataset.delAmount));
      if (!confirm(`Remove the one-off line "${name}" (${amt}) from this month? This cannot be undone.`)) return;
      deleteLine(Number(btn.dataset.del));
    });
  });
  mLines.querySelectorAll(".editable-amount").forEach((span) => {
    span.addEventListener("click", () => startAmountEdit(span));
  });

  const delMonthBtn = document.getElementById("m-delete-month");
  if (delMonthBtn) {
    delMonthBtn.addEventListener("click", async () => {
      const mo = delMonthBtn.dataset.month;
      if (!confirm(`Delete the entire month ${mo} and all its lines? Any paid debt lines will have their balances restored. This cannot be undone.`)) return;
      try {
        await api(`/api/monthly/${mo}`, { method: "DELETE" });
        currentMonth = null;
        mSummary.innerHTML = "";
        mLines.innerHTML = `<div class="empty">Month ${mo} deleted. You can regenerate it with the Generate button.</div>`;
        mAdhocCard.style.display = "none";
      } catch (err) {
        mError.textContent = err.message;
      }
    });
  }

  mAdhocCard.style.display = "block";
}

// Inline edit of a month line's amount. Click -> input; Enter/blur saves;
// Escape cancels.
function startAmountEdit(span) {
  const id = Number(span.dataset.amountId);
  const current = Number(span.dataset.amount);

  // Avoid stacking multiple inputs if clicked twice.
  if (span.querySelector("input")) return;

  const input = document.createElement("input");
  input.type = "number";
  input.min = "0";
  input.step = "0.01";
  input.value = current;
  input.style.width = "90px";
  input.style.textAlign = "right";

  span.textContent = "";
  span.appendChild(input);
  input.focus();
  input.select();

  let done = false;
  const cancel = () => {
    if (done) return;
    done = true;
    span.textContent = money(current);
  };
  const save = async () => {
    if (done) return;
    const val = input.value;
    // No change or empty -> just revert.
    if (val === "" || Number(val) === current) return cancel();
    done = true;
    try {
      await api(`/api/monthly/line/${id}/amount`, {
        method: "PATCH",
        body: JSON.stringify({ amount: val }),
      });
      loadMonth(currentMonth); // re-render with new totals
    } catch (err) {
      mError.textContent = err.message;
      span.textContent = money(current);
    }
  };

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); save(); }
    else if (e.key === "Escape") { e.preventDefault(); cancel(); }
  });
  input.addEventListener("blur", save);
}

// --- Debts ------------------------------------------------------------------
const dForm = document.getElementById("debt-form");
const dName = document.getElementById("d-name");
const dOriginal = document.getElementById("d-original");
const dBalance = document.getElementById("d-balance");
const dError = document.getElementById("d-error");
const dList = document.getElementById("debt-list");
const dDetail = document.getElementById("debt-detail");
const dMonthly = document.getElementById("d-monthly");

let selectedDebtId = null;

dForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  dError.textContent = "";
  try {
    await api("/api/debts", {
      method: "POST",
      body: JSON.stringify({
        name: dName.value,
        original_amount: dOriginal.value,
        current_balance: dBalance.value,
        monthly_amount: dMonthly.value,
      }),
    });
    dName.value = "";
    dOriginal.value = "0";
    dBalance.value = "";
    dMonthly.value = "0";
    loadDebts();
  } catch (err) {
    dError.textContent = err.message;
  }
});

async function loadDebts() {
  try {
    const accounts = await api("/api/debts");
    renderDebtList(accounts);
    // Keep detail in sync if one was open.
    if (selectedDebtId && accounts.some((a) => a.id === selectedDebtId)) {
      openDebt(selectedDebtId);
    } else {
      selectedDebtId = null;
      dDetail.innerHTML = "";
    }
  } catch (err) {
    dList.innerHTML = `<div class="empty">Could not load debts: ${escapeHtml(err.message)}</div>`;
  }
}

function renderDebtList(accounts) {
  if (!accounts.length) {
    dList.innerHTML = `<div class="empty">No debts tracked. This section is optional — use it for light tracking of personal loans (money owed to family or friends). Add one above if you'd like.</div>`;
    return;
  }
  dList.innerHTML = accounts
    .map((a) => {
      const cls = a.id === selectedDebtId ? "debt-card selected" : "debt-card";
      const done = a.current_balance <= 0 ? ' <span class="badge fixed">paid off</span>' : "";
      return `
        <div class="${cls}" data-debt="${a.id}">
          <div class="top">
            <span class="name">${escapeHtml(a.name)}${done}</span>
            <span class="bal">balance <strong>${money(a.current_balance)}</strong> of ${money(a.original_amount)}</span>
          </div>
          <div class="progress"><span style="width:${a.progress_pct}%;"></span></div>
          <div class="pct-label">${a.progress_pct}% paid off · ${money(a.monthly_amount)}/month · ${a.payment_count} payment(s)</div>
        </div>`;
    })
    .join("");

  dList.querySelectorAll("[data-debt]").forEach((card) => {
    card.addEventListener("click", () => openDebt(Number(card.dataset.debt)));
  });
}

async function openDebt(id) {
  selectedDebtId = id;
  // Update selection highlight without full reload.
  dList.querySelectorAll(".debt-card").forEach((c) => {
    c.classList.toggle("selected", Number(c.dataset.debt) === id);
  });
  try {
    const a = await api(`/api/debts/${id}`);
    renderDebtDetail(a);
  } catch (err) {
    dDetail.innerHTML = `<div class="empty">${escapeHtml(err.message)}</div>`;
  }
}

function renderDebtDetail(a) {
  const paymentsRows = a.payments.length
    ? a.payments
        .map(
          (p) => `
        <tr>
          <td>${p.payment_date}</td>
          <td class="right">${money(p.amount)}</td>
          <td>${p.notes ? escapeHtml(p.notes) : '<span class="muted">—</span>'}</td>
          <td class="right"><button class="link-danger" data-delpay="${p.id}" data-pay-amount="${p.amount}" data-pay-date="${p.payment_date}">remove</button></td>
        </tr>`
        )
        .join("")
    : `<tr><td colspan="4" class="muted" style="text-align:center;">No payments yet.</td></tr>`;

  const pace = a.recent_avg_payment > 0
    ? `Recent pace: ~${money(a.recent_avg_payment)} per payment (last ${Math.min(3, a.payment_count)}).`
    : "";

  dDetail.innerHTML = `
    <div class="card">
      <div class="top" style="display:flex;justify-content:space-between;align-items:center;">
        <h3 style="margin:0;">${escapeHtml(a.name)}</h3>
        <button class="link-danger" id="d-delete-account">delete account</button>
      </div>

      <div class="detail-grid" style="margin-top:12px;">
        <div class="stat"><div class="label">Balance</div><div class="value">${money(a.current_balance)}</div></div>
        <div class="stat"><div class="label">Original</div><div class="value">${money(a.original_amount)}</div></div>
        <div class="stat paid"><div class="label">Paid off</div><div class="value">${money(a.paid_off)}</div></div>
        <div class="stat"><div class="label">Progress</div><div class="value">${a.progress_pct}%</div></div>
        <div class="stat"><div class="label">Monthly payment</div><div class="value">${money(a.monthly_amount)}</div></div>
      </div>
      <div class="progress"><span style="width:${a.progress_pct}%;"></span></div>
      <p class="muted small">${pace}</p>

      ${a.monthly_amount > 0
        ? ""
        : `<p class="muted small" style="color:#b9831b;">⚠ Monthly payment is 0, so this debt won't appear in generated months. Set it below.</p>`}

      <h4 style="margin-bottom:8px;">Edit debt details</h4>
      <div class="inline-controls">
        <input type="text" id="edit-name" value="${escapeHtml(a.name)}" placeholder="Name" />
        <input type="number" id="edit-original" min="0" step="0.01" value="${a.original_amount}" placeholder="Original" title="Original amount" />
        <input type="number" id="edit-monthly" min="0" step="0.01" value="${a.monthly_amount}" placeholder="Monthly" title="Monthly payment" />
        <button class="btn btn-primary" id="edit-save">Save details</button>
      </div>
      <div id="edit-error" class="error-msg"></div>

      <h4 style="margin-bottom:8px;">Record an extra payment <span class="muted small">(off-schedule, optional)</span></h4>
      <div class="inline-controls">
        <input type="number" id="pay-amount" min="0" step="0.01" placeholder="Amount" />
        <input type="date" id="pay-date" />
        <input type="text" id="pay-notes" placeholder="Notes (optional)" />
        <button class="btn btn-primary" id="pay-add">Add payment</button>
      </div>
      <div id="pay-error" class="error-msg"></div>

      <h4 style="margin:16px 0 8px;">Payment history</h4>
      <table class="data">
        <thead><tr><th>Date</th><th class="right">Amount</th><th>Notes</th><th></th></tr></thead>
        <tbody>${paymentsRows}</tbody>
      </table>
    </div>`;

  // Wire payment add.
  const payAmount = document.getElementById("pay-amount");
  const payDate = document.getElementById("pay-date");
  const payNotes = document.getElementById("pay-notes");
  const payError = document.getElementById("pay-error");

  // Wire edit-details save.
  document.getElementById("edit-save").addEventListener("click", async () => {
    const editError = document.getElementById("edit-error");
    editError.textContent = "";
    try {
      await api(`/api/debts/${a.id}`, {
        method: "PUT",
        body: JSON.stringify({
          name: document.getElementById("edit-name").value,
          original_amount: document.getElementById("edit-original").value,
          monthly_amount: document.getElementById("edit-monthly").value,
        }),
      });
      loadDebts();
    } catch (err) {
      editError.textContent = err.message;
    }
  });

  document.getElementById("pay-add").addEventListener("click", async () => {
    payError.textContent = "";
    try {
      await api(`/api/debts/${a.id}/payments`, {
        method: "POST",
        body: JSON.stringify({
          amount: payAmount.value,
          payment_date: payDate.value,
          notes: payNotes.value,
        }),
      });
      loadDebts();
    } catch (err) {
      payError.textContent = err.message;
    }
  });

  // Wire payment deletes.
  dDetail.querySelectorAll("[data-delpay]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const amt = money(Number(btn.dataset.payAmount));
      const date = btn.dataset.payDate;
      if (!confirm(`Remove the ${amt} payment from ${date}? This cannot be undone. The balance will go back up by ${amt}.`)) return;
      try {
        await api(`/api/debts/${a.id}/payments/${btn.dataset.delpay}`, { method: "DELETE" });
        loadDebts();
      } catch (err) {
        payError.textContent = err.message;
      }
    });
  });

  // Wire account delete.
  document.getElementById("d-delete-account").addEventListener("click", async () => {
    if (!confirm(`Delete the debt "${a.name}" and all of its payment history? This cannot be undone.`)) return;
    try {
      await api(`/api/debts/${a.id}`, { method: "DELETE" });
      selectedDebtId = null;
      loadDebts();
    } catch (err) {
      dError.textContent = err.message;
    }
  });
}

// Load debts at startup too.
loadDebts();