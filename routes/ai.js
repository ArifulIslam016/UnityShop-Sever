// routes/ai.js
const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth");

// In-memory cache
const cache = new Map();
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

// Groq API endpoint
const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";

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
        model: "llama-3.3-70b-versatile", // free, fast, high quality
        messages: [
          { role: "system", content: "You are a helpful assistant." },
          { role: "user", content: prompt },
        ],
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

module.exports = router;
