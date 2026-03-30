// routes/ai.js
const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth");
const { ObjectId } = require("mongodb");
const multer = require("multer");
const { GoogleGenAI } = require("@google/genai");
const cloudinary = require("cloudinary").v2;

// Setup file upload
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

// Cloudinary configuration
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Gemini client
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

// In-memory cache for product descriptions (1 hour)
const cache = new Map();
const CACHE_TTL = 60 * 60 * 1000;

// ========== Helper: Search products in MongoDB ==========
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
You are an expert e‑commerce copywriter. Generate a compelling, SEO‑friendly product description as clean HTML code only. Do not include any markdown, code fences, or surrounding text.

Product Name: ${name}
Category: ${category || "Not specified"}
Brand: ${brand || "Not specified"}

Requirements:
- Total length: 100–150 words.
- Use a friendly, persuasive tone. Avoid generic phrases. Highlight what makes this product special.
- Do NOT mention price or image.
- Format the description using only HTML tags: <p> for paragraphs, <strong> for section titles (e.g., "Key Features", "Benefits", "Why Choose This Product"), <ul> and <li> for bullet points. Use <br> sparingly for line breaks.
- Include relevant keywords naturally (product name, category, brand) for SEO.

Now generate only the HTML code (no other text).
`;

    const response = await ai.models.generateContent({
      model: "gemini-3.1-flash",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        maxOutputTokens: 500,
        temperature: 0.5,
      },
    });

    const description = response.text;
    cache.set(cacheKey, { description, timestamp: Date.now() });
    res.json({ success: true, description });
  } catch (error) {
    console.error("Description generation error:", error);
    res.status(500).json({ error: "Failed to generate description" });
  }
});

// ========== Health Check ==========
router.get("/test", (req, res) => {
  res.json({ message: "AI route is working!" });
});

// ========== AI Support Chatbot ==========
router.post("/support", auth, async (req, res) => {
  try {
    const { message, orderId, productId, userId } = req.body;
    if (!message) return res.status(400).json({ error: "Message is required" });

    const db = req.dbclient.db("UnityShopDB");
    const siteUrl = "https://unity-shop-three.vercel.app";

    // Site‑wide context
    const siteContext = `
UnityShop (${siteUrl}) is an e‑commerce platform offering electronics, fashion, home & living, and more.
- Free shipping on orders over 500 BDT.
- Payment via bKash, Nagad, credit cards.
- 7‑day easy return policy.
- 100% original product guarantee.
- Fast delivery across Bangladesh.
- Current promotions: Eid ul‑Adha 2025 up to 50% off, Flash Sale live, Smartphone fest.
    `;

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

    const intentResponse = await ai.models.generateContent({
      model: "gemini-3.1-flash",
      contents: [{ role: "user", parts: [{ text: intentPrompt }] }],
      config: {
        maxOutputTokens: 250,
        temperature: 0,
      },
    });

    let parsed;
    try {
      parsed = JSON.parse(intentResponse.text);
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

    // Step 3: Build product info (including stock)
    let productListText = "";
    if (products.length > 0) {
      productListText = products
        .map(
          (p) =>
            `- ${p.name} (${p.stock > 0 ? `in stock, ${p.stock} left` : "out of stock"}) – ${p.price} BDT.`,
        )
        .join("\n");
    }

    // Step 4: Generate final answer
    const finalPrompt = `
You are a helpful shopping assistant for UnityShop.
${siteContext}
${productListText ? `We found these products matching the user's request:\n${productListText}` : ""}
The user's original message: "${message}"
Write a friendly, concise reply. If products were found, briefly describe them and mention stock availability. If no products found, suggest refining the search or ask for more details. Keep it under 150 words.
`;

    const finalResponse = await ai.models.generateContent({
      model: "gemini-3.1-flash",
      contents: [{ role: "user", parts: [{ text: finalPrompt }] }],
      config: {
        maxOutputTokens: 300,
        temperature: 0.5,
      },
    });

    const reply = finalResponse.text;

    res.json({
      success: true,
      message: reply,
      products: products.map((p) => ({
        _id: p._id,
        name: p.name,
        price: p.price,
        image: Array.isArray(p.image) ? p.image[0] : p.image,
        url: `/products/${p._id}`,
        stock: p.stock,
        inStock: p.stock > 0,
      })),
    });
  } catch (error) {
    console.error("Support API error:", error);
    res.status(500).json({ error: "Failed to process support request" });
  }
});

// ========== Image Enhancement (Nano Banana) ==========
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
      const imageBase64 = req.file.buffer.toString("base64");
      const mimeType = req.file.mimetype;

      const stylePrompts = {
        professional:
          "Remove the background and replace with a clean white studio background. Add soft, professional product lighting and subtle shadows. Enhance colors naturally.",
        clean:
          "Remove background completely. Pure white background. Adjust brightness and contrast for a clean, sharp product image.",
        luxury:
          "Remove background. Replace with elegant dark gradient background. Add dramatic lighting, rich contrast, and premium product styling. Upscale to high resolution.",
        minimal:
          "Remove background. Replace with soft light gray background. Add subtle shadows. Keep the image simple, clean, and modern.",
      };

      const prompt = stylePrompts[style] || stylePrompts.professional;

      const response = await ai.models.generateContent({
        model: "gemini-3.1-flash-image-preview", // Nano Banana
        contents: [
          {
            parts: [
              { text: prompt },
              {
                inlineData: {
                  mimeType,
                  data: imageBase64,
                },
              },
            ],
          },
        ],
        config: {
          responseModalities: ["TEXT", "IMAGE"],
        },
      });

      let enhancedImageBase64 = null;
      for (const part of response.candidates?.[0]?.content?.parts || []) {
        if (part.inlineData && part.inlineData.mimeType?.startsWith("image/")) {
          enhancedImageBase64 = part.inlineData.data;
          break;
        }
      }

      if (!enhancedImageBase64) {
        throw new Error("No image generated by the model");
      }

      // Upload to Cloudinary
      const dataUrl = `data:image/png;base64,${enhancedImageBase64}`;
      const uploadResult = await cloudinary.uploader.upload(dataUrl, {
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
      res
        .status(500)
        .json({ error: error.message || "Failed to enhance image" });
    }
  },
);

module.exports = router;
