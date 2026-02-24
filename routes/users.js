const experss = require("express");
const { ObjectId } = require("mongodb");
const router = experss.Router();
// Get All users Api
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

// ===== Profile API — Get profile by email =====
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
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    res.json(user);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// ===== Profile API — Update profile by email =====
router.patch("/profile/:email", async (req, res) => {
  try {
    const email = req.params.email;
    const { name, phone, address, image, bio } = req.body;

    // Only allow these fields to be updated
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

    if (!result) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json({ message: "Profile updated successfully", user: result });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// ===== Request Seller — Submit a seller request (needs admin/manager approval) =====
router.patch("/request-seller/:email", async (req, res) => {
  try {
    const email = req.params.email;
    const db = req.dbclient.db("UnityShopDB");
    const usersCollection = db.collection("users");

    const user = await usersCollection.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (user.role === "seller") {
      return res.status(400).json({ message: "You are already a seller" });
    }

    if (user.role === "admin" || user.role === "manager") {
      return res
        .status(400)
        .json({ message: "Admin/Manager cannot request seller role" });
    }

    if (user.sellerRequest === "pending") {
      return res
        .status(400)
        .json({ message: "You already have a pending seller request" });
    }

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

// ===== Get Seller Requests — For admin/manager to see pending requests =====
router.get("/seller-requests", async (req, res) => {
  try {
    const db = req.dbclient.db("UnityShopDB");
    const status = req.query.status || "pending"; // pending, approved, rejected
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

// ===== Approve Seller Request — Admin/Manager approves a user to become seller =====
router.patch("/approve-seller/:email", async (req, res) => {
  try {
    const email = req.params.email;
    const db = req.dbclient.db("UnityShopDB");
    const usersCollection = db.collection("users");

    const user = await usersCollection.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (user.sellerRequest !== "pending") {
      return res
        .status(400)
        .json({ message: "No pending seller request for this user" });
    }

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

    res.json({ message: "Seller request approved!", user: result });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// ===== Reject Seller Request — Admin/Manager rejects a seller request =====
router.patch("/reject-seller/:email", async (req, res) => {
  try {
    const email = req.params.email;
    const db = req.dbclient.db("UnityShopDB");
    const usersCollection = db.collection("users");

    const user = await usersCollection.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (user.sellerRequest !== "pending") {
      return res
        .status(400)
        .json({ message: "No pending seller request for this user" });
    }

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

    res.json({ message: "Seller request rejected.", user: result });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// ===== Change User Role — Admin can change any user's role =====
router.patch("/change-role/:email", async (req, res) => {
  try {
    const email = req.params.email;
    const { role } = req.body;

    if (!role || !["user", "seller", "manager", "admin"].includes(role)) {
      return res.status(400).json({ message: "Invalid role" });
    }

    const db = req.dbclient.db("UnityShopDB");
    const usersCollection = db.collection("users");

    const user = await usersCollection.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const updateFields = {
      role,
      updatedAt: new Date(),
    };

    // If demoting seller to user, clear seller request info
    if (role === "user") {
      updateFields.sellerRequest = null;
    }

    // If making someone a seller directly, mark as approved
    if (role === "seller") {
      updateFields.sellerRequest = "approved";
      updateFields.sellerApprovedAt = new Date();
    }

    const result = await usersCollection.findOneAndUpdate(
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

// ===== Wishlist — Get wishlist for a user =====
router.get("/wishlist/:email", async (req, res) => {
  try {
    const email = req.params.email;
    const db = req.dbclient.db("UnityShopDB");
    const user = await db.collection("users").findOne({ email });
    if (!user) return res.status(404).json({ message: "User not found" });

    const wishlist = user.wishlist || [];
    if (wishlist.length === 0) return res.json([]);

    // Fetch full product details for wishlist items
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

// ===== Wishlist — Add product to wishlist =====
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

// ===== Wishlist — Remove product from wishlist =====
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

router.patch("/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const updatedDoc = { $set: req.body };
    const result = await req.dbclient
      .db("UnityShopDB")
      .collection("users")
      .updateOne({ _id: new ObjectId(id) }, updatedDoc);
    res.send(result);
  } catch (error) {
    res.status(500).send(error);
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const result = await req.dbclient
      .db("UnityShopDB")
      .collection("users")
      .deleteOne({
        _id: new ObjectId(id),
      });
    res.send(result);
  } catch (error) {
    res.status(500).send(error);
  }
});
router.get("/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const user = await req.dbclient
      .db("UnityShopDB")
      .collection("users")
      .findOne({
        _id: new ObjectId(id),
      });
    res.send(user);
  } catch (error) {
    res.status(500).send(error);
  }
});

module.exports = router;
