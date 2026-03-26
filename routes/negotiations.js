const express = require("express");
const { ObjectId } = require("mongodb");
const router = express.Router();
const jwt = require("jsonwebtoken");

const DB_NAME = "UnityShopDB";
const COLLECTION_NAME = "negotiations";
const JWT_SECRET = process.env.JWT_SECRET || "unityshop_secret_key_2026";

// Auth middleware helper
const verifyToken = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const token = authHeader.split(" ")[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ error: "Invalid token" });
  }
};

// Create a new negotiation
router.post("/", verifyToken, async (req, res) => {
  try {
    const { productId, productPrice, productName, userMessage, sellerId, offerPrice, aiResponse, suggestion } = req.body;
    
    let finalSellerId = null;

    // Check if sellerId passed from frontend is actually an email string
    if (typeof sellerId === 'string' && sellerId.includes('@')) {
         const sellerDoc = await req.dbclient.db(DB_NAME).collection("users").findOne({ email: sellerId });
         if (sellerDoc) {
             finalSellerId = sellerDoc._id; // Store exactly the seller's id
         } else {
             return res.status(400).json({ error: "Seller out of bounds" });
         }
    } else {
         finalSellerId = new ObjectId(sellerId);
    }

    const newNegotiation = {
      product: new ObjectId(productId),
      buyer: new ObjectId(req.user.userId),
      seller: finalSellerId,
      offerPrice: parseFloat(offerPrice),
      originalPrice: parseFloat(productPrice),
      status: "pending",
      messages: [
        {
          sender: new ObjectId(req.user.userId),
          message: userMessage,
          timestamp: new Date()
        }
      ],
      createdAt: new Date(),
      updatedAt: new Date(),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    };

    const result = await req.dbclient
      .db(DB_NAME)
      .collection(COLLECTION_NAME)
      .insertOne(newNegotiation);

    if (req.io) {
      req.io.to(typeof sellerId === 'string' && sellerId.includes('@') ? sellerId.toLowerCase() : finalSellerId.toString()).emit('new_negotiation', {
        message: `New negotiation offer for ${productName} from a buyer.`,
        negotiationId: result.insertedId
      });
    }

    res.status(201).json({ success: true, negotiationId: result.insertedId, aiResponse, suggestion });
  } catch (error) {
    console.error("Negotiation creation error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// Get seller's negotiations
router.get("/seller", verifyToken, async (req, res) => {
  try {
    // req.user.userId holds the _id of the current logged-in seller based on the JWT
    const sellerId = req.user.userId; 

    const negotiations = await req.dbclient
      .db(DB_NAME)
      .collection(COLLECTION_NAME)
      .aggregate([
        { $match: { seller: new ObjectId(sellerId) } },
        {
          $lookup: {
            from: "products",
            localField: "product",
            foreignField: "_id",
            as: "productDetails"
          }
        },
        {
          $lookup: {
            from: "users",
            localField: "buyer",
            foreignField: "_id",
            as: "buyerDetails"
          }
        },
        { $unwind: "$productDetails" },
        { $unwind: "$buyerDetails" },
        { $sort: { createdAt: -1 } }
      ]).toArray();

    // Clean up sensitive fields
    negotiations.forEach(n => {
      delete n.buyerDetails.password;
    });

    res.json({ success: true, negotiations });
  } catch (error) {
    console.error("Fetch seller negotiations error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// Update negotiation status
router.patch("/:id", verifyToken, async (req, res) => {
  try {
    const { status, message } = req.body;
    const negotiationId = req.params.id;

    const updateDoc = {
      $set: { status, updatedAt: new Date() }
    };

    if (message) {
      updateDoc.$push = {
        messages: {
           sender: new ObjectId(req.user.userId),
           message: message,
           timestamp: new Date()
        }
      };
    }

    const db = req.dbclient.db(DB_NAME);
    const result = await db.collection(COLLECTION_NAME).findOneAndUpdate(
        { _id: new ObjectId(negotiationId), seller: new ObjectId(req.user.userId) },
        updateDoc,
        { returnDocument: 'after' }
    );

    if (!result) return res.status(404).json({ error: "Negotiation not found" });

    // Ensure we trigger notification to the buyer if the io socket exists
    if (req.io) {
      req.io.to(result.buyer.toString()).emit('negotiation_update', {
        message: `Your offer status was updated to ${status}.`,
        negotiationId,
        status
      });
    }

    res.json({ success: true, negotiation: result });
  } catch (error) {
    res.status(500).json({ error: "Internal Server Error" });
  }
});

module.exports = router;
