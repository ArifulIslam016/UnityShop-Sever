const express = require("express");
const { ObjectId } = require("mongodb");
const router = express.Router();
const multer = require("multer");
const cloudinary = require("../utils/cloudinary");

const DB_NAME = "UnityShopDB";
const REVIEWS_COLLECTION = "reviews";
const PRODUCTS_COLLECTION = "products";

// Multer — memory storage, max 2 MB per file, max 5 files
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 5 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("Only image files are allowed"), false);
  },
});

// Helper: upload buffer array to Cloudinary
async function uploadImages(files) {
  const urls = [];
  for (const file of files) {
    const b64 = Buffer.from(file.buffer).toString("base64");
    const dataURI = `data:${file.mimetype};base64,${b64}`;
    const result = await cloudinary.uploader.upload(dataURI, {
      folder: "unity-shop/reviews",
      transformation: [
        { width: 1200, height: 1200, crop: "limit", quality: "auto" },
      ],
    });
    urls.push(result.secure_url);
  }
  return urls;
}

// Helper: delete Cloudinary images by URL
async function deleteCloudinaryImages(imageUrls) {
  for (const url of imageUrls) {
    try {
      // Extract public_id from URL: .../unity-shop/reviews/xxxxx.jpg
      const parts = url.split("/");
      const folder1 = parts[parts.length - 3]; // unity-shop
      const folder2 = parts[parts.length - 2]; // reviews
      const fileWithExt = parts[parts.length - 1];
      const publicId = `${folder1}/${folder2}/${fileWithExt.split(".")[0]}`;
      await cloudinary.uploader.destroy(publicId);
    } catch {}
  }
}

// ─── Helper: recalculate & update product averageRating + totalReviews ──
async function recalcProductRating(dbclient, productId) {
  const pipeline = [
    { $match: { productId: new ObjectId(productId) } },
    {
      $group: {
        _id: null,
        averageRating: { $avg: "$rating" },
        totalReviews: { $sum: 1 },
      },
    },
  ];

  const [stats] = await dbclient
    .db(DB_NAME)
    .collection(REVIEWS_COLLECTION)
    .aggregate(pipeline)
    .toArray();

  const avgRating = stats ? Math.round(stats.averageRating * 10) / 10 : 0;
  const totalReviews = stats ? stats.totalReviews : 0;

  await dbclient
    .db(DB_NAME)
    .collection(PRODUCTS_COLLECTION)
    .updateOne(
      { _id: new ObjectId(productId) },
      {
        $set: {
          rating: avgRating,
          reviews: totalReviews,
        },
      },
    );

  return { averageRating: avgRating, totalReviews };
}

// ─── Ensure indexes exist (called once on first request) ────────────
let indexesCreated = false;
async function ensureIndexes(dbclient) {
  if (indexesCreated) return;
  const col = dbclient.db(DB_NAME).collection(REVIEWS_COLLECTION);
  await col.createIndex({ productId: 1, createdAt: -1 });
  await col.createIndex({ productId: 1, userId: 1 }, { unique: true });
  indexesCreated = true;
}

