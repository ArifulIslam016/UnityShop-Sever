// routes/ai.js
const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth");
const { ObjectId } = require("mongodb");
const multer = require("multer");
const Replicate = require("replicate");
const cloudinary = require("cloudinary").v2;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

const cache = new Map();
const CACHE_TTL = 60 * 60 * 1000; // 1 hour
const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";

// Helper: Search products using MongoDB
async function searchProducts(db, params) {
  const {
    category,
    minPrice,
    maxPrice,
    keywords,
    brand,
    ratingMin,
    limit = 5,
  } = params;
  const query = {};

  if (category) query.category = category;
  if (brand) query.brand = { $regex: brand, $options: "i" };
  if (ratingMin !== undefined && ratingMin !== null)
    query.rating = { $gte: ratingMin };

  if (minPrice !== undefined || maxPrice !== undefined) {
    query.price = {};
    if (minPrice !== undefined) query.price.$gte = minPrice;
    if (maxPrice !== undefined) query.price.$lte = maxPrice;
  }

  if (keywords && keywords.length) {
    const orConditions = [];
    const fields = ["name", "description", "tags", "brand"];
    for (const field of fields) {
      for (const term of keywords) {
        const regex = { $regex: term, $options: "i" };
        orConditions.push({ [field]: regex });
      }
    }
    query.$or = orConditions;
  }

  const products = await db
    .collection("products")
    .find(query)
    .sort({ rating: -1, reviews: -1 })
    .limit(limit)
    .toArray();
  return products;
}

// ========== Product description generator (unchanged) =========
router.post("/generate-description", auth, async (req, res) => {
  try {
    const { name, category, brand, price, imageUrl } = req.body;
    if (!name)
      return res.status(400).json({ error: "Product name is required" });

    const cacheKey = `${name}_${category || ""}_${brand || ""}`;
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return res.json({ success: true, description: cached.description });
    }

    const prompt = `
You are an expert e-commerce copywriter. Generate a compelling, SEO-friendly product description as clean HTML code only. Do not include any markdown, code fences, or surrounding text.

Product Name: ${name}
Category: ${category || "Not specified"}
Brand: ${brand || "Not specified"}

Requirements:
- Total length: 100-150 words.
- Use a friendly, persuasive tone. Avoid generic phrases. Highlight what makes this product special.
- Do NOT mention price or image.
- Format the description using only HTML tags: <p> for paragraphs, <strong> for section titles (e.g., "Key Features", "Benefits", "Why Choose This Product"), <ul> and <li> for bullet points. Use <br> sparingly for line breaks.
- Include relevant keywords naturally (product name, category, brand) for SEO.

Example output structure:
<strong>Key Features</strong>
<ul>
<li>Feature one</li>
<li>Feature two</li>
<li>Feature three</li>
</ul>
<strong>Benefits</strong>
<p>Benefit description...</p>
<strong>Why Choose This Product</strong>
<p>Unique selling point...</p>
<p>Closing persuasive paragraph.</p>

Now generate only the HTML code (no other text).
`;

    const response = await fetch(GROQ_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 500,
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error("Groq API error:", errorData);
      throw new Error(errorData.error?.message || "Groq API error");
    }

    const data = await response.json();
    const description = data.choices[0].message.content.trim();

    cache.set(cacheKey, { description, timestamp: Date.now() });
    res.json({ success: true, description });
  } catch (error) {
    console.error("Description generation error:", error);
    let errorMessage = "Failed to generate description";
    if (error.message.includes("rate limit")) {
      errorMessage = "AI service is busy (rate limit). Please try again later.";
    } else {
      errorMessage = error.message;
    }
    res.status(500).json({ error: errorMessage });
  }
});

router.get("/test", (req, res) => {
  res.json({ message: "AI route is working!" });
});

