const express = require("express");
const { ObjectId } = require("mongodb");
const router = express.Router();

// Add product to wishlist
router.post("/", async (req, res) => {
    try {
        const db = req.dbclient.db("UnityShopDB");
        const wishlistCollection = db.collection("wishlist");

        const { userId, productId } = req.body;

        if (!userId || !productId) {
            return res.status(400).json({ message: "userId and productId are required" });
        }

        // Check if item already exists in wishlist
        const existingItem = await wishlistCollection.findOne({
            userId,
            productId,
        });

        if (existingItem) {
            return res.status(400).json({ message: "Product is already in the wishlist" });
        }

        const newWishlistItem = {
            userId,
            productId,
            createdAt: new Date(),
        };

        const result = await wishlistCollection.insertOne(newWishlistItem);

        res.status(201).json({
            message: "Product added to wishlist",
            wishlistItemId: result.insertedId,
        });
    } catch (error) {
        res.status(500).json({ message: "Server error", error: error.message });
    }
});

// Get all wishlist items for a user
router.get("/:userId", async (req, res) => {
    try {
        const { userId } = req.params;
        const db = req.dbclient.db("UnityShopDB");

        // Fetch wishlist items
        const wishlistItems = await db
            .collection("wishlist")
            .find({ userId })
            .sort({ createdAt: -1 })
            .toArray();

        // Optionally, populate product details
        const productIds = wishlistItems.map((item) => {
            try {
                return new ObjectId(item.productId);
            } catch (e) {
                return item.productId;
            }
        });

        const products = await db
            .collection("products")
            .find({ _id: { $in: productIds } })
            .toArray();

        // Merge wishlists with products
        const populatedWishlist = wishlistItems.map((item) => {
            const product = products.find(p => p._id.toString() === item.productId || p._id === item.productId);
            return {
                ...item,
                product: product || null
            };
        });

        res.json(populatedWishlist);
    } catch (error) {
        res.status(500).json({ message: "Server error", error: error.message });
    }
});

// Remove product from wishlist
router.delete("/:id", async (req, res) => {
    try {
        const id = req.params.id;
        const db = req.dbclient.db("UnityShopDB");

        let objectId;
        try {
            objectId = new ObjectId(id);
        } catch (e) {
            return res.status(400).json({ message: "Invalid wishlist item ID format" });
        }

        const result = await db.collection("wishlist").deleteOne({ _id: objectId });

        if (result.deletedCount === 0) {
            return res.status(404).json({ message: "Wishlist item not found" });
        }

        res.json({ message: "Product removed from wishlist" });
    } catch (error) {
        res.status(500).json({ message: "Server error", error: error.message });
    }
});

// Remove by productId and userId (convenience un-toggle endpoint)
router.delete("/remove/:userId/:productId", async (req, res) => {
    try {
        const { userId, productId } = req.params;
        const db = req.dbclient.db("UnityShopDB");

        const result = await db.collection("wishlist").deleteOne({ userId, productId });

        if (result.deletedCount === 0) {
            return res.status(404).json({ message: "Product not found in your wishlist" });
        }

        res.json({ message: "Product removed from wishlist" });
    } catch (error) {
        res.status(500).json({ message: "Server error", error: error.message });
    }
});

// Clear entire wishlist
router.delete("/clear/:userId", async (req, res) => {
    try {
        const { userId } = req.params;
        const db = req.dbclient.db("UnityShopDB");

        await db.collection("wishlist").deleteMany({ userId });

        res.json({ message: "Wishlist cleared successfully" });
    } catch (error) {
        res.status(500).json({ message: "Server error", error: error.message });
    }
});

module.exports = router;
