const express = require("express");
const { ObjectId } = require("mongodb");
const router = express.Router();

// ── Get all users ──────────────────────────────────────────────────────────
router.get("/", async (req, res) => {
  try {
    const users = await req.dbclient
      .db("UnityShopDB")
      .collection("users")
      .find()
      .toArray();
    res.send(users);
  } catch (error) {
    res.status(500).send(error);
  }
});

// Get Delivery Users
router.get("/role/delivery", async (req, res) => {
  try {
    const users = await req.dbclient
      .db("UnityShopDB")
      .collection("users")
      .find({ role: "delivery" })
      .toArray();
    res.send(users);
  } catch (error) {
    res.status(500).send(error);
  }
});

// User create api
router.post("/", async (req, res) => {
  try {
    const newUser = req.body;
    newUser.createdAt = new Date();
    newUser.role = newUser.role || "user";
    const result = await req.dbclient
      .db("UnityShopDB")
      .collection("users")
      .insertOne(newUser);
    res.send(result);
  } catch (error) {
    res.status(500).send(error);
  }
});

// ── Get seller by name ───────────────────────────────────────────────────────
router.get("/seller/:name", async (req, res) => {
  try {
    const name = decodeURIComponent(req.params.name);
    const user = await req.dbclient
      .db("UnityShopDB")
      .collection("users")
      .findOne(
        { name: { $regex: `^${name.trim()}$`, $options: "i" } },
        { projection: { password: 0, resetToken: 0, resetTokenExpiry: 0 } },
      );
    if (!user) return res.status(404).json({ message: "Seller not found" });
    res.json(user);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// ── Profile — GET by email ─────────────────────────────────────────────────
router.get("/profile/:email", async (req, res) => {
  try {
    const email = req.params.email;
    const user = await req.dbclient
      .db("UnityShopDB")
      .collection("users")
      .findOne(
        { email },
        { projection: { password: 0, resetToken: 0, resetTokenExpiry: 0 } },
      );
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json(user);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// ── Profile — PATCH by email ───────────────────────────────────────────────
router.patch("/profile/:email", async (req, res) => {
  try {
    const email = req.params.email;
    const { name, phone, address, image, bio } = req.body;
    const updateFields = {};
    if (name !== undefined) updateFields.name = name;
    if (phone !== undefined) updateFields.phone = phone;
    if (address !== undefined) updateFields.address = address;
    if (image !== undefined) updateFields.image = image;
    if (bio !== undefined) updateFields.bio = bio;
    updateFields.updatedAt = new Date();

    if (Object.keys(updateFields).length <= 1) {
      return res.status(400).json({ message: "No valid fields to update" });
    }
    const result = await req.dbclient
      .db("UnityShopDB")
      .collection("users")
      .findOneAndUpdate(
        { email },
        { $set: updateFields },
        {
          returnDocument: "after",
          projection: { password: 0, resetToken: 0, resetTokenExpiry: 0 },
        },
      );
    if (!result) return res.status(404).json({ message: "User not found" });
    res.json({ message: "Profile updated successfully", user: result });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// ── Shipping info — GET by email ───────────────────────────────────────────
// Returns the saved shippingInfo sub-document, or {} if never saved.
router.get("/shipping/:email", async (req, res) => {
  try {
    const email = req.params.email;
    const user = await req.dbclient
      .db("UnityShopDB")
      .collection("users")
      .findOne({ email }, { projection: { shippingInfo: 1, _id: 0 } });

    if (!user) return res.status(404).json({ message: "User not found" });

    // Return the sub-doc (may be undefined if never saved → return {})
    res.json(user.shippingInfo || {});
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// ── Shipping info — PATCH by email ─────────────────────────────────────────
// Creates or replaces the shippingInfo sub-document on the user record.
router.patch("/shipping/:email", async (req, res) => {
  try {
    const email = req.params.email;
    const { fullName, phone, address, city, zip, note } = req.body;

    // Validate required fields
    if (!fullName || !phone || !address || !city) {
      return res
        .status(400)
        .json({ message: "fullName, phone, address, and city are required" });
    }

    const shippingInfo = {
      fullName,
      phone,
      address,
      city,
      zip: zip || "",
      note: note || "",
      updatedAt: new Date(),
    };

    const result = await req.dbclient
      .db("UnityShopDB")
      .collection("users")
      .findOneAndUpdate(
        { email },
        { $set: { shippingInfo, updatedAt: new Date() } },
        { returnDocument: "after", projection: { shippingInfo: 1, _id: 0 } },
      );

    if (!result) return res.status(404).json({ message: "User not found" });

    res.json({
      message: "Shipping info saved successfully",
      shippingInfo: result.shippingInfo,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// ── Request seller ─────────────────────────────────────────────────────────
router.patch("/request-seller/:email", async (req, res) => {
  try {
    const email = req.params.email;
    const db = req.dbclient.db("UnityShopDB");
    const usersCollection = db.collection("users");

    const user = await usersCollection.findOne({ email });
    if (!user) return res.status(404).json({ message: "User not found" });
    if (user.role === "seller")
      return res.status(400).json({ message: "You are already a seller" });
    if (user.role === "admin" || user.role === "manager")
      return res
        .status(400)
        .json({ message: "Admin/Manager cannot request seller role" });
    if (user.sellerRequest === "pending")
      return res
        .status(400)
        .json({ message: "You already have a pending seller request" });

    const result = await usersCollection.findOneAndUpdate(
      { email },
      {
        $set: {
          sellerRequest: "pending",
          sellerRequestDate: new Date(),
          updatedAt: new Date(),
        },
      },
      {
        returnDocument: "after",
        projection: { password: 0, resetToken: 0, resetTokenExpiry: 0 },
      },
    );
    res.json({
      message: "Seller request submitted! Waiting for admin approval.",
      user: result,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// ── Get seller requests ────────────────────────────────────────────────────
router.get("/seller-requests", async (req, res) => {
  try {
    const db = req.dbclient.db("UnityShopDB");
    const status = req.query.status || "pending";
    const requests = await db
      .collection("users")
      .find(
        { sellerRequest: status },
        { projection: { password: 0, resetToken: 0, resetTokenExpiry: 0 } },
      )
      .sort({ sellerRequestDate: -1 })
      .toArray();
    res.json(requests);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// ── Approve seller request ─────────────────────────────────────────────────
router.patch("/approve-seller/:email", async (req, res) => {
  try {
    const email = req.params.email;
    const db = req.dbclient.db("UnityShopDB");
    const usersCollection = db.collection("users");

    const user = await usersCollection.findOne({ email });
    if (!user) return res.status(404).json({ message: "User not found" });
    if (user.sellerRequest !== "pending")
      return res
        .status(400)
        .json({ message: "No pending seller request for this user" });

    const result = await usersCollection.findOneAndUpdate(
      { email },
      {
        $set: {
          role: "seller",
          sellerRequest: "approved",
          sellerApprovedAt: new Date(),
          updatedAt: new Date(),
        },
      },
      {
        returnDocument: "after",
        projection: { password: 0, resetToken: 0, resetTokenExpiry: 0 },
      },
    );

    if (req.io) {
      const notification = {
        email,
        type: "seller_approved",
        title: "Seller Request Approved!",
        message:
          "Congratulations! Your seller request has been approved. You can now start selling on UnityShop.",
        read: false,
        createdAt: new Date(),
      };
      await db.collection("notifications").insertOne(notification);
      req.io.to(email.toLowerCase()).emit("notification", notification);
    }
    res.json({ message: "Seller request approved!", user: result });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// ── Reject seller request ──────────────────────────────────────────────────
router.patch("/reject-seller/:email", async (req, res) => {
  try {
    const email = req.params.email;
    const db = req.dbclient.db("UnityShopDB");
    const usersCollection = db.collection("users");

    const user = await usersCollection.findOne({ email });
    if (!user) return res.status(404).json({ message: "User not found" });
    if (user.sellerRequest !== "pending")
      return res
        .status(400)
        .json({ message: "No pending seller request for this user" });

    const result = await usersCollection.findOneAndUpdate(
      { email },
      {
        $set: {
          sellerRequest: "rejected",
          sellerRejectedAt: new Date(),
          updatedAt: new Date(),
        },
      },
      {
        returnDocument: "after",
        projection: { password: 0, resetToken: 0, resetTokenExpiry: 0 },
      },
    );

    if (req.io) {
      const notification = {
        email,
        type: "seller_rejected",
        title: "Seller Request Rejected",
        message:
          "Your seller request has been rejected. Please contact support for more details.",
        read: false,
        createdAt: new Date(),
      };
      await db.collection("notifications").insertOne(notification);
      req.io.to(email.toLowerCase()).emit("notification", notification);
    }
    res.json({ message: "Seller request rejected.", user: result });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});
// ===== Request Delivery Man — Submit a delivery role request (User) =====
router.patch("/request-delivery/:email", async (req, res) => {
  try {
    const email = req.params.email;
    const { nid, vehicleType, preferredArea, licenseNumber, experience } =
      req.body;

    const db = req.dbclient.db("UnityShopDB");
    const user = await db.collection("users").findOne({ email });

    if (!user) return res.status(404).json({ message: "User not found" });
    if (user.role === "delivery")
      return res.status(400).json({ message: "Already a delivery partner" });

    // Update user doc with deliveryRequest object
    const result = await db.collection("users").updateOne(
      { email },
      {
        $set: {
          deliveryRequest: {
            status: "pending",
            nid,
            vehicleType,
            preferredArea,
            licenseNumber,
            experience,
            requestedAt: new Date(),
          },
        },
      },
    );

    res.json({ message: "Delivery request submitted successfully", result });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// ===== Get Delivery Requests (Admin) =====
router.get("/delivery-requests", async (req, res) => {
  try {
    const db = req.dbclient.db("UnityShopDB");
    const requests = await db
      .collection("users")
      .find({ "deliveryRequest.status": "pending" })
      .toArray();
    res.json(requests);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// ===== Approve Delivery Request (Admin) =====
router.patch("/approve-delivery/:email", async (req, res) => {
  try {
    const email = req.params.email;
    const db = req.dbclient.db("UnityShopDB");

    const result = await db.collection("users").updateOne(
      { email },
      {
        $set: {
          role: "delivery", // Promote to delivery role
          "deliveryRequest.status": "approved",
          "deliveryRequest.approvedAt": new Date(),
        },
      },
    );

    res.json({ message: "Delivery request approved", result });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// ===== Reject Delivery Request (Admin) =====
router.patch("/reject-delivery/:email", async (req, res) => {
  try {
    const email = req.params.email;
    const db = req.dbclient.db("UnityShopDB");

    const result = await db.collection("users").updateOne(
      { email },
      {
        $set: {
          "deliveryRequest.status": "rejected",
          "deliveryRequest.rejectedAt": new Date(),
        },
      },
    );

    res.json({ message: "Delivery request rejected", result });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

module.exports = router;
// ===== Change User Role — Admin can change any user's role =====
router.patch("/change-role/:email", async (req, res) => {
  try {
    const email = req.params.email;
    const { role } = req.body;
    if (!role || !["user", "seller", "manager", "admin"].includes(role)) {
      return res.status(400).json({ message: "Invalid role" });
    }

    const db = req.dbclient.db("UnityShopDB");
    const user = await db.collection("users").findOne({ email });
    if (!user) return res.status(404).json({ message: "User not found" });

    const updateFields = { role, updatedAt: new Date() };
    if (role === "user") updateFields.sellerRequest = null;
    if (role === "seller") {
      updateFields.sellerRequest = "approved";
      updateFields.sellerApprovedAt = new Date();
    }

    const result = await db.collection("users").findOneAndUpdate(
      { email },
      { $set: updateFields },
      {
        returnDocument: "after",
        projection: { password: 0, resetToken: 0, resetTokenExpiry: 0 },
      },
    );
    res.json({ message: `User role changed to ${role}`, user: result });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// ── Wishlist — GET ─────────────────────────────────────────────────────────
router.get("/wishlist/:email", async (req, res) => {
  try {
    const email = req.params.email;
    const db = req.dbclient.db("UnityShopDB");
    const user = await db.collection("users").findOne({ email });
    if (!user) return res.status(404).json({ message: "User not found" });

    const wishlist = user.wishlist || [];
    if (wishlist.length === 0) return res.json([]);

    const productIds = wishlist
      .map((id) => {
        try {
          return new ObjectId(id);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    const products = await db
      .collection("products")
      .find({ _id: { $in: productIds } })
      .toArray();
    res.json(products);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// ── Wishlist — ADD ─────────────────────────────────────────────────────────
router.post("/wishlist/:email", async (req, res) => {
  try {
    const email = req.params.email;
    const { productId } = req.body;
    if (!productId)
      return res.status(400).json({ message: "productId is required" });

    const db = req.dbclient.db("UnityShopDB");
    const result = await db
      .collection("users")
      .findOneAndUpdate(
        { email },
        { $addToSet: { wishlist: productId } },
        { returnDocument: "after", projection: { wishlist: 1 } },
      );
    if (!result) return res.status(404).json({ message: "User not found" });
    res.json({ message: "Added to wishlist", wishlist: result.wishlist });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// ── Wishlist — REMOVE ──────────────────────────────────────────────────────
router.delete("/wishlist/:email/:productId", async (req, res) => {
  try {
    const { email, productId } = req.params;
    const db = req.dbclient.db("UnityShopDB");
    const result = await db
      .collection("users")
      .findOneAndUpdate(
        { email },
        { $pull: { wishlist: productId } },
        { returnDocument: "after", projection: { wishlist: 1 } },
      );
    if (!result) return res.status(404).json({ message: "User not found" });
    res.json({ message: "Removed from wishlist", wishlist: result.wishlist });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// ── Generic update by _id ──────────────────────────────────────────────────
router.patch("/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const result = await req.dbclient
      .db("UnityShopDB")
      .collection("users")
      .updateOne({ _id: new ObjectId(id) }, { $set: req.body });
    res.send(result);
  } catch (error) {
    res.status(500).send(error);
  }
});

// ── Delete by _id ──────────────────────────────────────────────────────────
router.delete("/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const result = await req.dbclient
      .db("UnityShopDB")
      .collection("users")
      .deleteOne({ _id: new ObjectId(id) });
    res.send(result);
  } catch (error) {
    res.status(500).send(error);
  }
});

// ── Get by _id ─────────────────────────────────────────────────────────────
router.get("/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const user = await req.dbclient
      .db("UnityShopDB")
      .collection("users")
      .findOne({ _id: new ObjectId(id) });
    res.send(user);
  } catch (error) {
    res.status(500).send(error);
  }
});

module.exports = router;
