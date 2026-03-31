const express = require("express");
const { ObjectId } = require("mongodb");
const router = express.Router();

const DB_NAME = "UnityShopDB";
const COLLECTION_NAME = "products";

// Get all categories with product count
router.get("/categories", async (req, res) => {
  try {
    const categories = await req.dbclient
      .db(DB_NAME)
      .collection(COLLECTION_NAME)
      .aggregate([
        { $group: { _id: "$category", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ])
      .toArray();

    const result = categories.map((c) => ({
      name: c._id,
      count: c.count,
    }));

    res.send(result);
  } catch (error) {
    res.status(500).send({ error: "Failed to fetch categories" });
  }
});

// Get recommended / featured products for homepage
router.get("/recommended", async (req, res) => {
  try {
    const { sort = "recommended", limit = "20" } = req.query;
    const limitNum = Math.min(parseInt(limit) || 20, 50);

    let sortOption = {};
    if (sort === "latest") {
      sortOption = { createdAt: -1 };
    } else if (sort === "top-rated") {
      sortOption = { rating: -1, reviews: -1 };
    } else {
      sortOption = { rating: -1, reviews: -1, createdAt: -1 };
    }

    const products = await req.dbclient
      .db(DB_NAME)
      .collection(COLLECTION_NAME)
      .find({})
      .sort(sortOption)
      .limit(limitNum)
      .toArray();

    res.send(products);
  } catch (error) {
    res.status(500).send({ error: "Failed to fetch recommended products" });
  }
});

// Get flash deal products
router.get("/flash-deals", async (req, res) => {
  try {
    const { limit = "10" } = req.query;
    const limitNum = Math.min(parseInt(limit) || 10, 20);

    const products = await req.dbclient
      .db(DB_NAME)
      .collection(COLLECTION_NAME)
      .find({
        originalPrice: { $exists: true, $gt: 0 },
        $expr: { $lt: ["$price", "$originalPrice"] },
      })
      .sort({ rating: -1 })
      .limit(limitNum)
      .toArray();

    const result = products.map((p) => ({
      ...p,
      discount: Math.round(
        ((p.originalPrice - p.price) / p.originalPrice) * 100,
      ),
    }));

    res.send(result);
  } catch (error) {
    res.status(500).send({ error: "Failed to fetch flash deals" });
  }
});

// Get new arrival products
router.get("/new-arrivals", async (req, res) => {
  try {
    const { limit = "10" } = req.query;
    const limitNum = Math.min(parseInt(limit) || 10, 20);

    const products = await req.dbclient
      .db(DB_NAME)
      .collection(COLLECTION_NAME)
      .find({})
      .sort({ createdAt: -1 })
      .limit(limitNum)
      .toArray();

    res.send(products);
  } catch (error) {
    res.status(500).send({ error: "Failed to fetch new arrivals" });
  }
});

// Get unique brands from products
router.get("/brands", async (req, res) => {
  try {
    const brands = await req.dbclient
      .db(DB_NAME)
      .collection(COLLECTION_NAME)
      .aggregate([
        { $match: { brand: { $exists: true, $ne: "" } } },
        {
          $group: {
            _id: "$brand",
            count: { $sum: 1 },
            image: { $first: "$image" },
          },
        },
        { $sort: { count: -1 } },
        { $limit: 12 },
      ])
      .toArray();

    const result = brands.map((b) => ({
      name: b._id,
      count: b.count,
      image: b.image,
    }));

    res.send(result);
  } catch (error) {
    res.status(500).send({ error: "Failed to fetch brands" });
  }
});

// Search products with query, category, sort, pagination, price & rating filters
router.get("/search", async (req, res) => {
  try {
    const {
      q = "",
      category = "",
      sort = "recommended",
      page = "1",
      limit = "24",
      priceMin = "",
      priceMax = "",
      rating = "0",
    } = req.query;

    const pageNum = Math.max(parseInt(page) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit) || 24, 1), 60);
    const skip = (pageNum - 1) * limitNum;
    const ratingNum = parseFloat(rating) || 0;

    const matchQuery = {};

    if (q && q.trim()) {
      const words = q.trim().split(/\s+/).filter(Boolean);
      if (words.length === 1) {
        const rx = words[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        matchQuery.$or = [
          { name: { $regex: rx, $options: "i" } },
          { description: { $regex: rx, $options: "i" } },
          { brand: { $regex: rx, $options: "i" } },
          { category: { $regex: rx, $options: "i" } },
          { tags: { $regex: rx, $options: "i" } },
          { badge: { $regex: rx, $options: "i" } },
        ];
      } else {
        matchQuery.$and = words.map((w) => {
          const rx = w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          return {
            $or: [
              { name: { $regex: rx, $options: "i" } },
              { description: { $regex: rx, $options: "i" } },
              { brand: { $regex: rx, $options: "i" } },
              { category: { $regex: rx, $options: "i" } },
              { tags: { $regex: rx, $options: "i" } },
              { badge: { $regex: rx, $options: "i" } },
            ],
          };
        });
      }
    }

    if (category && category.trim()) {
      matchQuery.category = { $regex: `^${category.trim()}$`, $options: "i" };
    }

    if (priceMin || priceMax) {
      matchQuery.price = {};
      if (priceMin) matchQuery.price.$gte = parseFloat(priceMin);
      if (priceMax) matchQuery.price.$lte = parseFloat(priceMax);
      if (Object.keys(matchQuery.price).length === 0) delete matchQuery.price;
    }

    if (ratingNum > 0) {
      matchQuery.rating = { $gte: ratingNum };
    }

    let sortOption = {};
    switch (sort) {
      case "price-asc":
        sortOption = { price: 1 };
        break;
      case "price-desc":
        sortOption = { price: -1 };
        break;
      case "newest":
        sortOption = { createdAt: -1 };
        break;
      case "rating":
        sortOption = { rating: -1, reviews: -1 };
        break;
      default:
        sortOption = { rating: -1, reviews: -1, createdAt: -1 };
    }

    const collection = req.dbclient.db(DB_NAME).collection(COLLECTION_NAME);

    const [totalCount, products] = await Promise.all([
      collection.countDocuments(matchQuery),
      collection
        .find(matchQuery)
        .sort(sortOption)
        .skip(skip)
        .limit(limitNum)
        .toArray(),
    ]);

    res.send({
      products,
      total: totalCount,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(totalCount / limitNum),
    });
  } catch (error) {
    console.error("Search error:", error);
    res.status(500).send({ error: "Failed to search products" });
  }
});

// ─── Increment persistent view count ────────────────────────────────────────
router.post("/:id/view", async (req, res) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid product ID" });
    }

    const result = await req.dbclient
      .db(DB_NAME)
      .collection(COLLECTION_NAME)
      .findOneAndUpdate(
        { _id: new ObjectId(id) },
        { $inc: { views: 1 } },
        { returnDocument: "after" },
      );

    if (!result) {
      return res.status(404).json({ error: "Product not found" });
    }

    res.json({ views: result.views ?? 1 });
  } catch (error) {
    console.error("View count error:", error);
    res.status(500).json({ error: "Failed to update view count" });
  }
});

