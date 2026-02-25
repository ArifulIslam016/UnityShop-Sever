const express = require('express');
const router = express.Router();
require("dotenv").config();
const crypto = require("crypto");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
// app.use(express.static("public"));

function generateTracingId() {
  return crypto.randomBytes(16).toString('hex');
}

const YOUR_DOMAIN = "http://localhost:5173";

router.post("/create-checkout-session", async (req, res) => {
  const {
    price,
    productId,
    quantity,
    productName,
    userEmail,
    sellerName,
    sellerEmail,
  } = req.body;
  const metadataObject = {
    productId: productId,
    productName: productName,
    sellerName: sellerName,
    sellerEmail: sellerEmail,
    paidAmount: parseInt(price * quantity),
    paidAt: new Date().toISOString(),
  };
  const session = await stripe.checkout.sessions.create({
    // ui_mode: "custom",
    line_items: [
      {
        // Provide the exact Price ID (for example, price_1234) of the product you want to sell
        price_data: {
          currency: 'USD',
          unit_amount: parseInt(price * 100),
          product_data: {
            name: productName,
            description: `Sold by: ${sellerName}. Thank you for shopping with Unity Shop!`,
          },
        },
        quantity: parseInt(quantity),
      },
    ],
    customer_email: userEmail,
    metadata: metadataObject,

    mode: 'payment',
    success_url: `${process.env.SITE_DOMAIN}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${process.env.SITE_DOMAIN}/payment-cancel`,
  });

  res.send({ url: session.url });
});

router.patch("/retrivedsessionAfterPayment", async (req, res) => {
  const { session_id } = req.query;

  try {
    const session = await stripe.checkout.sessions.retrieve(session_id);
    console.log("retrivedsessionAfterPayment/:", session);
    const amountpaid = session.amount_total / 100;
    const customerEmail = session.customer_email;
    const CustomerName = session.customer_details.name;
    const metadata = session.metadata;
    const paymentintent =
      session.payment_intent; /* I will use it ass like transition id*/
    const presentment_details =
      session.presentment_details; /* Local amout here*/
    const paymentStatus = session.payment_status;
    const cancelUrl = session.cancel_url;
    const IsExist = await req.dbclient
      .db("UnityShopDB")
      .collection("paidOrders")
      .findOne({ transitionId: paymentintent }); // Fixed casing: transitionId
    if (IsExist) {
      return res.status(200).json({ message: "Order already processed." });
    }

    const orderData = {
      amountPaid: amountpaid,
      customerEmail,
      customerName: CustomerName,
      transitionId: paymentintent,
      productId: metadata.productId,
      productName: metadata.productName,
      sellerName: metadata.sellerName,
      sellerEmail: metadata.sellerEmail,
      quantity: Number(metadata.paidAmount) / Number(amountpaid) || 1, // Ensure number division
      paymentStatus,
      status: "New",
      createdAt: new Date(),
    };

    const result = await req.dbclient
      .db("UnityShopDB")
      .collection("paidOrders")
      .insertOne(orderData);

    // ─── Notification Logic ─────────────────────────────────────────────
    if (req.io) {
      // 1. Notify Buyer
      const buyerNotification = {
        email: customerEmail,
        type: "payment_success",
        title: "Payment Successful",
        message: `You have successfully paid for ${metadata.productName}.`,
        read: false,
        createdAt: new Date(),
      };

      // Save to DB
      await req.dbclient
        .db("UnityShopDB")
        .collection("notifications")
        .insertOne(buyerNotification);

      // Emit to Buyer's Room
      req.io
        .to(customerEmail.toLowerCase())
        .emit("notification", buyerNotification);

      // 2. Notify Seller
      if (metadata.sellerEmail) {
        const sellerNotification = {
          email: metadata.sellerEmail,
          type: "order_confirmed",
          title: "New Order Received",
          message: `You have a new order for ${metadata.productName} from ${CustomerName}.`,
          read: false,
          createdAt: new Date(),
        };

        // Save to DB
        await req.dbclient
          .db("UnityShopDB")
          .collection("notifications")
          .insertOne(sellerNotification);

        // Emit to Seller's Room
        req.io
          .to(metadata.sellerEmail.toLowerCase())
          .emit("notification", sellerNotification);
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
