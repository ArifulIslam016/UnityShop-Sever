const express = require("express");
const router = express.Router();

router.get("/", (req, res) => {
  res.send("This is the contact page.");
});

router.post("/", (req, res) => {
  res.send("This is the contact page, but you sent a POST request.");
});

module.exports = router;
