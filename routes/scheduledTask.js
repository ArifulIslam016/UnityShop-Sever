const cron = require('node-cron');
const { ObjectId } = require('mongodb');

const DB_NAME = "UnityShopDB";

/**
 * Periodically checks for ended auctions and moves winning items to users' carts.
 * @param {Object} dbclient - The MongoDB client instance.
 */
const runAuctionCheck = (dbclient) => {
  // Schedule a task to run every minute
  cron.schedule('* * * * *', async () => {
    try {
      const db = dbclient.db(DB_NAME);
      const now = new Date();
      
      console.log("Checking for ended auctions to process winners... ", now.toLocaleString());

      // 1. Fetch products in Auction category that are not yet completed
      // We filter by time inside the loop to ensure reliable comparison
      const auctionProducts = await db.collection("products").find({
        category: "auction",
        status: { $ne: "completed" }
      }).toArray();
      console.log(`Found ${auctionProducts.length} active auction products to check.`);
      for (const product of auctionProducts) {
        // Convert the stored endAt value to a JavaScript Date object
        const auctionEndTime = new Date(product.endAt);

        // Check if the current time is greater than or equal to auction end time
        if (auctionEndTime <= now) {
          
          if (product.highestBidderEmail) {
            
            // 2. Fetch winner's userId using their email
            const user = await db.collection("users").findOne({ email: product.highestBidderEmail });

            if (user) {
              const userId = user._id;
              const productId = product._id;
              console.log(userId)

              // 3. Update or create the user's cart (Upsert)
              await db.collection("carts").updateOne(
                { userId: new ObjectId(userId) },
                { 
                  $push: { 
                    items: { 
                      productId: new ObjectId(productId), 
                      quantity: 1, 
                      isAuctionWin: true, 
                      winPrice: product.currentHighestBId || product.price 
                    } 
                  },
                  $set: { updatedAt: new Date() }
                },
                { upsert: true }
              );

              console.log(`Success: ${product.name} added to the cart of winner: ${user.name}`);
            } else {
              console.log(`Error: User record not found for email: ${product.highestBidderEmail}`);
            }

            // 4. Mark product as completed after processing winner
            await db.collection("products").updateOne(
              { _id: product._id },
              { $set: { status: "completed" } }
            );

          } else {
            // Mark as expired if no one placed a bid
            await db.collection("products").updateOne(
              { _id: product._id },
              { $set: { status: "expired" } }
            );
            console.log(`Auction ended for ${product.name} with no bidders.`);
          }
        }
      }
    } catch (err) {
      console.error("Auction Cron Error:", err);
    }
  });
};

module.exports = runAuctionCheck;