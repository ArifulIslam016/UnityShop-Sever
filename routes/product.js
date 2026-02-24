const express = require("express");
const { ObjectId } = require("mongodb");
const router = express.Router();
// Get all products

const DB_NAME = "UnityShopDB";
const COLLECTION_NAME = "products";

// Get all categories with product counts
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
// Supports: ?sort=recommended|latest|top-rated&limit=20
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
      // "recommended" – mix of rating + reviews (most popular)
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

// Get flash deal products (products with significant discounts)
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

    // Add discount percentage to each product
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

    // Build match query
    const matchQuery = {};

    // Fuzzy text search — split query into words and match ANY word
    // across name, description, brand, category, tags, badge
    if (q && q.trim()) {
      const words = q.trim().split(/\s+/).filter(Boolean);
      if (words.length === 1) {
        // Single word — match anywhere
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
        // Multiple words — each word must match in at least one field (AND of ORs)
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

    // Category filter (case-insensitive)
    if (category && category.trim()) {
      matchQuery.category = { $regex: `^${category.trim()}$`, $options: "i" };
    }

    // Price filters
    if (priceMin || priceMax) {
      matchQuery.price = {};
      if (priceMin) matchQuery.price.$gte = parseFloat(priceMin);
      if (priceMax) matchQuery.price.$lte = parseFloat(priceMax);
      if (Object.keys(matchQuery.price).length === 0) delete matchQuery.price;
    }

    // Rating filter
    if (ratingNum > 0) {
      matchQuery.rating = { $gte: ratingNum };
    }

    // Sort options
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
        // recommended
        sortOption = { rating: -1, reviews: -1, createdAt: -1 };
    }

    const collection = req.dbclient.db(DB_NAME).collection(COLLECTION_NAME);

    // Get total count and paginated results in parallel
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

// Get all products with optional category and seller email filtering
router.get("/", async (req, res) => {
  try {
    const { category, sellerEmail } = req.query;
    let query = {};

    if (category) {
      query.category = category;
    }

    if (sellerEmail) {
      query.sellerEmail = sellerEmail;
    }

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

// Get a single product by ID
router.get("/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const product = await req.dbclient
      .db(DB_NAME)
      .collection(COLLECTION_NAME)
      .findOne({ _id: new ObjectId(id) });

    if (!product) {
      return res.status(404).send({ error: "Product not found" });
    }
    res.send(product);
  } catch (error) {
    res.status(500).send({ error: "Invalid ID format" });
  }
});

// Create a new product
router.post("/", async (req, res) => {
  try {
    const productData = req.body;

    // Add default values and timestamps  and here shoud come Seller Name and email form frontend
    /**
         *  Must have to add seller name and email in product data from frontend for future use in payment and order management
         * as like as  
         * sellerName: sellerName, 
           sellerEmail: sellerEmail,
           This is the format of product data that should come from frontend for creating a new product in database
           {
    id: 1,
    category: "living",
    name: "Bouclé Accent Chair",
    price: 320,
    originalPrice: 420,
    badge: "Sale",
    description: "Cloud-soft textured fabric",
    image:
      "https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=600&q=80",
    rating: 4.8,
    reviews: 124,
  },

        */
    const newProduct = {
      ...productData,
      price: Number(productData.price),
      originalPrice: Number(productData.originalPrice),
      rating: Number(productData.rating || 0),
      reviews: Number(productData.reviews || 0),
      stock: Number(productData.stock || 0),
      createdAt: new Date(),
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
    const updates = { $set: req.body };

    const result = await req.dbclient
      .db(DB_NAME)
      .collection(COLLECTION_NAME)
      .updateOne({ _id: new ObjectId(id) }, updates);

    res.send(result);
  } catch (error) {
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
