const express = require('express');
const router = express.Router();    

router.get('/h', (req, res) => {
    res.send('This is the h page.');
});     
module.exports = router;