// ========== Enhanced Support Endpoint ==========
router.post("/support", auth, async (req, res) => {
  try {
    const { message, orderId, productId, userId } = req.body;
    if (!message) return res.status(400).json({ error: "Message is required" });

    const db = req.dbclient.db("UnityShopDB");

    // Step 1: Intent analysis
    const intentPrompt = `
You are an AI that helps customers find products. Analyze the user's message and output a JSON object with the following structure:
{
  "intent": "search" | "recommend" | "general" | "compare" | "question",
  "category": string or null,
  "minPrice": number or null,
  "maxPrice": number or null,
  "keywords": array of strings,
  "features": array of strings,
  "brand": string or null,
  "ratingMin": number or null,
  "specificProductId": string or null
}
Only output the JSON, no other text.

User message: "${message}"
`;

    const intentResponse = await fetch(GROQ_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "user", content: intentPrompt }],
        max_tokens: 250,
        temperature: 0,
      }),
    });

    if (!intentResponse.ok) throw new Error("Intent analysis failed");
    const intentData = await intentResponse.json();
    let parsed;
    try {
      parsed = JSON.parse(intentData.choices[0].message.content.trim());
    } catch (e) {
      parsed = {
        intent: "general",
        category: null,
        minPrice: null,
        maxPrice: null,
        keywords: [],
      };
    }

    // Step 2: Search products if needed
    let products = [];
    if (parsed.intent === "search" || parsed.intent === "recommend") {
      const searchParams = {
        category: parsed.category,
        minPrice: parsed.minPrice,
        maxPrice: parsed.maxPrice,
        keywords: parsed.keywords,
        brand: parsed.brand,
        ratingMin: parsed.ratingMin,
      };
      products = await searchProducts(db, searchParams);
    }

    // Step 3: Build context for the AI
    let context = "";
    let productListText = "";
    if (products.length > 0) {
      productListText = products
        .map((p) => `- ${p.name} ($${p.price})`)
        .join("\n");
      context = `We found these products:\n${productListText}`;
    } else if (productId) {
      const product = await db
        .collection("products")
        .findOne({ _id: new ObjectId(productId) });
      if (product)
        context = `Product: ${product.name}, Category: ${product.category}, Price: $${product.price}`;
    } else if (orderId && req.user) {
      const order = await db
        .collection("orders")
        .findOne({ _id: new ObjectId(orderId), userId: req.user._id });
      if (order)
        context = `Order ID: ${order._id}, Status: ${order.status}, Total: $${order.total}`;
    }

    // Step 4: Generate final answer
    const finalPrompt = `
You are a helpful shopping assistant for UnityShop.
${context ? `Relevant information:\n${context}` : ""}
The user's original message: "${message}"
Write a friendly, concise reply. If products were found, briefly describe them. If no products found, suggest refining the search. Keep it under 150 words.
`;

    const finalResponse = await fetch(GROQ_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "user", content: finalPrompt }],
        max_tokens: 300,
        temperature: 0.7,
      }),
    });

    if (!finalResponse.ok) throw new Error("Final response generation failed");
    const finalData = await finalResponse.json();
    const reply = finalData.choices[0].message.content.trim();

    // Return both message and products
    res.json({
      success: true,
      message: reply,
      products: products.map((p) => ({
        _id: p._id,
        name: p.name,
        price: p.price,
        image: Array.isArray(p.image) ? p.image[0] : p.image,
        url: `/products/${p._id}`,
      })),
    });
  } catch (error) {
    console.error("Support API error:", error);
    res.status(500).json({ error: "Failed to process support request" });
  }
});

// ========== Image Enhancement Endpoint =============
router.post(
  "/enhance-product-image",
  auth,
  upload.single("image"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No image uploaded" });
      }

      const { style } = req.body;
      const imageBuffer = req.file.buffer;
      const base64Image = imageBuffer.toString("base64");
      const dataUrl = `data:${req.file.mimetype};base64,${base64Image}`;

      // 1) Remove background with Replicate (rembg)
      console.log("Removing background...");
      const output = await replicate.run(
        "cjwbw/rembg:fb8af171cfa1616ddcf1242c093f9c46bcada5ad4cf6f2fbe8b81b330ec5c003",
        {
          input: { image: dataUrl },
        },
      );

      const bgRemovedUrl = Array.isArray(output) ? output[0] : output;

      // 2) Optional upscale for luxury style
      let finalImageUrl = bgRemovedUrl;
      if (style === "luxury") {
        console.log("Upscaling image...");
        const upscaleOutput = await replicate.run(
          "tencentarc/gfpgan:9283608cc6b7be6b65a8e46f1221b8b4551b6da5a814173b9fef106c3d695040",
          {
            input: {
              img: bgRemovedUrl,
              scale: 2,
            },
          },
        );
        finalImageUrl = Array.isArray(upscaleOutput)
          ? upscaleOutput[0]
          : upscaleOutput;
      }

      // 3) Upload to Cloudinary
      console.log("Uploading to Cloudinary...");
      const uploadResult = await cloudinary.uploader.upload(finalImageUrl, {
        folder: "enhanced_products",
        transformation: [
          { width: 1000, height: 1000, crop: "limit" },
          { quality: "auto" },
        ],
      });

      res.json({
        success: true,
        enhancedImageUrl: uploadResult.secure_url,
      });
    } catch (error) {
      console.error("Image enhancement error:", error);
      res.status(500).json({ error: "Failed to enhance image" });
    }
  },
);

module.exports = router;
