const express = require("express");
const router = express.Router();
require('dotenv').config();
const crypto = require('crypto');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { ObjectId } = require('mongodb');

function generateTracingId() {
  return crypto.randomBytes(16).toString("hex");
}

// ─── Helper: calculate estimated delivery (5 days from now) ───
function calculateEstimatedDelivery() {
  const date = new Date();
  date.setDate(date.getDate() + 5);
  return date;
}

router.post("/create-checkout-session", async (req, res) => {
  const {
    price,
    productId,
    quantity,
    productName,
    userEmail,
    userId,
    sellerName,
    sellerEmail,
    shippingAddress,
    phoneNumber,
    breakdown,
  } = req.body;

  const metadataObject = {
    productId: productId,
    productName: productName,
    sellerName: sellerName,
    sellerEmail: sellerEmail,
    userId: userId || '',
    paidAmount: parseInt(price * quantity),
    quantity:quantity,
    paidAt: new Date().toISOString(),
    shippingAddress: shippingAddress ? JSON.stringify(shippingAddress) : '{}',
    phoneNumber: phoneNumber || '',
    breakdown: breakdown ? JSON.stringify(breakdown) : '{}',
  };

  // Construct line items based on breakdown if available
  let line_items = [];
  if (breakdown) {
    // Product Price
    line_items.push({
      price_data: {
        currency: 'USD',
        unit_amount: parseInt(breakdown.subtotal * 100), // Base product cost
        product_data: {
          name: productName,
          description: `Sold by: ${sellerName}`,
        },
      },
      quantity: 1,
    });
    // Shipping
    if (breakdown.shipping > 0) {
      line_items.push({
        price_data: {
          currency: 'USD',
          product_data: { name: 'International Shipping' },
          unit_amount: parseInt(breakdown.shipping * 100),
        },
        quantity: 1,
      });
    }
    // Customs
    if (breakdown.customs > 0) {
      line_items.push({
        price_data: {
          currency: 'USD',
          product_data: { name: 'Est. Customs & Duty' },
          unit_amount: parseInt(breakdown.customs * 100),
        },
        quantity: 1,
      });
    }
    // Platform Fee
    if (breakdown.platform > 0) {
      line_items.push({
        price_data: {
          currency: 'USD',
          product_data: { name: 'Platform Fee' },
          unit_amount: parseInt(breakdown.platform * 100),
        },
        quantity: 1,
      });
    }
  } else {
    // Fallback
    line_items = [
      {
        price_data: {
          currency: "USD",
          unit_amount: parseInt(price * 100),
          product_data: {
            name: productName,
            description: `Sold by: ${sellerName}. Thank you for shopping with Unity Shop!`,
          },
        },
        quantity: parseInt(quantity),
      },
    ];
  }

  const session = await stripe.checkout.sessions.create({
    line_items: line_items,
    customer_email: userEmail,
    metadata: metadataObject,
    mode: "payment",
    success_url: `${process.env.SITE_DOMAIN}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${process.env.SITE_DOMAIN}/payment-cancel`,
  });

  res.send({ url: session.url });
});

