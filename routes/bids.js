const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');
// const { authenticateToken } = require('../middleware/authenticateToken');
// const { getUserFromToken } = require('../utils/authUtils');
// const { getProductById } = require('./product');
const DB_NAME = "UnityShopDB";
const COLLECTION_NAME = "products";

// Place a bid on a product
router.patch("/bid/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const { newBid, bidderName, bidderEmail } = req.body;

    const collection = req.dbclient.db(DB_NAME).collection(COLLECTION_NAME);

    // Find the product by ID
    const product = await collection.findOne({ _id: new ObjectId(id) });

    if (!product) {
      return res.status(404).send({ error: "Product not found" });
    }

    // ২. Cheeck in deadline has not passed
    const now = new Date();
    if (product.endAt && now > new Date(product.endAt)) {
      return res.status(400).send({ error: "Auction has already ended!" });
    }

    // Cheeck the bid is higher than current highest bid
    const currentMax = Number(product.currentHighestBId || 0);
    if (Number(newBid) <= currentMax) {
      return res.status(400).send({ 
        error: `Bid must be higher than ${currentMax}` 
      });
    }

    // Update the product with new highest bid and bidder info
    const result = await collection.updateOne(
      { _id: new ObjectId(id) },
      {
        $set: {
          currentHighestBId: Number(newBid),
          highestBidderName: bidderName,
          highestBidderEmail: bidderEmail,
          lastBidAt: new Date(),
        },
        //optinal history of bids
        $push: {
          bidHistory: {
            name: bidderName,
            email: bidderEmail,
            amount: Number(newBid),
            time: new Date()
          }
        }
      }
    );

    res.send({ message: "Bid placed successfully", result });
  } catch (error) {
    console.error("Bidding error:", error);
    res.status(500).send({ error: "Failed to place bid" });
  }
});
module.exports = router;