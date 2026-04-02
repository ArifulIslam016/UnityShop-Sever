// middleware/auth.js
const jwt = require("jsonwebtoken");
const JWT_SECRET = process.env.JWT_SECRET || "unityshop_secret_key_2026";

module.exports = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "No token provided" });
  }
  const token = authHeader.split(" ")[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    // The token from NextAuth may contain `userId` or `id`
    const userId = decoded.userId || decoded.id;
    if (!userId) {
      throw new Error("User ID missing from token");
    }
    req.user = {
      _id: userId,
      userId: userId,
      email: decoded.email,
      role: decoded.role,
    };
    next();
  } catch (error) {
    console.error("Auth error:", error.message);
    return res.status(401).json({ error: "Invalid token" });
  }
};
