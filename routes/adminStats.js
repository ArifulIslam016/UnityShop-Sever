const express = require("express");
const router = express.Router();

const DB_NAME = "UnityShopDB";
const ORDERS_COLLECTION = "paidOrders";
const USERS_COLLECTION = "users";

// GET /api/admin/stats/overview
router.get("/overview", async (req, res) => {
    try {
        const db = req.dbclient.db(DB_NAME);

        const totalOrders = await db.collection(ORDERS_COLLECTION).countDocuments();

        const revenueResult = await db.collection(ORDERS_COLLECTION).aggregate([
            {
                $group: {
                    _id: null,
                    total: { $sum: { $toDouble: "$amountPaid" } }
                }
            }
        ]).toArray();
        const totalRevenue = revenueResult[0]?.total || 0;

        const totalUsers = await db.collection(USERS_COLLECTION).countDocuments();

        const conversionRate = totalUsers > 0 ? (totalOrders / totalUsers) * 100 : 0;

        const topSellingProducts = await db.collection(ORDERS_COLLECTION).aggregate([
            {
                $group: {
                    _id: "$productName",
                    sales: { $sum: 1 },
                    image: { $first: "$productImage" }
                }
            },
            { $sort: { sales: -1 } },
            { $limit: 5 }
        ]).toArray();

        res.json({
            totalOrders,
            totalRevenue,
            totalUsers,
            conversionRate,
            topSellingProducts
        });
    } catch (error) {
        console.error("Failed to fetch admin overview stats:", error);
        res.status(500).json({ error: "Failed to fetch stats" });
    }
});

// GET /api/admin/stats/growth
router.get("/growth", async (req, res) => {
    try {
        const db = req.dbclient.db(DB_NAME);

        // Build last 12 months data
        const months = [];
        const now = new Date();
        for (let i = 11; i >= 0; i--) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            months.push({
                label: d.toLocaleDateString("en-US", { month: "short" }),
                start: new Date(d.getFullYear(), d.getMonth(), 1),
                end: new Date(d.getFullYear(), d.getMonth() + 1, 1),
            });
        }

        const orders = await db.collection(ORDERS_COLLECTION).find().toArray();
        const users = await db.collection(USERS_COLLECTION).find().toArray();

        const growthData = months.map(m => {
            const monthOrders = orders.filter(o => {
                const d = new Date(o.createdAt);
                return d >= m.start && d < m.end;
            });
            const monthUsers = users.filter(u => {
                const d = new Date(u.createdAt);
                return d >= m.start && d < m.end;
            });

            return {
                label: m.label,
                orders: monthOrders.length,
                revenue: monthOrders.reduce((sum, o) => sum + (Number(o.amountPaid) || 0), 0),
                users: monthUsers.length
            };
        });

        res.json(growthData);
    } catch (error) {
        console.error("Failed to fetch growth stats:", error);
        res.status(500).json({ error: "Failed to fetch growth stats" });
    }
});

// GET /api/admin/stats/daily-orders
router.get("/daily-orders", async (req, res) => {
    try {
        const db = req.dbclient.db(DB_NAME);

        const daysData = [];
        for (let i = 29; i >= 0; i--) {
            const date = new Date();
            date.setDate(date.getDate() - i);
            date.setHours(0, 0, 0, 0);
            const nextDate = new Date(date);
            nextDate.setDate(nextDate.getDate() + 1);

            const count = await db.collection(ORDERS_COLLECTION).countDocuments({
                createdAt: { $gte: date, $lt: nextDate }
            });

            daysData.push({
                date: date.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
                count
            });
        }

        res.json(daysData);
    } catch (error) {
        console.error("Failed to fetch daily orders:", error);
        res.status(500).json({ error: "Failed to fetch daily orders" });
    }
});

module.exports = router;
