const express = require("express");
const { ObjectId } = require("mongodb");
const router = express.Router();

const DB_NAME = "UnityShopDB";
const COLLECTION = "notifications";

// ─── Socket.io: Join Room ──────────────────────────────────────────────────────
// Ideally handled on client connection, but we can have an endpoint if needed.

// ─── Create a notification ─────────────────────────────────────────────────────
router.post("/", async (req, res) => {
  try {
    const { email, type, title, message, meta } = req.body;
    if (!email || !type || !title) {
      return res.status(400).json({ error: "email, type, title are required" });
    }

    const notification = {
      email,
      type, // cart_add | order_confirmed | payment_success | coupon | product_approved | product_rejected
      title,
      message: message || "",
      meta: meta || {},
      read: false,
      createdAt: new Date(),
    };

    const result = await req.dbclient
      .db(DB_NAME)
      .collection(COLLECTION)
      .insertOne(notification);

    notification._id = result.insertedId;

    // Push real-time to Socket.io clients in the room (email)
    if (req.io) {
      req.io.to(email.toLowerCase()).emit("notification", notification);
    }

    res.status(201).json(notification);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to create notification" });
  }
});

// ─── Get notifications for a user ──────────────────────────────────────────────
router.get("/", async (req, res) => {
  try {
    const { email } = req.query;
    if (!email) return res.status(400).json({ error: "email is required" });

    const notifications = await req.dbclient
      .db(DB_NAME)
      .collection(COLLECTION)
      .find({ email })
      .sort({ createdAt: -1 })
      .limit(50)
      .toArray();

    res.json(notifications);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch notifications" });
  }
});

// ─── Get unread count ──────────────────────────────────────────────────────────
router.get("/unread-count", async (req, res) => {
  try {
    const { email } = req.query;
    if (!email) return res.status(400).json({ error: "email is required" });

    const count = await req.dbclient
      .db(DB_NAME)
      .collection(COLLECTION)
      .countDocuments({ email, read: false });

    res.json({ count });
  } catch (error) {
    res.status(500).json({ error: "Failed to get unread count" });
  }
});

// ─── Mark one notification as read ─────────────────────────────────────────────
router.patch("/:id/read", async (req, res) => {
  try {
    await req.dbclient
      .db(DB_NAME)
      .collection(COLLECTION)
      .updateOne(
        { _id: new ObjectId(req.params.id) },
        { $set: { read: true } },
      );

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Failed to mark as read" });
  }
});

// ─── Mark all as read ──────────────────────────────────────────────────────────
router.patch("/mark-all-read", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "email is required" });

    await req.dbclient
      .db(DB_NAME)
      .collection(COLLECTION)
      .updateMany({ email, read: false }, { $set: { read: true } });

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Failed to mark all as read" });
  }
});

// ─── Delete a notification ─────────────────────────────────────────────────────
router.delete("/:id", async (req, res) => {
  try {
    await req.dbclient
      .db(DB_NAME)
      .collection(COLLECTION)
      .deleteOne({ _id: new ObjectId(req.params.id) });

    res.json({ success: true });
  } catch (error) {
    console.error("Delete notification error:", error);
    res.status(500).json({ error: "Failed to delete notification" });
  }
});

// ─── Broadcast Coupon ────────────────────────────────────────────────────────
router.post("/broadcast-coupon", (req, res) => {
  const { code, discount } = req.body;
  const notification = {
    type: "coupon",
    title: "New Coupon Available!",
    message: `Use code ${code || "SAVE10"} for ${discount || "10%"} off!`,
    read: false,
    createdAt: new Date(),
  };

  // Note: We are emitting to all connected clients
  if (req.io) req.io.emit("notification", notification);

  res.json({ success: true, message: "Coupon broadcasted" });
});

// Export router
module.exports = router;
