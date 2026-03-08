// routes/promo.js

const express = require('express');
const { ObjectId } = require('mongodb');
const router = express.Router();

const DB_NAME = 'UnityShopDB';
const COLLECTION_NAME = 'promoCodes';

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN ROUTES  (protect these with your admin middleware)
// ─────────────────────────────────────────────────────────────────────────────

// GET /promo/admin — get all promo codes (admin only)
router.get('/admin', async (req, res) => {
  try {
    const promos = await req.dbclient
      .db(DB_NAME)
      .collection(COLLECTION_NAME)
      .find()
      .sort({ createdAt: -1 })
      .toArray();

    res.send(promos);
  } catch (error) {
    res.status(500).send({ error: 'Failed to fetch promo codes.' });
  }
});

// POST /promo/admin — create a new promo code (admin only)
router.post('/admin', async (req, res) => {
  try {
    const { code, type, value, description, minOrder, maxUses, expiresAt } =
      req.body;

    // Basic validation
    if (!code || !type || !value) {
      return res
        .status(400)
        .send({ error: 'code, type, and value are required.' });
    }

    if (!['percentage', 'fixed'].includes(type)) {
      return res
        .status(400)
        .send({ error: 'type must be "percentage" or "fixed".' });
    }

    if (type === 'percentage' && (value <= 0 || value > 100)) {
      return res
        .status(400)
        .send({ error: 'Percentage value must be between 1 and 100.' });
    }

    // Check for duplicate code
    const existing = await req.dbclient
      .db(DB_NAME)
      .collection(COLLECTION_NAME)
      .findOne({ code: code.trim().toUpperCase() });

    if (existing) {
      return res
        .status(409)
        .send({ error: `Promo code "${code.toUpperCase()}" already exists.` });
    }

    const newPromo = {
      code: code.trim().toUpperCase(),
      type,
      value: Number(value),
      description: description || '',
      minOrder: minOrder ? Number(minOrder) : null,
      maxUses: maxUses ? Number(maxUses) : null, // null = unlimited
      usedCount: 0,
      isActive: true,
      expiresAt: expiresAt ? new Date(expiresAt) : null,
      createdAt: new Date(),
    };

    const result = await req.dbclient
      .db(DB_NAME)
      .collection(COLLECTION_NAME)
      .insertOne(newPromo);

    res.status(201).send(result);
  } catch (error) {
    res.status(500).send({ error: 'Failed to create promo code.' });
  }
});

// PATCH /promo/admin/:id — update a promo code (admin only)
router.patch('/admin/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const updates = req.body;

    // Prevent manually overriding usedCount from this route
    delete updates.usedCount;
    delete updates.createdAt;

    // Normalise code if it's being updated
    if (updates.code) {
      updates.code = updates.code.trim().toUpperCase();
    }

    // Convert expiresAt string to Date if provided
    if (updates.expiresAt) {
      updates.expiresAt = new Date(updates.expiresAt);
    }

    const result = await req.dbclient
      .db(DB_NAME)
      .collection(COLLECTION_NAME)
      .updateOne({ _id: new ObjectId(id) }, { $set: updates });

    res.send(result);
  } catch (error) {
    res.status(500).send({ error: 'Failed to update promo code.' });
  }
});

// DELETE /promo/admin/:id — delete a promo code (admin only)
router.delete('/admin/:id', async (req, res) => {
  try {
    const id = req.params.id;

    const result = await req.dbclient
      .db(DB_NAME)
      .collection(COLLECTION_NAME)
      .deleteOne({ _id: new ObjectId(id) });

    res.send(result);
  } catch (error) {
    res.status(500).send({ error: 'Failed to delete promo code.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC ROUTE  (called by the frontend cart/checkout)
// ─────────────────────────────────────────────────────────────────────────────

// POST /promo/validate — validate a promo code against a subtotal
// Body: { code: string, subtotal: number }
// Returns ONLY { valid, discount, description } — never exposes internal fields
router.post('/validate', async (req, res) => {
  try {
    const { code, subtotal } = req.body;

    if (!code || typeof subtotal !== 'number') {
      return res.status(400).send({ valid: false, error: 'Invalid request.' });
    }

    const promo = await req.dbclient
      .db(DB_NAME)
      .collection(COLLECTION_NAME)
      .findOne({ code: code.trim().toUpperCase() });

    // Code not found
    if (!promo) {
      return res.send({ valid: false, error: 'Invalid promo code.' });
    }

    // Inactive
    if (!promo.isActive) {
      return res.send({
        valid: false,
        error: 'This promo code is no longer active.',
      });
    }

    // Expired
    if (promo.expiresAt && new Date() > new Date(promo.expiresAt)) {
      return res.send({ valid: false, error: 'This promo code has expired.' });
    }

    // Usage limit reached
    if (promo.maxUses !== null && promo.usedCount >= promo.maxUses) {
      return res.send({
        valid: false,
        error: 'This promo code has reached its usage limit.',
      });
    }

    // Minimum order not met
    if (promo.minOrder && subtotal < promo.minOrder) {
      return res.send({
        valid: false,
        error: `A minimum order of $${promo.minOrder.toFixed(2)} is required for this code.`,
      });
    }

    // Calculate discount
    const discount =
      promo.type === 'percentage'
        ? parseFloat(((subtotal * promo.value) / 100).toFixed(2))
        : Math.min(promo.value, subtotal); // fixed: never exceed subtotal

    // Return ONLY what the frontend needs — internal fields stay hidden
    return res.send({
      valid: true,
      discount,
      description: promo.description,
      code: promo.code,
    });
  } catch (error) {
    res.status(500).send({ valid: false, error: 'Something went wrong.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// INTERNAL HELPER  (called by payment route after successful payment)
// Not an HTTP route — exported as a function for use inside payment.js
// ─────────────────────────────────────────────────────────────────────────────

// Usage inside payment.js:
//   const { incrementPromoUsage } = require("./promo");
//   await incrementPromoUsage(dbclient, "UNITY10");

async function incrementPromoUsage(dbclient, code) {
  if (!code) return;

  const promo = await dbclient
    .db(DB_NAME)
    .collection(COLLECTION_NAME)
    .findOne({ code: code.trim().toUpperCase() });

  if (!promo) return;

  const update = { $inc: { usedCount: 1 } };

  // Auto-deactivate if usage limit is now reached
  if (promo.maxUses !== null && promo.usedCount + 1 >= promo.maxUses) {
    update.$set = { isActive: false };
  }

  await dbclient
    .db(DB_NAME)
    .collection(COLLECTION_NAME)
    .updateOne({ code: code.trim().toUpperCase() }, update);
}

module.exports = router;
module.exports.incrementPromoUsage = incrementPromoUsage;