// ═════════════════════════════════════════════════════════════════════
// POST /reviews — Create a review (one per user per product)
//   Accepts multipart form: fields + up to 5 image files
// ═════════════════════════════════════════════════════════════════════
router.post("/", upload.array("images", 5), async (req, res) => {
  try {
    await ensureIndexes(req.dbclient);

    const {
      productId,
      userId,
      userName,
      userEmail,
      userImage,
      rating,
      comment,
    } = req.body;

    // Validation
    if (!productId || !userId || !rating) {
      return res
        .status(400)
        .json({ error: "productId, userId, and rating are required" });
    }
    if (rating < 1 || rating > 5) {
      return res.status(400).json({ error: "Rating must be between 1 and 5" });
    }

    // Check product exists
    const product = await req.dbclient
      .db(DB_NAME)
      .collection(PRODUCTS_COLLECTION)
      .findOne({ _id: new ObjectId(productId) }, { projection: { _id: 1 } });

    if (!product) {
      return res.status(404).json({ error: "Product not found" });
    }

    // Upload images to Cloudinary (if any)
    let imageUrls = [];
    if (req.files && req.files.length > 0) {
      imageUrls = await uploadImages(req.files.slice(0, 5));
    }

    // One review per user per product — try insert, catch duplicate
    const reviewDoc = {
      productId: new ObjectId(productId),
      userId,
      userName: userName || "Anonymous",
      userEmail: userEmail || "",
      userImage: userImage || "",
      rating: Number(rating),
      comment: comment || "",
      images: imageUrls,
      createdAt: new Date(),
    };

    try {
      const result = await req.dbclient
        .db(DB_NAME)
        .collection(REVIEWS_COLLECTION)
        .insertOne(reviewDoc);

      // Recalculate product rating
      const stats = await recalcProductRating(req.dbclient, productId);

      res.status(201).json({
        ...reviewDoc,
        _id: result.insertedId,
        productStats: stats,
      });
    } catch (err) {
      if (err.code === 11000) {
        // Clean up uploaded images on duplicate
        if (imageUrls.length) deleteCloudinaryImages(imageUrls);
        return res
          .status(409)
          .json({ error: "You have already reviewed this product" });
      }
      throw err;
    }
  } catch (error) {
    console.error("POST /reviews error:", error);
    res.status(500).json({ error: "Failed to create review" });
  }
});

// ═════════════════════════════════════════════════════════════════════
// GET /reviews/:productId — Paginated reviews for a product
// ═════════════════════════════════════════════════════════════════════
router.get("/:productId", async (req, res) => {
  try {
    await ensureIndexes(req.dbclient);

    const { productId } = req.params;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(20, Math.max(1, parseInt(req.query.limit) || 5));
    const skip = (page - 1) * limit;

    const filter = { productId: new ObjectId(productId) };

    const [reviews, totalCount] = await Promise.all([
      req.dbclient
        .db(DB_NAME)
        .collection(REVIEWS_COLLECTION)
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .toArray(),
      req.dbclient
        .db(DB_NAME)
        .collection(REVIEWS_COLLECTION)
        .countDocuments(filter),
    ]);

    res.json({
      reviews,
      pagination: {
        page,
        limit,
        totalCount,
        totalPages: Math.ceil(totalCount / limit),
        hasMore: page * limit < totalCount,
      },
    });
  } catch (error) {
    console.error("GET /reviews/:productId error:", error);
    res.status(500).json({ error: "Failed to fetch reviews" });
  }
});

// ═════════════════════════════════════════════════════════════════════
// PUT /reviews/:id — Update own review (with optional new images)
// ═════════════════════════════════════════════════════════════════════
router.put("/:id", upload.array("images", 5), async (req, res) => {
  try {
    const { id } = req.params;
    const { userId, rating, comment, keepImages } = req.body;

    if (!userId) {
      return res.status(400).json({ error: "userId is required" });
    }

    // Fetch existing review to manage old images
    const existing = await req.dbclient
      .db(DB_NAME)
      .collection(REVIEWS_COLLECTION)
      .findOne({ _id: new ObjectId(id), userId });

    if (!existing) {
      return res
        .status(404)
        .json({ error: "Review not found or unauthorized" });
    }

    const updateFields = {};
    if (rating !== undefined) {
      if (rating < 1 || rating > 5) {
        return res
          .status(400)
          .json({ error: "Rating must be between 1 and 5" });
      }
      updateFields.rating = Number(rating);
    }
    if (comment !== undefined) {
      updateFields.comment = comment;
    }

    // Handle images:
    // keepImages = JSON array of old URLs to keep
    // req.files  = new files to upload
    let keptUrls = [];
    try {
      keptUrls = JSON.parse(keepImages || "[]");
    } catch {
      keptUrls = [];
    }
    // Ensure kept URLs are actually from the existing review
    keptUrls = keptUrls.filter((u) => (existing.images || []).includes(u));

    // Upload new files
    let newUrls = [];
    if (req.files && req.files.length > 0) {
      const maxNew = 5 - keptUrls.length;
      newUrls = await uploadImages(req.files.slice(0, Math.max(0, maxNew)));
    }

    const finalImages = [...keptUrls, ...newUrls].slice(0, 5);
    updateFields.images = finalImages;

    // Delete removed old images from Cloudinary
    const removedUrls = (existing.images || []).filter(
      (u) => !keptUrls.includes(u),
    );
    if (removedUrls.length) deleteCloudinaryImages(removedUrls);

    if (Object.keys(updateFields).length === 0) {
      return res.status(400).json({ error: "Nothing to update" });
    }

    updateFields.updatedAt = new Date();

    const result = await req.dbclient
      .db(DB_NAME)
      .collection(REVIEWS_COLLECTION)
      .findOneAndUpdate(
        { _id: new ObjectId(id), userId },
        { $set: updateFields },
        { returnDocument: "after" },
      );

    // Recalculate product rating
    const stats = await recalcProductRating(
      req.dbclient,
      result.productId.toString(),
    );

    res.json({ ...result, productStats: stats });
  } catch (error) {
    console.error("PUT /reviews/:id error:", error);
    res.status(500).json({ error: "Failed to update review" });
  }
});

