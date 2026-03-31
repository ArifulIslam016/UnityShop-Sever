const express = require("express");
const { ObjectId } = require("mongodb");
const router = express.Router();

// Submit a delivery partner request
router.post("/", async (req, res) => {
    try {
        const db = req.dbclient.db("UnityShopDB");
        const requestsCollection = db.collection("deliveryRequests");
        const usersCollection = db.collection("users");

        const {
            nidNumber,
            vehicleType,
            drivingLicense,
            preferredArea,
            experience,
            email,
            name
        } = req.body;

        // Check if user exists
        const user = await usersCollection.findOne({ email });
        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }

        // Check if there's already a pending or approved request
        const existingRequest = await requestsCollection.findOne({
            email,
            status: { $in: ["pending", "approved"] },
        });

        if (existingRequest) {
            return res.status(400).json({
                message: "You already have a pending or approved delivery partner request",
            });
        }

        const newRequest = {
            userId: user._id,
            name,
            email,
            nidNumber,
            vehicleType,
            drivingLicense: drivingLicense || null,
            preferredArea,
            experience: Number(experience) || 0,
            status: "pending",
            requestedAt: new Date(),
            updatedAt: new Date(),
        };

        const result = await requestsCollection.insertOne(newRequest);

        // Update user record to sync status
        await usersCollection.updateOne(
            { email },
            { $set: { deliveryRequest: "pending", updatedAt: new Date() } }
        );

        res.status(201).json({
            message: "Delivery partner request submitted successfully",
            requestId: result.insertedId,
        });
    } catch (error) {
        res.status(500).json({ message: "Server error", error: error.message });
    }
});

// Admin: Get all delivery requests
router.get("/admin", async (req, res) => {
    try {
        const db = req.dbclient.db("UnityShopDB");
        const status = req.query.status;
        const query = status && status !== "all" ? { status } : {};

        const requests = await db
            .collection("deliveryRequests")
            .find(query)
            .sort({ requestedAt: -1 })
            .toArray();

        res.json(requests);
    } catch (error) {
        res.status(500).json({ message: "Server error", error: error.message });
    }
});

// Admin: Approve/Reject a delivery request
router.patch("/admin/:id", async (req, res) => {
    try {
        const id = req.params.id;
        const { status, rejectionReason } = req.body;

        if (!["approved", "rejected"].includes(status)) {
            return res.status(400).json({ message: "Invalid status" });
        }

        const db = req.dbclient.db("UnityShopDB");
        const requestsCollection = db.collection("deliveryRequests");
        const usersCollection = db.collection("users");

        const request = await requestsCollection.findOne({ _id: new ObjectId(id) });
        if (!request) {
            return res.status(404).json({ message: "Request not found" });
        }

        const updateFields = { status, updatedAt: new Date() };
        if (status === "rejected" && rejectionReason) {
            updateFields.rejectionReason = rejectionReason;
        }

        await requestsCollection.updateOne(
            { _id: new ObjectId(id) },
            { $set: updateFields }
        );

        // Update user role and status
        const userUpdate = {
            deliveryRequest: status,
            updatedAt: new Date(),
        };

        if (status === "approved") {
            // Keep existing role if it's admin, otherwise make them delivery
            const user = await usersCollection.findOne({ email: request.email });
            if (user && user.role !== "admin") {
                userUpdate.role = "delivery";
            }
            userUpdate.deliveryApprovedAt = new Date();
        }

        await usersCollection.updateOne({ email: request.email }, { $set: userUpdate });

        // Notification logic
        if (req.io) {
            const notification = {
                email: request.email,
                type: status === "approved" ? "delivery_approved" : "delivery_rejected",
                title: status === "approved" ? "Delivery Partner Approved!" : "Delivery Application Rejected",
                message: status === "approved"
                    ? "Congratulations! You are now a delivery partner."
                    : `Your request was rejected. ${rejectionReason || "Please contact support for more information."}`,
                read: false,
                createdAt: new Date(),
            };
            await db.collection("notifications").insertOne(notification);
            req.io.to(request.email.toLowerCase()).emit("notification", notification);
        }

        res.json({ message: `Delivery request ${status} successfully` });
    } catch (error) {
        res.status(500).json({ message: "Server error", error: error.message });
    }
});

module.exports = router;
