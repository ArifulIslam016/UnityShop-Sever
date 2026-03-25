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

module.exports = router;
