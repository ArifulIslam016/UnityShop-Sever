// utils/aiHelper.js
function generateAIMessage(originalPrice, offerPrice, userMessage) {
  const discount = ((originalPrice - offerPrice) / originalPrice) * 100;
  let aiResponse = "";
  let suggestion = "";

  if (discount <= 10) {
    aiResponse = `Great! Your offer of $${offerPrice} (${discount.toFixed(1)}% discount) has been sent to the seller. You'll be notified when they respond.`;
    suggestion =
      "This is a fair offer. Most sellers accept offers within 10% of the listing price.";
  } else if (discount <= 25) {
    aiResponse = `Your offer of $${offerPrice} (${discount.toFixed(1)}% discount) has been sent to the seller. This is an aggressive offer, so be prepared for negotiation.`;
    suggestion = `Consider starting with a slightly higher offer (around $${(originalPrice * 0.85).toFixed(2)}) to increase your chances of acceptance.`;
  } else {
    const suggested = (originalPrice * 0.85).toFixed(2);
    aiResponse = `Your offer of $${offerPrice} (${discount.toFixed(1)}% discount) is significantly below the listing price. Sellers rarely accept offers this low.`;
    suggestion = `I recommend offering at least $${suggested} to show you're serious about purchasing.`;
  }
  return { aiResponse, suggestion };
}

module.exports = { generateAIMessage };
