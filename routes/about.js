const express = require("express");
const router = express.Router();

router.get("/", (req, res) => {
  res.send("This is the about page.");
});

router.post("/", (req, res) => {
  res.send("This is the about page, but you sent a POST request.");
});

module.exports = router;
