const express = require("express");
const { ObjectId } = require("mongodb");
const router = express.Router();

const DB_NAME = "UnityShopDB";
const ORDERS_COLLECTION = "paidOrders";
const PRODUCTS_COLLECTION = "products";
const STATUS_STEPS = [
  "placed",
  "confirmed",
  "packed",
  "picked",
  "inTransit",
  "outForDelivery",
  "delivered",
  "cancelled",
];

// Assign delivery man to order
router.put("/assign/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { deliveryManId } = req.body;

    const result = await req.dbclient
      .db(DB_NAME)
      .collection(ORDERS_COLLECTION)
      .updateOne(
        { _id: new ObjectId(id) },
        {
          $set: {
            deliveryManId: deliveryManId,
            assignedAt: new Date(),
            updatedAt: new Date(),
          },
        },
      );
    res.send(result);
  } catch (error) {
    res.status(500).send(error);
  }
});

function normalizeStatus(status) {
  return status || "placed";
}

// Get orders assigned to the logged-in delivery man
router.get("/my-deliveries/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const orders = await req.dbclient
      .db(DB_NAME)
      .collection(ORDERS_COLLECTION)
      .find({ deliveryManId: userId })
      .toArray();
    res.send(orders);
  } catch (error) {
    res.status(500).send(error);
  }
});

// ROUTE 1: GET /orders/track/:id
// Purpose: Fetch a single order by ID for the tracking view
// Used by: User dashboard → My Orders → Track button
router.get("/track/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid order ID" });
    }

    const order = await req.dbclient
      .db(DB_NAME)
      .collection(ORDERS_COLLECTION)
      .findOne({ _id: new ObjectId(id) });

    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }

    // If old order has no statusHistory, build it on the fly
    // so old orders don't break the tracking UI
    if (!order.statusHistory || order.statusHistory.length === 0) {
      const fallbackStatus = normalizeStatus(order.status);
      order.statusHistory = [
        {
          status: fallbackStatus,
          label: fallbackStatus,
          updatedAt: order.createdAt || new Date(),
        },
      ];
    }

    // If no estimatedDeliveryDate, generate one on the fly
    if (!order.estimatedDeliveryDate) {
      const est = new Date(order.createdAt || new Date());
      est.setDate(est.getDate() + 5);
      order.estimatedDeliveryDate = est;
    }

    res.json(order);
  } catch (error) {
    console.error("Failed to fetch order for tracking:", error);
    res.status(500).json({ error: "Failed to fetch order" });
  }
});

// ROUTE 2: PATCH /orders/track/:id/status
// Purpose: Admin updates order status + pushes to history
// Used by: Admin dashboard → Orders Management
router.patch("/track/:id/status", async (req, res) => {
  try {
    const { id } = req.params;
    const { status, deliveryPartner } = req.body;
    const allowed = STATUS_STEPS;

    // Validate the status
    if (!allowed.includes(status)) {
      return res.status(400).json({
        error: `Invalid status. Allowed: ${allowed.join(", ")}`,
      });
    }

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid order ID" });
    }

    const db = req.dbclient.db(DB_NAME);

    // Fetch order first — needed for notifications
    const order = await db
      .collection(ORDERS_COLLECTION)
      .findOne({ _id: new ObjectId(id) });

    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }

    const nextStatus = normalizeStatus(status);
    // Build history entry
    const historyEntry = {
      status: nextStatus,
      label: nextStatus,
      updatedAt: new Date(),
    };

    // Build update fields
    const updateFields = {
      status: nextStatus,
      updatedAt: new Date(),
    };

    if (deliveryPartner) {
      updateFields.deliveryPartner = deliveryPartner;
    }

    const result = await db.collection(ORDERS_COLLECTION).updateOne(
      { _id: new ObjectId(id) },
      {
        $set: updateFields,
        $push: { statusHistory: historyEntry },
      },
    );

    // ── Notify buyer in real-time ─────────────────────────────
    if (req.io && order.customerEmail) {
      const buyerEmail = order.customerEmail;

      const notification = {
        email: buyerEmail,
        type: "order_status",
        title: `Order ${nextStatus}`,
        message: `Your order for "${order.productName || "your item"}" is now "${nextStatus}".`,
        meta: { orderId: id, status: nextStatus },
        read: false,
        createdAt: new Date(),
      };

      await db.collection("notifications").insertOne(notification);
      req.io.to(buyerEmail.toLowerCase()).emit("notification", notification);

      // Dedicated tracking event — frontend stepper listens to this
      req.io.to(buyerEmail.toLowerCase()).emit("orderTrackingUpdated", {
        orderId: id,
        status: nextStatus,
        historyEntry,
      });
    }

    // ── Notify seller on Delivered or Cancelled ───────────────
    if (
      req.io &&
      order.sellerEmail &&
      (nextStatus === "delivered" || nextStatus === "cancelled")
    ) {
      const sellerNotif = {
        email: order.sellerEmail,
        type: "order_status",
        title: `Order ${nextStatus}`,
        message: `Order for "${order.productName}" from ${order.customerName || order.customerEmail} is now "${nextStatus}".`,
        meta: { orderId: id, status: nextStatus },
        read: false,
        createdAt: new Date(),
      };

      await db.collection("notifications").insertOne(sellerNotif);
      req.io
        .to(order.sellerEmail.toLowerCase())
        .emit("notification", sellerNotif);
    }

    res.json({
      message: "Order status updated successfully",
      status: nextStatus,
      historyEntry,
      result,
    });
  } catch (error) {
    console.error("Failed to update tracking status:", error);
    res.status(500).json({ error: "Failed to update order status" });
  }
});

