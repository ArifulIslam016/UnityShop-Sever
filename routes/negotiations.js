// routes/negotiations.js
const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth"); // we'll create this next
const Negotiation = require("../models/Negotiation");
const { generateAIMessage } = require("../utils/aiHelper"); // we'll create this

// POST /api/negotiations - create a new negotiation
router.post("/", auth, async (req, res) => {
  try {
    const { productId, productPrice, userMessage, sellerId } = req.body;
    if (!productId || !productPrice || !sellerId) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // Extract offer amount from message (simple regex)
    const offerMatch = userMessage.match(/\$?(\d+(?:\.\d{2})?)/);
    const offerPrice = offerMatch ? parseFloat(offerMatch[1]) : null;

    if (!offerPrice) {
      return res.status(400).json({ error: "No price detected in message" });
    }

    const negotiation = new Negotiation({
      product: productId,
      buyer: req.user._id,
      seller: sellerId,
      offerPrice,
      originalPrice: productPrice,
      messages: [{ sender: req.user._id, message: userMessage }],
    });
    await negotiation.save();

    // Generate AI response (use your existing mock logic or real AI)
    const { aiResponse, suggestion } = generateAIMessage(
      productPrice,
      offerPrice,
      userMessage,
    );

    res.status(201).json({
      success: true,
      message: aiResponse,
      suggestion,
      offerPrice,
      offerSent: true,
      negotiationId: negotiation._id,
    });
  } catch (error) {
    console.error("POST /negotiations error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/negotiations?status=pending&sellerId=xxx
router.get("/", auth, async (req, res) => {
  try {
    const { status, sellerId } = req.query;
    if (!sellerId) {
      return res
        .status(400)
        .json({ error: "sellerId query parameter required" });
    }
    if (req.user._id !== sellerId && req.user.role !== "admin") {
      return res.status(403).json({ error: "Forbidden" });
    }
    const filter = { seller: sellerId };
    if (status) filter.status = status;
    const negotiations = await Negotiation.find(filter)
      .populate("product", "name price images")
      .populate("buyer", "name email")
      .sort({ createdAt: -1 });
    res.json(negotiations);
  } catch (error) {
    console.error("GET /negotiations error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/negotiations/:id - update status
router.patch("/:id", auth, async (req, res) => {
  try {
    const { status } = req.body;
    const { id } = req.params;
    if (!["accepted", "rejected", "countered"].includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }
    const negotiation = await Negotiation.findById(id);
    if (!negotiation) return res.status(404).json({ error: "Not found" });
    if (
      req.user._id !== negotiation.seller.toString() &&
      req.user.role !== "admin"
    ) {
      return res.status(403).json({ error: "Forbidden" });
    }
    negotiation.status = status;
    await negotiation.save();
    res.json({ success: true, negotiation });
  } catch (error) {
    console.error("PATCH /negotiations/:id error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
