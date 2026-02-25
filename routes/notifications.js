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
    console.error("Notif Create Error:", error);
    res.status(500).json({ error: "Failed to create notification" });
  }
});
// ─── Test Notification Endpoint ────────────────────────────────────────────────
router.post("/test-emit", async (req, res) => {
  const { email } = req.body;
  if (!email || !req.io)
    return res.status(400).json({ error: "Missing email or socket.io" });

  const testNotif = {
    _id: new ObjectId(),
    type: "test",
    title: "Test Notification",
    message: "This is a test notification from server.",
    createdAt: new Date(),
    read: false,
  };

  console.log(`Emitting test notification to room: ${email.toLowerCase()}`);
  req.io.to(email.toLowerCase()).emit("notification", testNotif);

  res.json({ success: true, emittedTo: email.toLowerCase() });
});
// ─── Get notifications for a user ──────────────────────────────────────────────
router.get("/", async (req, res) => {
  try {
    const { email } = req.query;
    if (!email) return res.status(400).json({ error: "email is required" });

    // Ensure we fetch case-insensitively or enforce lowercase
    const notifications = await req.dbclient
      .db(DB_NAME)
      .collection(COLLECTION)
      .find({ email: { $regex: new RegExp(`^${email}$`, "i") } }) // Case-insensitive match
      .sort({ createdAt: -1 })
      .limit(50)
      .toArray();

    res.json(notifications);
  } catch (error) {
    console.error("Notif Fetch Error:", error);
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

// ─── Mark ALL as read ──────────────────────────────────────────────────────────
router.patch("/mark-all-read", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "email is required" });

    // Mark all unread notifications for this email as read
    // Case-insensitive email match just to be safe
    const result = await req.dbclient
      .db(DB_NAME)
      .collection(COLLECTION)
      .updateMany(
        { email: { $regex: new RegExp(`^${email}$`, "i") }, read: false },
        { $set: { read: true } },
      );

    res.json({ success: true, modifiedCount: result.modifiedCount });
  } catch (error) {
    console.error("Error marking all as read:", error);
    res.status(500).json({ error: "Failed to mark all as read" });
  }
});

// ─── Mark one notification as read ─────────────────────────────────────────────
router.patch("/:id/read", async (req, res) => {
  try {
    const { id } = req.params;
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid ID format" });
    }

    const result = await req.dbclient
      .db(DB_NAME)
      .collection(COLLECTION)
      .updateOne({ _id: new ObjectId(id) }, { $set: { read: true } });

    if (result.matchedCount === 0) {
      return res.status(404).json({ error: "Notification not found" });
    }

    res.json({ success: true });
  } catch (error) {
    console.error("Error marking as read:", error);
    res.status(500).json({ error: "Failed to mark as read" });
  }
});

// ─── Delete a notification ─────────────────────────────────────────────────────
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid ID format" });
    }

    const result = await req.dbclient
      .db(DB_NAME)
      .collection(COLLECTION)
      .deleteOne({ _id: new ObjectId(id) });

    if (result.deletedCount === 0) {
      return res.status(404).json({ error: "Notification not found" });
    }

    res.json({ success: true });
  } catch (error) {
    console.error("Error deleting notification:", error);
    res.status(500).json({ error: "Failed to delete notification" });
  }
});

module.exports = router;
