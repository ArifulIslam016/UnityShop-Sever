const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const nodemailer = require("nodemailer");
const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || "unityshop_secret_key_2026";

// Email transporter setup
const createTransporter = () => {
  return nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });
};

// Register
router.post("/register", async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res
        .status(400)
        .json({ message: "Name, email and password are required" });
    }

    const db = req.dbclient.db("UnityShopDB");
    const usersCollection = db.collection("users");

    // Check if user already exists
    const existingUser = await usersCollection.findOne({ email });
    if (existingUser) {
      return res
        .status(400)
        .json({ message: "User with this email already exists" });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Create user
    const newUser = {
      name,
      email,
      password: hashedPassword,
      role: "user",
      createdAt: new Date(),
    };

    const result = await usersCollection.insertOne(newUser);

    res.status(201).json({
      message: "User registered successfully",
      userId: result.insertedId,
    });
  } catch (error) {
    console.error("Register error:", error);
    res.status(500).json({ message: "Server error during registration" });
  }
});

// Login
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res
        .status(400)
        .json({ message: "Email and password are required" });
    }

    const db = req.dbclient.db("UnityShopDB");
    const usersCollection = db.collection("users");

    // Find user by email
    const user = await usersCollection.findOne({ email });
    if (!user) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    // Compare password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    // Generate JWT token
    const token = jwt.sign(
      { userId: user._id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: "7d" },
    );

    // Send user data (without password)
    const { password: _, ...userWithoutPassword } = user;

    res.json({
      message: "Login successful",
      user: userWithoutPassword,
      token,
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ message: "Server error during login" });
  }
});

// Google Sign In — save or find Google user
router.post("/google", async (req, res) => {
  try {
    const { name, email, image, googleId } = req.body;

    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }

    const db = req.dbclient.db("UnityShopDB");
    const usersCollection = db.collection("users");

    // Check if user already exists
    let user = await usersCollection.findOne({ email });

    if (!user) {
      // Create new user from Google data
      const newUser = {
        name: name || "Google User",
        email,
        image: image || null,
        googleId,
        provider: "google",
        role: "user",
        createdAt: new Date(),
      };

      const result = await usersCollection.insertOne(newUser);
      user = { ...newUser, _id: result.insertedId };
    } else {
      // Update existing user with Google info if missing
      const updateFields = {};
      if (!user.googleId && googleId) updateFields.googleId = googleId;
      if (!user.image && image) updateFields.image = image;
      if (!user.provider) updateFields.provider = "google";

      if (Object.keys(updateFields).length > 0) {
        await usersCollection.updateOne(
          { _id: user._id },
          { $set: updateFields },
        );
        user = { ...user, ...updateFields };
      }
    }

    // Generate JWT token
    const token = jwt.sign(
      { userId: user._id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: "7d" },
    );

    // Send user data (without password)
    const { password: _, ...userWithoutPassword } = user;

    res.json({
      message: "Google login successful",
      user: userWithoutPassword,
      token,
    });
  } catch (error) {
    console.error("Google auth error:", error);
    res
      .status(500)
      .json({ message: "Server error during Google authentication" });
  }
});

