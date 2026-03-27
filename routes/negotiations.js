const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth");
const { ObjectId } = require("mongodb");

const DB_NAME = "UnityShopDB";
const NEGOTIATION_COLLECTION = "negotiations";
const NOTIFICATION_COLLECTION = "notifications";

const getStatusText = (status) => {
  if (status === "accepted") return "accepted";
  if (status === "rejected") return "declined";
  return status;
};

const buildStatusMessage = ({ status, offerPrice, productName }) => {
  const statusText = getStatusText(status);
  return `Seller ${statusText} your offer of $${offerPrice} for "${productName}".`;
};

// POST /api/negotiations – create a new negotiation
router.post("/", auth, async (req, res) => {
  try {
    const { productId, productPrice, userMessage, sellerId } = req.body;
    if (!productId || !productPrice || !sellerId) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // Extract offer amount
    const offerMatch = userMessage.match(/\$?(\d+(?:\.\d{2})?)/);
    const offerPrice = offerMatch ? parseFloat(offerMatch[1]) : null;
    if (!offerPrice) {
      return res.status(400).json({ error: "No price detected in message" });
    }

    // Create negotiation document
    const negotiation = {
      product: new ObjectId(productId),
      buyer: new ObjectId(req.user._id),
      seller: new ObjectId(sellerId),
      offerPrice,
      originalPrice: productPrice,
      messages: [
        {
          sender: new ObjectId(req.user._id),
          message: userMessage,
          timestamp: new Date(),
        },
      ],
      status: "pending",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const db = req.dbclient.db(DB_NAME);
    const result = await db
      .collection(NEGOTIATION_COLLECTION)
      .insertOne(negotiation);

    // Generate AI response (simple rules)
    const discount = ((productPrice - offerPrice) / productPrice) * 100;
    let aiResponse = "";
    let suggestion = "";
    if (discount <= 10) {
      aiResponse = `Great! Your offer of $${offerPrice} (${discount.toFixed(1)}% discount) has been sent to the seller. You'll be notified when they respond.`;
      suggestion =
        "This is a fair offer. Most sellers accept offers within 10% of the listing price.";
    } else if (discount <= 25) {
      aiResponse = `Your offer of $${offerPrice} (${discount.toFixed(1)}% discount) has been sent to the seller. This is an aggressive offer, so be prepared for negotiation.`;
      suggestion = `Consider starting with a slightly higher offer (around $${(productPrice * 0.85).toFixed(2)}) to increase your chances of acceptance.`;
    } else {
      const suggested = (productPrice * 0.85).toFixed(2);
      aiResponse = `Your offer of $${offerPrice} (${discount.toFixed(1)}% discount) is significantly below the listing price. Sellers rarely accept offers this low.`;
      suggestion = `I recommend offering at least $${suggested} to show you're serious about purchasing.`;
    }

    res.status(201).json({
      success: true,
      message: aiResponse,
      suggestion,
      offerPrice,
      offerSent: true,
      negotiationId: result.insertedId,
    });
  } catch (error) {
    console.error("🔥 POST /negotiations error:", error);
    res
      .status(500)
      .json({ error: "Internal server error", details: error.message });
  }
});

// GET /api/negotiations?status=pending&sellerId=xxx – fetch negotiations for seller
router.get("/", auth, async (req, res) => {
  try {
    const { status, sellerId } = req.query;
    if (!sellerId) {
      return res
        .status(400)
        .json({ error: "sellerId query parameter required" });
    }

    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    if (req.user._id !== sellerId && req.user.role !== "admin") {
      return res.status(403).json({ error: "Forbidden" });
    }

    const filter = { seller: new ObjectId(sellerId) };
    if (status) filter.status = status;

    const negotiations = await req.dbclient
      .db(DB_NAME)
      .collection(NEGOTIATION_COLLECTION)
      .find(filter)
      .sort({ createdAt: -1 })
      .toArray();

    // Populate product and buyer manually
    const productIds = negotiations.map((n) => n.product);
    const buyerIds = negotiations.map((n) => n.buyer);

    const products = await req.dbclient
      .db(DB_NAME)
      .collection("products")
      .find({ _id: { $in: productIds } })
      .toArray();

    const buyers = await req.dbclient
      .db(DB_NAME)
      .collection("users")
      .find({ _id: { $in: buyerIds } })
      .toArray();

    const productMap = Object.fromEntries(
      products.map((p) => [p._id.toString(), p]),
    );
    const buyerMap = Object.fromEntries(
      buyers.map((b) => [b._id.toString(), b]),
    );

    const enriched = negotiations.map((n) => ({
      ...n,
      product: productMap[n.product.toString()] || null,
      buyer: buyerMap[n.buyer.toString()] || null,
    }));

    res.json(enriched);
  } catch (error) {
    console.error("GET /negotiations error:", error);
    res
      .status(500)
      .json({ error: "Internal server error", details: error.message });
  }
});

// GET /api/negotiations/user-product?productId=xxx&buyerId=xxx – fetch a specific negotiation for a buyer
router.get("/user-product", auth, async (req, res) => {
  try {
    const { productId, buyerId } = req.query;
    if (!productId) {
      return res.status(400).json({ error: "productId is required" });
    }

    const effectiveBuyerId = buyerId || req.user?._id;
    if (!effectiveBuyerId) {
      return res.status(400).json({ error: "buyerId could not be resolved" });
    }

    if (
      req.user &&
      req.user.role !== "admin" &&
      req.user._id !== effectiveBuyerId
    ) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const db = req.dbclient.db(DB_NAME);
    const negotiation = await db.collection(NEGOTIATION_COLLECTION).findOne({
      product: new ObjectId(productId),
      buyer: new ObjectId(effectiveBuyerId),
    });
    res.json(negotiation);
  } catch (error) {
    console.error("GET /negotiations/user-product error:", error);
    res.status(500).json({ error: error.message });
  }
});

// PATCH /api/negotiations/:id – update status (accept/reject/counter)
router.patch("/:id", auth, async (req, res) => {
  try {
    const { status } = req.body;
    const { id } = req.params;

    if (!["accepted", "rejected", "countered"].includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }

    const db = req.dbclient.db(DB_NAME);
    const negotiation = await db
      .collection(NEGOTIATION_COLLECTION)
      .findOne({ _id: new ObjectId(id) });
    if (!negotiation) return res.status(404).json({ error: "Not found" });

    if (
      req.user._id !== negotiation.seller.toString() &&
      req.user.role !== "admin"
    ) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const product = await db
      .collection("products")
      .findOne({ _id: negotiation.product });
    const productName = product?.name || "the product";

    const sellerStatusMessage = buildStatusMessage({
      status,
      offerPrice: negotiation.offerPrice,
      productName,
    });

    // Update status
    const statusUpdateResult = await db
      .collection(NEGOTIATION_COLLECTION)
      .updateOne(
        { _id: new ObjectId(id) },
        {
          $set: { status, updatedAt: new Date() },
          $push: {
            messages: {
              sender: negotiation.seller,
              message: sellerStatusMessage,
              timestamp: new Date(),
              system: true,
            },
          },
        },
      );

    // Fetch buyer details
    const buyer = await db
      .collection("users")
      .findOne({ _id: negotiation.buyer });

    if (buyer) {
      // Create notification for buyer
      const notification = {
        email: buyer.email,
        type: status === "accepted" ? "offer_accepted" : "offer_rejected",
        title: status === "accepted" ? "Offer Accepted!" : "Offer Declined",
        message:
          status === "accepted"
            ? `Your offer of $${negotiation.offerPrice} for "${productName}" has been accepted by the seller.`
            : `Your offer of $${negotiation.offerPrice} for "${productName}" was declined by the seller.`,
        meta: {
          productId: negotiation.product,
          negotiationId: negotiation._id,
        },
        read: false,
        createdAt: new Date(),
      };
      const insertResult = await db
        .collection(NOTIFICATION_COLLECTION)
        .insertOne(notification);
      notification._id = insertResult.insertedId;

      // Emit real‑time notification via socket
      if (req.io) {
        const room = buyer.email.toLowerCase();
        req.io.to(room).emit("notification", notification);

        const statusUpdateMessage =
          status === "accepted"
            ? `Your offer of $${negotiation.offerPrice} was accepted! You can now purchase at this price.`
            : status === "rejected"
              ? `Your offer of $${negotiation.offerPrice} was declined.`
              : `Your offer status changed to ${status}.`;

        req.io.to(room).emit("negotiation_status_updated", {
          negotiationId: negotiation._id,
          productId: negotiation.product.toString(),
          status,
          offerPrice: negotiation.offerPrice,
          productName,
          message: statusUpdateMessage,
          updatedAt: new Date(),
        });
      }
    }

    res.json({
      success: true,
      negotiation: {
        ...negotiation,
        status,
        updatedAt: new Date(),
      },
    });
  } catch (error) {
    console.error("PATCH /negotiations/:id error:", error);
    res
      .status(500)
      .json({ error: "Internal server error", details: error.message });
  }
});

module.exports = router;
