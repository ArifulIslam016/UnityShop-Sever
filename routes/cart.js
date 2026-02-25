const express = require("express");
const { ObjectId } = require("mongodb");
const router = express.Router();

const DB_NAME = "UnityShopDB";
const COLLECTION_NAME = "carts";

router.get("/:userId", async (req, res) => {
  const userId = req.params.userId;
  try {
    const cart = await req.dbclient
      .db(DB_NAME)
      .collection(COLLECTION_NAME)
      .findOne({ userId: new ObjectId(userId) });
    if (!cart) {
      return res.status(404).send({ error: "Cart not found" });
    }
    res.send(cart);
  } catch (error) {
    res.status(500).send({ error: "Failed to fetch cart" });
  }
});
// Add api for add to cart of increase qualtity.
/**Note for post api,, quantity negetive number (-)
 *  is less the quantity and  quantity positive value(+) is increase quantity
 * when quantity is less then 1 the minus (-) button  will be disabled*/
router.post("/add", async (req, res) => {
  const { userId, productId, quantity } = req.body;

  const query = {
    userId: new ObjectId(userId),
    "items.productId": new ObjectId(productId),
  };

  // I cheecked here that product is already exist of not.
  const itemExists = await req.dbclient
    .db(DB_NAME)
    .collection(COLLECTION_NAME)
    .findOne(query);

  if (itemExists) {
    const currentProduct = itemExists.items.find((item) =>
      item.productId.equals(productId),
    );
    // SAFETY CHECK: If current quantity is 1 and user sends -1, REMOVE the item
    if (currentProduct.quantity <= 1 && quantity === -1) {
      const result = await req.dbclient
        .db(DB_NAME)
        .collection(COLLECTION_NAME)
        .updateOne(
          { userId: new ObjectId(userId) },
          { $pull: { items: { productId: new ObjectId(productId) } } },
        );
      return res.send({
        success: true,
        message: "Item removed from cart!",
        result,
      });
    }

    // If product exist i just update quantity here.
    const updateDoc = {
      $inc: { "items.$.quantity": quantity },
      $set: { updatedAt: new Date() },
    };
    await req.dbclient
      .db(DB_NAME)
      .collection(COLLECTION_NAME)
      .updateOne(query, updateDoc);
  } else {
    //New Items will added from here if there is no item in card with same product of this user.
    const filter = { userId: new ObjectId(userId) };
    const updateDoc = {
      $push: { items: { productId: new ObjectId(productId), quantity } },
      $set: { updatedAt: new Date() },
    };
    await req.dbclient
      .db(DB_NAME)
      .collection(COLLECTION_NAME)
      .updateOne(filter, updateDoc, { upsert: true });
  }

  // Real-time update for cart (count in header etc)
  if (req.io) {
    req.io.to(userId).emit("cart-updated", { message: "Item added to cart" });
  }

  res.send({ success: true, message: "Cart Updated!" });
});

// Item delete api for removing item from cart/
router.delete("/remove", async (req, res) => {
  const { userId, productId } = req.body;

  const result = await req.dbclient
    .db(DB_NAME)
    .collection(COLLECTION_NAME)
    .updateOne(
      { userId: new ObjectId(userId) },
      { $pull: { items: { productId: new ObjectId(productId) } } },
    );

  res.send(result);
});

module.exports = router;
