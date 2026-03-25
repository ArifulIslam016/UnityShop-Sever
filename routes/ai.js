const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const Replicate = require("replicate");
const cloudinary = require("../utils/cloudinary");

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

const JWT_SECRET = process.env.JWT_SECRET || "unityshop_secret_key_2026";

// Auth middleware
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

// Route for Image Enhancement using Replicate (BRIA Background Removal or similar)
router.post("/enhance-product-image", verifyToken, async (req, res) => {
  try {
    const { image, style } = req.body;
    if (!image) return res.status(400).json({ error: "Image is required" });

    // Assuming the image is a base64 string, you might need to upload it to Cloudinary first
    // to get a URL that Replicate can process, or if the API supports base64 directly, use that

    const uploadResponse = await cloudinary.uploader.upload(image, {
      folder: "unityshop/temp",
    });
    
    // Choose model based on style
    let promptText = "professional product photography, well-lit, clean background";
    if (style === "luxury") promptText = "luxury product photography, dramatic lighting, premium feel";
    else if (style === "minimal") promptText = "minimalist product photography, solid white background";

    // Call Replicate API (example using a general image-to-image or background removal model)
    // Here we're using a hypothetical or common model for image enhancement/background removal
    // You should substitute with a specific Replicate model like 'salesforce/blip' or 'arielreplicate/rembg'
    
    // Using an example model for background removal and enhancement (adjust to real one)
    const output = await replicate.run(
      "cjwbw/rembg:fb8af171cfa1616ddcf1242c093f9c46bcada5ad4cf6f2fbe8b81b330ec5c003",
      {
        input: {
          image: uploadResponse.secure_url,
        }
      }
    );

    // output is typically an array with the URL or a single URL stream, depending on the model
    // Assuming output is the enhanced image URL:
    
    const enhancedUrl = Array.isArray(output) ? output[0] : output;

    // Optional: upload the enhanced URL back to Cloudinary for permanent storage
    const finalUpload = await cloudinary.uploader.upload(enhancedUrl, {
      folder: "unityshop/products",
      public_id: `enhanced_${Date.now()}`
    });

    res.json({ success: true, enhancedImage: finalUpload.secure_url });
  } catch (error) {
    console.error("AI enhancement error:", error);
    res.status(500).json({ error: "Failed to enhance image" });
  }
});

router.get("/test", (req, res) => {
  res.json({ message: "AI route is working!" });
});

// Support endpoint
router.post("/support", auth, async (req, res) => {
  try {
    const { message, orderId, productId, userId } = req.body;

    if (!message) {
      return res.status(400).json({ error: "Message is required" });
    }

    // Build context from order or product (if provided)
    let context = "";
    if (orderId) {
      // Fetch order details from database (optional)
      const order = await getOrderById(orderId); // you'll need to implement this
      if (order) {
        context = `
Order ID: ${order._id}
Status: ${order.status}
Total: $${order.total}
Items: ${order.items.map((i) => i.productName).join(", ")}
Date: ${order.createdAt.toDateString()}
        `;
      }
    }
    if (productId && !orderId) {
      // Fetch product details
      const product = await getProductById(productId);
      if (product) {
        context = `
Product: ${product.name}
Category: ${product.category || "Not specified"}
Price: $${product.price}
        `;
      }
    }

    const prompt = `
You are a customer support assistant for an e-commerce store called UnityShop. Your job is to help customers with after-sales issues: order tracking, returns, refunds, delivery problems, product defects, etc. Be friendly, helpful, and concise.

Customer message: "${message}"

${context ? `Relevant context:\n${context}` : ""}

Provide a helpful response. If the customer asks about a refund or return, ask for order details and explain the process. If the issue is about delivery, suggest checking tracking and contacting the carrier. For complex issues, advise them to contact customer service directly.
    `;

    const response = await fetch(GROQ_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [
          {
            role: "system",
            content: "You are a helpful customer support assistant.",
          },
          { role: "user", content: prompt },
        ],
        max_tokens: 300,
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error?.message || "Groq API error");
    }

    const data = await response.json();
    const reply = data.choices[0].message.content.trim();

    res.json({ success: true, message: reply });
  } catch (error) {
    console.error("Support API error:", error);
    res.status(500).json({ error: "Failed to process support request" });
  }
});

module.exports = router;
