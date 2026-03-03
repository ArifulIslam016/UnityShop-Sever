const express = require("express");
const { ObjectId } = require("mongodb");
const router = express.Router();

// Helper: Check for expired groups and update their status
const checkExpirations = async (collection) => {
    const now = new Date();
    await collection.updateMany(
        { status: "active", expiryTime: { $lt: now } },
        { $set: { status: "expired" } }
    );
};

// POST /api/group-buy/start -> Create new group
router.post("/start", async (req, res) => {
    console.log("POST /group-buy/start received:", req.body);
    try {

        const db = req.dbclient.db("UnityShopDB");
        const groupsCollection = db.collection("groupBuys");

        const { productId, creatorId, requiredMembers, discountPercentage } = req.body;

        if (!productId || !creatorId) {
            return res.status(400).json({ message: "Product ID and Creator ID are required" });
        }

        // Check if user already has an active group for this product
        const existingGroup = await groupsCollection.findOne({
            productId,
            members: creatorId,
            status: "active",
            expiryTime: { $gt: new Date() }
        });

        if (existingGroup) {
            return res.status(400).json({ message: "You are already in an active group for this product" });
        }

        const expiryTime = new Date();
        expiryTime.setHours(expiryTime.getHours() + 24); // 24-hour limit

        const newGroup = {
            productId,
            creatorId,
            members: [creatorId],
            requiredMembers: requiredMembers || 3,
            discountPercentage: discountPercentage || 20,
            expiryTime,
            status: "active",
            createdAt: new Date()
        };

        const result = await groupsCollection.insertOne(newGroup);

        res.status(201).json({
            message: "Group buy started successfully",
            groupId: result.insertedId,
            group: newGroup
        });
    } catch (error) {
        res.status(500).json({ message: "Server error", error: error.message });
    }
});

// POST /api/group-buy/join/:groupId -> Join group
router.post("/join/:groupId", async (req, res) => {
    try {
        const db = req.dbclient.db("UnityShopDB");
        const groupsCollection = db.collection("groupBuys");
        const { userId } = req.body;
        const { groupId } = req.params;

        if (!userId) return res.status(400).json({ message: "User ID is required" });

        await checkExpirations(groupsCollection);

        const group = await groupsCollection.findOne({ _id: new ObjectId(groupId) });

        if (!group) return res.status(404).json({ message: "Group not found" });
        if (group.status !== "active") return res.status(400).json({ message: `Group is already ${group.status}` });
        if (group.members.includes(userId)) return res.status(400).json({ message: "You have already joined this group" });

        const updatedMembers = [...group.members, userId];
        const isCompleted = updatedMembers.length >= group.requiredMembers;

        await groupsCollection.updateOne(
            { _id: new ObjectId(groupId) },
            {
                $set: {
                    members: updatedMembers,
                    status: isCompleted ? "completed" : "active"
                }
            }
        );

        // Notify others via Socket.io if needed (req.io)
        if (req.io) {
            req.io.to(groupId).emit("group_updated", {
                groupId,
                membersCount: updatedMembers.length,
                status: isCompleted ? "completed" : "active"
            });
        }

        res.json({
            message: isCompleted ? "Group buy achieved!" : "Joined successfully",
            status: isCompleted ? "completed" : "active"
        });
    } catch (error) {
        res.status(500).json({ message: "Server error", error: error.message });
    }
});

// GET /api/group-buy/:productId -> Get active groups for a product
router.get("/:productId", async (req, res) => {
    try {
        const db = req.dbclient.db("UnityShopDB");
        const groupsCollection = db.collection("groupBuys");
        const { productId } = req.params;

        await checkExpirations(groupsCollection);

        const groups = await groupsCollection.find({
            productId,
            status: "active"
        }).toArray();

        res.json(groups);
    } catch (error) {
        res.status(500).json({ message: "Server error", error: error.message });
    }
});

// POST /group-buy/leave/:groupId -> Leave or Cancel group
router.post("/leave/:groupId", async (req, res) => {
    try {
        const db = req.dbclient.db("UnityShopDB");
        const groupsCollection = db.collection("groupBuys");
        const { userId } = req.body;
        const { groupId } = req.params;

        if (!userId) return res.status(400).json({ message: "User ID is required" });

        const group = await groupsCollection.findOne({ _id: new ObjectId(groupId) });
        if (!group) return res.status(404).json({ message: "Group not found" });

        if (group.creatorId === userId) {
            // If creator leaves, the whole group is canceled
            await groupsCollection.updateOne(
                { _id: new ObjectId(groupId) },
                { $set: { status: "canceled" } }
            );
            return res.json({ message: "Group buy canceled by creator", status: "canceled" });
        }

        // If a member leaves
        const updatedMembers = group.members.filter(id => id !== userId);

        await groupsCollection.updateOne(
            { _id: new ObjectId(groupId) },
            { $set: { members: updatedMembers } }
        );

        res.json({ message: "You have left the group buy", status: "active" });
    } catch (error) {
        res.status(500).json({ message: "Server error", error: error.message });
    }
});

module.exports = router;

