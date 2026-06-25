// routes/commitments.js
// CRUD API for commitment templates (the recurring monthly things).
// These are NOT debts and NOT month snapshots — just the reusable templates
// that future month-generation will copy from.

const express = require("express");
const db = require("../db");

const router = express.Router();

const VALID_TYPES = ["fixed", "variable", "optional"];

// Small helper: validate the body for create/update. Returns an error string
// or null if everything is fine.
function validateBody(body) {
  const name = (body.name || "").trim();
  if (!name) return "Name is required.";
  if (!VALID_TYPES.includes(body.type)) {
    return "Type must be one of: fixed, variable, optional.";
  }
  const amount = Number(body.default_amount);
  if (!Number.isFinite(amount) || amount < 0) {
    return "Default amount must be a number of 0 or more.";
  }
  return null;
}

// GET /api/commitments  -> list all, newest first
router.get("/", (req, res) => {
  const rows = db
    .prepare("SELECT * FROM commitments ORDER BY active DESC, name COLLATE NOCASE ASC")
    .all();
  res.json(rows);
});

// POST /api/commitments  -> create
router.post("/", (req, res) => {
  const error = validateBody(req.body);
  if (error) return res.status(400).json({ error });

  const { name, type } = req.body;
  const default_amount = Number(req.body.default_amount);

  const info = db
    .prepare(
      "INSERT INTO commitments (name, type, default_amount, active) VALUES (?, ?, ?, 1)"
    )
    .run(name.trim(), type, default_amount);

  const created = db
    .prepare("SELECT * FROM commitments WHERE id = ?")
    .get(info.lastInsertRowid);
  res.status(201).json(created);
});

// PUT /api/commitments/:id  -> update name/type/amount
router.put("/:id", (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare("SELECT * FROM commitments WHERE id = ?").get(id);
  if (!existing) return res.status(404).json({ error: "Commitment not found." });

  const error = validateBody(req.body);
  if (error) return res.status(400).json({ error });

  const { name, type } = req.body;
  const default_amount = Number(req.body.default_amount);

  db.prepare(
    "UPDATE commitments SET name = ?, type = ?, default_amount = ? WHERE id = ?"
  ).run(name.trim(), type, default_amount, id);

  const updated = db.prepare("SELECT * FROM commitments WHERE id = ?").get(id);
  res.json(updated);
});

// PATCH /api/commitments/:id/active  -> toggle active on/off
router.patch("/:id/active", (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare("SELECT * FROM commitments WHERE id = ?").get(id);
  if (!existing) return res.status(404).json({ error: "Commitment not found." });

  const newActive = existing.active ? 0 : 1;
  db.prepare("UPDATE commitments SET active = ? WHERE id = ?").run(newActive, id);

  const updated = db.prepare("SELECT * FROM commitments WHERE id = ?").get(id);
  res.json(updated);
});

module.exports = router;