// ═════════════════════════════════════════════════════════════════════
// DELETE /reviews/:id — Delete own review
// ═════════════════════════════════════════════════════════════════════
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({ error: "userId is required" });
    }

    const review = await req.dbclient
      .db(DB_NAME)
      .collection(REVIEWS_COLLECTION)
      .findOneAndDelete({ _id: new ObjectId(id), userId });

    if (!review) {
      return res
        .status(404)
        .json({ error: "Review not found or unauthorized" });
    }

    // Delete associated images from Cloudinary
    if (review.images && review.images.length > 0) {
      deleteCloudinaryImages(review.images);
    }

    // Recalculate product rating
    const stats = await recalcProductRating(
      req.dbclient,
      review.productId.toString(),
    );

    res.json({ message: "Review deleted", productStats: stats });
  } catch (error) {
    console.error("DELETE /reviews/:id error:", error);
    res.status(500).json({ error: "Failed to delete review" });
  }
});

// ═════════════════════════════════════════════════════════════════════
// POST /reviews/:id/like — Toggle like on a review
// ═════════════════════════════════════════════════════════════════════
router.post("/:id/like", async (req, res) => {
  try {
    const { id } = req.params;
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: "userId is required" });

    const col = req.dbclient.db(DB_NAME).collection(REVIEWS_COLLECTION);
    const review = await col.findOne({ _id: new ObjectId(id) });
    if (!review) return res.status(404).json({ error: "Review not found" });

    const likes = review.likes || [];
    const alreadyLiked = likes.includes(userId);
    const update = alreadyLiked
      ? { $pull: { likes: userId } }
      : { $addToSet: { likes: userId } };

    await col.updateOne({ _id: new ObjectId(id) }, update);
    const updated = await col.findOne({ _id: new ObjectId(id) });

    res.json({
      liked: !alreadyLiked,
      likeCount: (updated.likes || []).length,
    });
  } catch (error) {
    console.error("POST /reviews/:id/like error:", error);
    res.status(500).json({ error: "Failed to toggle like" });
  }
});

// ═════════════════════════════════════════════════════════════════════
// POST /reviews/:id/reply — Add a reply to a review
// ═════════════════════════════════════════════════════════════════════
router.post("/:id/reply", async (req, res) => {
  try {
    const { id } = req.params;
    const { userId, userName, userImage, comment } = req.body;
    if (!userId || !comment)
      return res.status(400).json({ error: "userId and comment are required" });

    const col = req.dbclient.db(DB_NAME).collection(REVIEWS_COLLECTION);
    const review = await col.findOne({ _id: new ObjectId(id) });
    if (!review) return res.status(404).json({ error: "Review not found" });

    const reply = {
      _id: new ObjectId(),
      userId,
      userName: userName || "Anonymous",
      userImage: userImage || "",
      comment,
      createdAt: new Date(),
      likes: [],
    };

    await col.updateOne(
      { _id: new ObjectId(id) },
      { $push: { replies: reply } },
    );

    res.status(201).json(reply);
  } catch (error) {
    console.error("POST /reviews/:id/reply error:", error);
    res.status(500).json({ error: "Failed to add reply" });
  }
});

module.exports = router;
