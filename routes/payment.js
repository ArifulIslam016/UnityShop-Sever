const express = require('express');
const router = express.Router();
require('dotenv').config();
const crypto = require('crypto');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

function generateTracingId() {
  return crypto.randomBytes(16).toString('hex');
}

// ─── Helper: calculate estimated delivery (5 days from now) ───
function calculateEstimatedDelivery() {
  const date = new Date();
  date.setDate(date.getDate() + 5);
  return date;
}

router.post('/create-checkout-session', async (req, res) => {
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
    line_items: [
      {
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

router.patch('/retrivedsessionAfterPayment', async (req, res) => {
  const { session_id } = req.query;

  try {
    const session = await stripe.checkout.sessions.retrieve(session_id);
    console.log('retrivedsessionAfterPayment/:', session);

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
      .db('UnityShopDB')
      .collection('paidOrders')
      .findOne({ transitionId: paymentintent });

    if (IsExist) {
      return res.status(200).json({ message: 'Order already processed.' });
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
      status: 'New',
      deliveryPartner: 'Pathao Courier',
      estimatedDeliveryDate: calculateEstimatedDelivery(),
      statusHistory: [
        {
          status: 'New',
          label: 'Order Confirmed',
          updatedAt: new Date(),
        },
      ],
      // ──────────────────────────────────────────────────────

      createdAt: new Date(),
    };
    // ─────────────────────────────────────────────────────────

    const result = await req.dbclient
      .db('UnityShopDB')
      .collection('paidOrders')
      .insertOne(orderData);

    // ─── Real-time Notifications ──────────────────────────────
    const notifCollection = req.dbclient
      .db('UnityShopDB')
      .collection('notifications');

    // 1. Notify Customer: Payment Successful / Order Confirmed
    if (customerEmail) {
      const customerNotif = {
        email: customerEmail,
        type: 'payment_success',
        title: 'Order Confirmed!',
        message: `Payment successful for ${metadata.productName}. Amount: $${amountpaid}`,
        read: false,
        createdAt: new Date(),
      };

      try {
        await notifCollection.insertOne(customerNotif);
        if (req.io) {
          console.log(
            `Emitting payment_success to ${customerEmail.toLowerCase()}`,
          );
          req.io
            .to(customerEmail.toLowerCase())
            .emit('notification', customerNotif);
        } else {
          console.error('Socket.io instance not found on request object!');
        }
      } catch (err) {
        console.error('Error sending customer notification:', err);
      }
    }

    // 2. Notify Seller: New Order
    if (metadata.sellerEmail) {
      const sellerNotif = {
        email: metadata.sellerEmail,
        type: 'order_confirmed',
        title: 'New Order Received!',
        message: `Start packing! You sold ${metadata.productName} to ${CustomerName}.`,
        read: false,
        createdAt: new Date(),
      };

      try {
        await notifCollection.insertOne(sellerNotif);
        if (req.io) {
          console.log(
            `Emitting order_confirmed to ${metadata.sellerEmail.toLowerCase()}`,
          );
          req.io
            .to(metadata.sellerEmail.toLowerCase())
            .emit('notification', sellerNotif);
        }
      } catch (err) {
        console.error('Error sending seller notification:', err);
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