// Get all products with optional category and seller email filtering
router.get("/", async (req, res) => {
  try {
    const { category, sellerEmail } = req.query;
    let query = {};

    if (category) query.category = category;
    if (sellerEmail) query.sellerEmail = sellerEmail;

    const products = await req.dbclient
      .db(DB_NAME)
      .collection(COLLECTION_NAME)
      .find(query)
      .sort({ createdAt: -1 })
      .toArray();

    res.send(products);
  } catch (error) {
    res.status(500).send({ error: "Failed to fetch products" });
  }
});

// Get single product by ID (with seller lookup)
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid product ID" });
    }

    const product = await req.dbclient
      .db(DB_NAME)
      .collection(COLLECTION_NAME)
      .findOne({ _id: new ObjectId(id) });

    if (!product) {
      return res.status(404).json({ error: "Product not found" });
    }

    // Look up the seller from the users collection using sellerEmail
    if (product.sellerEmail) {
      const user = await req.dbclient
        .db(DB_NAME)
        .collection("users")
        .findOne(
          { email: product.sellerEmail },
          { projection: { _id: 1, name: 1, email: 1 } },
        );

      if (user) {
        product.seller = {
          _id: user._id,
          name: user.name,
          email: user.email,
        };
      } else {
        product.seller = {
          _id: null,
          name: product.sellerName || "Unknown",
          email: product.sellerEmail,
        };
      }
    } else {
      product.seller = {
        _id: null,
        name: product.sellerName || "Unknown",
        email: "",
      };
    }

    res.json(product);
  } catch (error) {
    console.error("Error fetching product:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// Create a new product
router.post("/", async (req, res) => {
  try {
    const productData = req.body;

    const newProduct = {
      ...productData,
      price: Number(productData.price),
      originalPrice: Number(productData.originalPrice),
      rating: Number(productData.rating || 0),
      reviews: Number(productData.reviews || 0),
      stock: Number(productData.stock || 0),
      views: 0,
      createdAt: new Date(),
      endAt: productData.endAt,
      basePrice: Number(productData.basePrice || productData.price || 0),
      currentHighestBId: Number(
        productData.basePrice || productData.price || 0,
      ),
    };

    const result = await req.dbclient
      .db(DB_NAME)
      .collection(COLLECTION_NAME)
      .insertOne(newProduct);

    res.status(201).send(result);
  } catch (error) {
    res.status(500).send({ error: "Failed to create product" });
  }
});

// Update product details
router.patch("/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const db = req.dbclient.db(DB_NAME);
    const updates = { $set: req.body };

    const product = await db
      .collection(COLLECTION_NAME)
      .findOne({ _id: new ObjectId(id) });

    const result = await db
      .collection(COLLECTION_NAME)
      .updateOne({ _id: new ObjectId(id) }, updates);

    // Notification Logic: Product Approval / Rejection
    if (
      product &&
      req.body.status &&
      (req.body.status === "approved" || req.body.status === "rejected")
    ) {
      const isApproved = req.body.status === "approved";

      const notification = {
        email: product.sellerEmail,
        type: isApproved ? "product_approved" : "product_rejected",
        title: isApproved ? "Product Approved!" : "Product Rejected",
        message: isApproved
          ? `Your product "${product.name}" has been approved and is now live.`
          : `Your product "${product.name}" has been rejected. Please review and resubmit.`,
        meta: { productId: id, productName: product.name },
        read: false,
        createdAt: new Date(),
      };

      await db.collection("notifications").insertOne(notification);

      if (req.io) {
        req.io
          .to(product.sellerEmail.toLowerCase())
          .emit("notification", notification);
      }
    }

    res.send(result);
  } catch (error) {
    console.error(error);
    res.status(500).send({ error: "Failed to update product" });
  }
});

// Delete product
router.delete("/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const result = await req.dbclient
      .db(DB_NAME)
      .collection(COLLECTION_NAME)
      .deleteOne({ _id: new ObjectId(id) });

    res.send(result);
  } catch (error) {
    res.status(500).send({ error: "Failed to delete product" });
  }
});

module.exports = router;