// ─────────────────────────────────────────────────────────────
// Helper: human-readable label for each status
function getStatusLabel(status) {
  const labels = {
    New: "Order Confirmed",
    Processing: "Being Packed",
    Shipped: "Shipped",
    Delivered: "Delivered",
    Cancelled: "Cancelled",
  };
  return labels[status] || status;
}

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

//
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

// Get admin monthly stats (last 12 months of orders + user registrations)
router.get("/admin-monthly-stats", async (req, res) => {
  try {
    const db = req.dbclient.db(DB_NAME);

    // Build last 12 months labels
    const months = [];
    const now = new Date();
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({
        year: d.getFullYear(),
        month: d.getMonth(), // 0-indexed
        label: d.toLocaleDateString("en-US", { month: "short" }),
        start: new Date(d.getFullYear(), d.getMonth(), 1),
        end: new Date(d.getFullYear(), d.getMonth() + 1, 1),
      });
    }

    // Get all orders
    const orders = await db.collection(ORDERS_COLLECTION).find().toArray();

    // Get all users
    const users = await db
      .collection("users")
      .find({}, { projection: { createdAt: 1, role: 1 } })
      .toArray();

    const monthlyData = months.map((m) => {
      const monthOrders = orders.filter((o) => {
        const d = new Date(o.createdAt);
        return d >= m.start && d < m.end;
      });
      const monthUsers = users.filter((u) => {
        const d = new Date(u.createdAt);
        return d >= m.start && d < m.end;
      });
      const monthSellers = users.filter((u) => {
        const d = new Date(u.createdAt);
        return d >= m.start && d < m.end && u.role === "seller";
      });

      return {
        label: m.label,
        orders: monthOrders.length,
        revenue: monthOrders.reduce(
          (sum, o) => sum + (Number(o.amountPaid) || Number(o.amountpaid) || 0),
          0,
        ),
        newUsers: monthUsers.length,
        newSellers: monthSellers.length,
      };
    });

    res.send(monthlyData);
  } catch (error) {
    console.error("Failed to fetch admin monthly stats:", error);
    res.status(500).send({ error: "Failed to fetch admin monthly stats" });
  }
});

// Update order status
router.patch("/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const { status } = req.body;
    const allowed = STATUS_STEPS;

    const db = req.dbclient.db(DB_NAME);

    if (!allowed.includes(status)) {
      return res.status(400).send({
        error: `Invalid status. Allowed: ${allowed.join(", ")}`,
      });
    }

    // Get the order first so we can notify the customer
    const order = await db
      .collection(ORDERS_COLLECTION)
      .findOne({ _id: new ObjectId(id) });

    if (!order) {
      return res.status(404).send({ error: "Order not found" });
    }

    const nextStatus = normalizeStatus(status);

    const result = await db.collection(ORDERS_COLLECTION).updateOne(
      { _id: new ObjectId(id) },
      {
        $set: {
          status: nextStatus,
          updatedAt: new Date(),
        },
        $push: {
          statusHistory: {
            status: nextStatus,
            label: nextStatus,
            updatedAt: new Date(),
          },
        },
      },
    );

    // Send notification to the buyer about the status update
    if (order && req.io) {
      const buyerEmail = order.customerEmail;
      if (buyerEmail) {
        const notification = {
          email: buyerEmail,
          type: "order_status",
          title: `Order ${nextStatus}`,
          message: `Your order for ${order.productName || "your item"} has been updated to "${nextStatus}".`,
          meta: { orderId: id, status: nextStatus },
          read: false,
          createdAt: new Date(),
        };

        await db.collection("notifications").insertOne(notification);
        req.io.to(buyerEmail.toLowerCase()).emit("notification", notification);
      }

      // Also notify seller if status is relevant (e.g., Delivered)
      const sellerEmail = order.sellerEmail;
      if (
        sellerEmail &&
        (nextStatus === "delivered" || nextStatus === "cancelled")
      ) {
        const sellerNotif = {
          email: sellerEmail,
          type: "order_status",
          title: `Order ${nextStatus}`,
          message: `Order for ${order.productName || "an item"} from ${order.customerName || order.customerEmail} is now "${nextStatus}".`,
          meta: { orderId: id, status: nextStatus },
          read: false,
          createdAt: new Date(),
        };

        await db.collection("notifications").insertOne(sellerNotif);
        req.io.to(sellerEmail.toLowerCase()).emit("notification", sellerNotif);
      }
    }

    res.send({
      result,
      status: nextStatus,
    });
  } catch (error) {
    res.status(500).send({ error: "Failed to update order" });
  }
});

module.exports = router;
