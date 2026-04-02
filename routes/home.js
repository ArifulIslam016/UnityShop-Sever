const express = require("express");
const router = express.Router();

const DB_NAME = "UnityShopDB";

router.get("/h", (req, res) => {
  res.send("This is the h page.");
});

// Get testimonials / customer reviews
router.get("/testimonials", async (req, res) => {
  try {
    const testimonials = await req.dbclient
      .db(DB_NAME)
      .collection("testimonials")
      .find({})
      .sort({ createdAt: -1 })
      .limit(10)
      .toArray();

    res.send(testimonials);
  } catch (error) {
    res.status(500).send({ error: "Failed to fetch testimonials" });
  }
});

// Seed default testimonials (call once to populate)
router.post("/testimonials/seed", async (req, res) => {
  try {
    const collection = req.dbclient.db(DB_NAME).collection("testimonials");
    const count = await collection.countDocuments();

    if (count > 0) {
      return res.send({ message: "Testimonials already seeded", count });
    }

    const defaultTestimonials = [
      {
        name: "Sarah Johnson",
        role: "Regular Customer",
        avatar: "S",
        rating: 5,
        text: "UnityShop has completely changed how I shop online. The quality of products is outstanding and delivery is always on time!",
        createdAt: new Date(),
      },
      {
        name: "Michael Chen",
        role: "Business Owner",
        avatar: "M",
        rating: 5,
        text: "As a small business owner, I rely on UnityShop for bulk orders. Their trade assurance gives me peace of mind every time.",
        createdAt: new Date(),
      },
      {
        name: "Emily Rodriguez",
        role: "Fashion Enthusiast",
        avatar: "E",
        rating: 4,
        text: "The fashion collection is incredible. I always find trending styles at great prices. Customer support is also very responsive.",
        createdAt: new Date(),
      },
      {
        name: "David Kim",
        role: "Tech Reviewer",
        avatar: "D",
        rating: 5,
        text: "Best electronics deals I've found anywhere. The product descriptions are accurate and the return policy is hassle-free.",
        createdAt: new Date(),
      },
      {
        name: "Aisha Patel",
        role: "Interior Designer",
        avatar: "A",
        rating: 5,
        text: "I source most of my home decor from UnityShop. Great variety, competitive prices, and the quality never disappoints.",
        createdAt: new Date(),
      },
      {
        name: "James Wilson",
        role: "Verified Buyer",
        avatar: "J",
        rating: 4,
        text: "Smooth shopping experience from browsing to delivery. The app is easy to use and the deals section is a goldmine!",
        createdAt: new Date(),
      },
    ];

    const result = await collection.insertMany(defaultTestimonials);
    res
      .status(201)
      .send({ message: "Testimonials seeded", count: result.insertedCount });
  } catch (error) {
    res.status(500).send({ error: "Failed to seed testimonials" });
  }
});

// Get promotional banners
router.get("/banners", async (req, res) => {
  try {
    const banners = await req.dbclient
      .db(DB_NAME)
      .collection("banners")
      .find({ active: true })
      .sort({ order: 1 })
      .toArray();

    res.send(banners);
  } catch (error) {
    res.status(500).send({ error: "Failed to fetch banners" });
  }
});

// Seed default banners (call once to populate)
router.post("/banners/seed", async (req, res) => {
  try {
    const collection = req.dbclient.db(DB_NAME).collection("banners");
    const count = await collection.countDocuments();

    if (count > 0) {
      return res.send({ message: "Banners already seeded", count });
    }

    const defaultBanners = [
      {
        title: "Winter Collection",
        subtitle: "Up to 40% off on winter essentials",
        cta: "Shop Now",
        link: "/products?category=fashion",
        bgColor: "bg-gray-100",
        order: 1,
        active: true,
        createdAt: new Date(),
      },
      {
        title: "Electronics Sale",
        subtitle: "Latest gadgets at unbeatable prices",
        cta: "Explore",
        link: "/products?category=electronics",
        bgColor: "bg-gray-50",
        order: 2,
        active: true,
        createdAt: new Date(),
      },
      {
        title: "Free Shipping",
        subtitle: "On all orders above $50 this week",
        cta: "Learn More",
        link: "/products",
        bgColor: "bg-gray-100",
        order: 3,
        active: true,
        createdAt: new Date(),
      },
    ];

    const result = await collection.insertMany(defaultBanners);
    res
      .status(201)
      .send({ message: "Banners seeded", count: result.insertedCount });
  } catch (error) {
    res.status(500).send({ error: "Failed to seed banners" });
  }
});

module.exports = router;