// Forgot Password — send reset email
router.post("/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }

    const db = req.dbclient.db("UnityShopDB");
    const usersCollection = db.collection("users");

    // Find user
    const user = await usersCollection.findOne({ email });
    if (!user) {
      // Don't reveal if email exists or not (security)
      return res.json({
        message: "If this email is registered, you will receive a reset link.",
      });
    }

    // Google-only users can't reset password
    if (user.provider === "google" && !user.password) {
      return res.status(400).json({
        message: "This account uses Google login. Please sign in with Google.",
      });
    }

    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString("hex");
    const resetTokenHash = crypto
      .createHash("sha256")
      .update(resetToken)
      .digest("hex");
    const resetTokenExpiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    // Save token to DB
    await usersCollection.updateOne(
      { _id: user._id },
      {
        $set: {
          resetToken: resetTokenHash,
          resetTokenExpiry,
        },
      },
    );

    // Build reset URL
    const frontendUrl = process.env.SITE_DOMAIN || "http://localhost:3000";
    const resetUrl = `${frontendUrl}/reset-password?token=${resetToken}&email=${encodeURIComponent(email)}`;

    // Send email
    const transporter = createTransporter();
    const mailOptions = {
      from: `"UnityShop" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: "Reset Your Password - UnityShop",
      html: `
        <div style="max-width: 600px; margin: 0 auto; font-family: 'Segoe UI', Arial, sans-serif; background: #f8fafc; padding: 0;">
          <!-- Header -->
          <div style="background: linear-gradient(135deg, #f97316, #ea580c); padding: 40px 30px; text-align: center; border-radius: 12px 12px 0 0;">
            <h1 style="color: #fff; margin: 0; font-size: 28px; letter-spacing: 1px;">🛍️ UnityShop</h1>
            <p style="color: rgba(255,255,255,0.85); margin: 8px 0 0; font-size: 14px;">Your favorite shopping destination</p>
          </div>

          <!-- Body -->
          <div style="background: #ffffff; padding: 40px 30px; border-left: 1px solid #e2e8f0; border-right: 1px solid #e2e8f0;">
            <h2 style="color: #1e293b; margin: 0 0 16px; font-size: 22px;">Password Reset Request</h2>
            <p style="color: #475569; font-size: 15px; line-height: 1.7; margin: 0 0 8px;">
              Hi <strong>${user.name || "there"}</strong>,
            </p>
            <p style="color: #475569; font-size: 15px; line-height: 1.7; margin: 0 0 24px;">
              We received a request to reset your password. Click the button below to create a new password:
            </p>

            <!-- CTA Button -->
            <div style="text-align: center; margin: 32px 0;">
              <a href="${resetUrl}" 
                 style="display: inline-block; background: linear-gradient(135deg, #f97316, #ea580c); color: #fff; text-decoration: none; padding: 14px 40px; border-radius: 8px; font-weight: 600; font-size: 16px; box-shadow: 0 4px 14px rgba(249,115,22,0.4);">
                Reset Password
              </a>
            </div>

            <!-- Info box -->
            <div style="background: #fff7ed; border: 1px solid #fed7aa; border-radius: 8px; padding: 16px; margin: 24px 0;">
              <p style="color: #9a3412; font-size: 13px; margin: 0; line-height: 1.6;">
                ⏰ This link will expire in <strong>1 hour</strong>.<br>
                🔒 If you didn't request this, please ignore this email.
              </p>
            </div>

            <p style="color: #94a3b8; font-size: 12px; margin: 24px 0 0; line-height: 1.6;">
              Can't click the button? Copy and paste this link:<br>
              <a href="${resetUrl}" style="color: #f97316; word-break: break-all;">${resetUrl}</a>
            </p>
          </div>

          <!-- Footer -->
          <div style="background: #1e293b; padding: 24px 30px; text-align: center; border-radius: 0 0 12px 12px;">
            <p style="color: #94a3b8; font-size: 12px; margin: 0;">
              © ${new Date().getFullYear()} UnityShop. All rights reserved.
            </p>
          </div>
        </div>
      `,
    };

    await transporter.sendMail(mailOptions);

    res.json({
      message: "If this email is registered, you will receive a reset link.",
    });
  } catch (error) {
    console.error("Forgot password error:", error);
    res.status(500).json({ message: "Server error. Please try again later." });
  }
});

// Reset Password — verify token and update password
router.post("/reset-password", async (req, res) => {
  try {
    const { email, token, newPassword } = req.body;

    if (!email || !token || !newPassword) {
      return res.status(400).json({ message: "All fields are required" });
    }

    if (newPassword.length < 6) {
      return res
        .status(400)
        .json({ message: "Password must be at least 6 characters" });
    }

    const db = req.dbclient.db("UnityShopDB");
    const usersCollection = db.collection("users");

    // Hash the token for comparison
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

    // Find user with valid token
    const user = await usersCollection.findOne({
      email,
      resetToken: tokenHash,
      resetTokenExpiry: { $gt: new Date() },
    });

    if (!user) {
      return res
        .status(400)
        .json({ message: "Invalid or expired reset link. Please try again." });
    }

    // Hash new password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    // Update password and remove reset token
    await usersCollection.updateOne(
      { _id: user._id },
      {
        $set: { password: hashedPassword },
        $unset: { resetToken: "", resetTokenExpiry: "" },
      },
    );

    res.json({ message: "Password reset successfully! You can now login." });
  } catch (error) {
    console.error("Reset password error:", error);
    res.status(500).json({ message: "Server error. Please try again later." });
  }
});

module.exports = router;
