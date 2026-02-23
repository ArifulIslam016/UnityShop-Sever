const express = require("express");
const { ObjectId } = require("mongodb");
const router = express.Router();

const DB_NAME = "UnityShopDB";
const ORDERS_COLLECTION = "paidOrders";
const PRODUCTS_COLLECTION = "products";

// Get orders - filter by sellerEmail or customerEmail
router.get("/", async (req, res) => {
  try {
    const { sellerEmail, customerEmail } = req.query;
    let query = {};

    if (sellerEmail) {
      query.sellerEmail = sellerEmail;
    }
    if (customerEmail) {
      query.customerEmail = customerEmail;
    }

    const orders = await req.dbclient
      .db(DB_NAME)
      .collection(ORDERS_COLLECTION)
      .find(query)
      .sort({ createdAt: -1 })
      .toArray();

    res.send(orders);
  } catch (error) {
    res.status(500).send({ error: "Failed to fetch orders" });
  }
});

// Get seller stats (product count, order count, revenue)
router.get("/seller-stats", async (req, res) => {
  try {
    const { sellerEmail } = req.query;
    if (!sellerEmail) {
      return res.status(400).send({ error: "sellerEmail is required" });
    }

    const db = req.dbclient.db(DB_NAME);

    // Get total products
    const totalProducts = await db
      .collection(PRODUCTS_COLLECTION)
      .countDocuments({ sellerEmail });

    // Get orders for this seller
    const orders = await db
      .collection(ORDERS_COLLECTION)
      .find({ sellerEmail })
      .toArray();

    const totalOrders = orders.length;
    const totalRevenue = orders.reduce(
      (sum, order) => sum + (Number(order.amountPaid) || 0),
      0,
    );

    // Count orders by status
    const statusCounts = {};
    orders.forEach((order) => {
      const status = order.status || "New";
      statusCounts[status] = (statusCounts[status] || 0) + 1;
    });

    // Get sales data for last 7 days
    const last7Days = [];
    for (let i = 6; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      date.setHours(0, 0, 0, 0);
      const nextDate = new Date(date);
      nextDate.setDate(nextDate.getDate() + 1);

      const dayOrders = orders.filter((order) => {
        const orderDate = new Date(order.createdAt);
        return orderDate >= date && orderDate < nextDate;
      });

      last7Days.push({
        date: date.toISOString().split("T")[0],
        day: date.toLocaleDateString("en-US", { weekday: "short" }),
        orders: dayOrders.length,
        revenue: dayOrders.reduce(
          (sum, o) => sum + (Number(o.amountPaid) || 0),
          0,
        ),
      });
    }

    res.send({
      totalProducts,
      totalOrders,
      totalRevenue,
      statusCounts,
      last7Days,
    });
  } catch (error) {
    console.error("Failed to fetch seller stats:", error);
    res.status(500).send({ error: "Failed to fetch seller stats" });
  }
});

// Get user stats (order count, total spent, pending count)
router.get("/user-stats", async (req, res) => {
  try {
    const { customerEmail } = req.query;
    if (!customerEmail) {
      return res.status(400).send({ error: "customerEmail is required" });
    }

    const db = req.dbclient.db(DB_NAME);

    // Get orders for this customer
    const orders = await db
      .collection(ORDERS_COLLECTION)
      .find({ customerEmail })
      .toArray();

    const totalOrders = orders.length;
    const totalSpent = orders.reduce(
      (sum, order) => sum + (Number(order.amountPaid) || 0),
      0,
    );

    // Count by status
    const statusCounts = {};
    orders.forEach((order) => {
      const status = order.status || "New";
      statusCounts[status] = (statusCounts[status] || 0) + 1;
    });

    const pendingCount =
      (statusCounts["New"] || 0) +
      (statusCounts["Processing"] || 0) +
      (statusCounts["Shipped"] || 0);

    // Get wishlist count
    const user = await db.collection("users").findOne({ email: customerEmail });
    const wishlistCount = (user?.wishlist || []).length;

    res.send({
      totalOrders,
      totalSpent,
      pendingCount,
      deliveredCount: statusCounts["Delivered"] || 0,
      wishlistCount,
      statusCounts,
    });
  } catch (error) {
    console.error("Failed to fetch user stats:", error);
    res.status(500).send({ error: "Failed to fetch user stats" });
  }
});

// Get platform-wide stats for manager dashboard
router.get("/platform-stats", async (req, res) => {
  try {
    const db = req.dbclient.db(DB_NAME);

    // Get all orders
    const orders = await db
      .collection(ORDERS_COLLECTION)
      .find()
      .sort({ createdAt: -1 })
      .toArray();

    const totalOrders = orders.length;
    const totalRevenue = orders.reduce(
      (sum, order) =>
        sum + (Number(order.amountPaid) || Number(order.amountpaid) || 0),
      0,
    );
    const statusCounts = {};
    orders.forEach((order) => {
      const status = order.status || "New";
      statusCounts[status] = (statusCounts[status] || 0) + 1;
    });

    // Get total users, sellers, pending seller requests
    const usersCollection = db.collection("users");
    const totalUsers = await usersCollection.countDocuments();
    const totalSellers = await usersCollection.countDocuments({
      role: "seller",
    });
    const pendingSellerRequests = await usersCollection.countDocuments({
      sellerRequest: "pending",
    });

    // Get total products
    const totalProducts = await db
      .collection(PRODUCTS_COLLECTION)
      .countDocuments();

    // Today's stats
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayOrders = orders.filter((o) => new Date(o.createdAt) >= today);
    const todaySales = todayOrders.reduce(
      (sum, o) => sum + (Number(o.amountPaid) || Number(o.amountpaid) || 0),
      0,
    );
    const todayOrderCount = todayOrders.length;

    // New users today
    const newUsersToday = await usersCollection.countDocuments({
      createdAt: { $gte: today },
    });

    // Sales data for last 7 days
    const last7Days = [];
    for (let i = 6; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      date.setHours(0, 0, 0, 0);
      const nextDate = new Date(date);
      nextDate.setDate(nextDate.getDate() + 1);

      const dayOrders = orders.filter((order) => {
        const orderDate = new Date(order.createdAt);
        return orderDate >= date && orderDate < nextDate;
      });

      last7Days.push({
        date: date.toISOString().split("T")[0],
        day: date.toLocaleDateString("en-US", { weekday: "short" }),
        orders: dayOrders.length,
        revenue: dayOrders.reduce(
          (sum, o) => sum + (Number(o.amountPaid) || Number(o.amountpaid) || 0),
          0,
        ),
      });
    }

    // Recent orders (last 10)
    const recentOrders = orders.slice(0, 10);

    res.send({
      totalOrders,
      totalRevenue,
      totalUsers,
      totalSellers,
      totalProducts,
      pendingSellerRequests,
      todaySales,
      todayOrderCount,
      newUsersToday,
      statusCounts,
      last7Days,
      recentOrders,
    });
  } catch (error) {
    console.error("Failed to fetch platform stats:", error);
    res.status(500).send({ error: "Failed to fetch platform stats" });
  }
});

// Update order status
router.patch("/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const { status } = req.body;

    const result = await req.dbclient
      .db(DB_NAME)
      .collection(ORDERS_COLLECTION)
      .updateOne({ _id: new ObjectId(id) }, { $set: { status } });

    res.send(result);
  } catch (error) {
    res.status(500).send({ error: "Failed to update order" });
  }
});

module.exports = router;