router.patch("/retrivedsessionAfterPayment", async (req, res) => {
  const { session_id } = req.query;

  try {
    const session = await stripe.checkout.sessions.retrieve(session_id);
    // console.log("retrivedsessionAfterPayment/:", session);

    const amountpaid = session.amount_total / 100;
    const customerEmail = session.customer_email;
    const CustomerName = session.customer_details.name;
    const metadata = session.metadata;
    const paymentintent = session.payment_intent;
    const presentment_details = session.presentment_details;
    const paymentStatus = session.payment_status;
    const cancelUrl = session.cancel_url;

    // Prevent duplicate order processing
    const IsExist = await req.dbclient
      .db("UnityShopDB")
      .collection("paidOrders")
      .findOne({ transitionId: paymentintent });

    if (IsExist) {
      return res.status(200).json({ message: "Order already processed." });
    }

    // ─────────────────────────────────────────────────────────
    // ORDER DATA — tracking fields added here
    // ─────────────────────────────────────────────────────────
    const orderData = {
      amountPaid: amountpaid,
      customerEmail,
      customerName: CustomerName,
      transitionId: paymentintent,
      productId: metadata.productId,
      productName: metadata.productName,
      sellerName: metadata.sellerName,
      sellerEmail: metadata.sellerEmail,
      quantity: Number(metadata.paidAmount) / Number(amountpaid) || 1,
      paymentStatus,

      // ── Order Tracking Fields (NEW) ────────────────────────
      status: "New",
      deliveryPartner: "Pathao Courier",
      estimatedDeliveryDate: calculateEstimatedDelivery(),
      statusHistory: [
        {
          status: "New",
          label: "Order Confirmed",
          updatedAt: new Date(),
        },
      ],
      // ──────────────────────────────────────────────────────

      createdAt: new Date(),
    };
    // ─────────────────────────────────────────────────────────

    const result = await req.dbclient
      .db("UnityShopDB")
      .collection("paidOrders")
      .insertOne(orderData);
    // product quantity less here
    // console.log(session.metadata)

    // await req.dbclient
    //   .db("UnityShopDB")
    //   .collection("products") // Apnar product collection-er nam check kore niben
    //   .updateOne(
    //     { _id:new ObjectId(session.metadata.productId) },
    //     { $inc: { stock: -parseInt(session.metadata.quantity) } }, // Database-er stock theke minus hobe
    //   );

// ১. আইডি এবং কোয়ান্টিটি আগে ভেরিয়েবলে নিন
const targetProductId = session.metadata.productId;
const buyQuantity = parseInt(session.metadata.quantity) || 1; 

// console.log("Checking for Product ID:", targetProductId);
// console.log("Quantity to reduce:", buyQuantity);

try {
  // ২. আপডেট অপারেশন
  const updateResult = await req.dbclient
    .db("UnityShopDB")
    .collection("products")
    .updateOne(
      { _id: new ObjectId(targetProductId) }, 
      { $inc: { stock: -buyQuantity } } 
    );

  // ৩. চেক করা আপডেট হলো কি না
  if (updateResult.modifiedCount > 0) {
    // console.log("stock reduced");
  } else {
    // console.log("No stockupdated. Check if Product ID exists and quantity is valid.");
  }
} catch (dbError) {
  // console.error("🛑 dbError.message);
}



// jjjjjjjjjjjjjjjjjjjjjjjjjjjj





    // ─── BACKEND CART CLEARING (Redundancy if frontend fails) ───────────────
    // If userId is provided in metadata, clear all the purchased items from cart
    if (metadata.userId && metadata.productId) {
      try {
        const userId = metadata.userId;
        const productIds = metadata.productId.split(',').map(id => id.trim());

        // Extract product IDs (they might be comma-separated)
        // Clear each product from the user's cart
        for (const prodId of productIds) {
          try {
            const objectId = new ObjectId(prodId);
            await req.dbclient
              .db('UnityShopDB')
              .collection('carts')
              .updateOne(
                { userId: new ObjectId(userId) },
                { $pull: { items: { productId: objectId } } },
              );
            console.log(
              `[Payment] Cleared product ${prodId} from cart for user ${userId}`,
            );
          } catch (err) {
            console.warn(
              `[Payment] Could not clear product ${prodId}:`,
              err.message,
            );
          }
        }
      } catch (err) {
        console.error('[Payment] Error clearing cart from backend:', err);
        // Don't fail the order for this
      }
    }

    // ─── Real-time Notifications ──────────────────────────────
    const notifCollection = req.dbclient
      .db("UnityShopDB")
      .collection("notifications");

    // 1. Notify Customer: Payment Successful / Order Confirmed
    if (customerEmail) {
      const customerNotif = {
        email: customerEmail,
        type: "payment_success",
        title: "Order Confirmed!",
        message: `Payment successful for ${metadata.productName}. Amount: $${amountpaid}`,
        read: false,
        createdAt: new Date(),
      };

      try {
        await notifCollection.insertOne(customerNotif);
        if (req.io) {
          req.io
            .to(customerEmail.toLowerCase())
            .emit("notification", customerNotif);
        } else {
          console.error("Socket.io instance not found on request object!");
        }
      } catch (err) {
        console.error("Error sending customer notification:", err);
      }
    }

    // 2. Notify Seller: New Order
    if (metadata.sellerEmail) {
      const sellerNotif = {
        email: metadata.sellerEmail,
        type: "order_confirmed",
        title: "New Order Received!",
        message: `Start packing! You sold ${metadata.productName} to ${CustomerName}.`,
        read: false,
        createdAt: new Date(),
      };

      try {
        await notifCollection.insertOne(sellerNotif);
        if (req.io) {
          req.io
            .to(metadata.sellerEmail.toLowerCase())
            .emit("notification", sellerNotif);
        }
      } catch (err) {
        console.error("Error sending seller notification:", err);
      }
    }

    res.send({
      status: session.status,
      payment_status: session.payment_status,
      metadata: session.metadata,
      customer_email: session.customer_email,
    });
  } catch (error) {
    res.status(500).send({ error: error.message });
  }
});

module.exports = router;
