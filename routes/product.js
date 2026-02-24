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
