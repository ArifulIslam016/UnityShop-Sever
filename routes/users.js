const experss = require('express');
const { ObjectId } = require('mongodb');
const router = experss.Router();
// Get All users Api
router.get('/', async (req, res) => {
    try {
        const users = await req.dbclient.db("UnityShopDB").collection("users").find().toArray();
        res.send(users);
    } catch (error) {
        res.status(500).send(error);
    }
});
// User create api
router.post('/', async (req, res) => {
    try {
        const newUser = req.body;
        newUser.createdAt = new Date();
        newUser.role = newUser.role || 'user';
        const result = await req.dbclient.db("UnityShopDB").collection("users").insertOne(newUser);
        res.send(result);
    } catch (error) {
        res.status(500).send(error);
    }
});

router.patch('/:id', async (req, res) => {
    try {
        const id = req.params.id;
        const updatedDoc = { $set: req.body };
        const result = await req.dbclient.db("UnityShopDB").collection("users").updateOne(
            { _id: new ObjectId(id) },
            updatedDoc
        );
        res.send(result);
    } catch (error) {
        res.status(500).send(error);
    }
});

router.delete('/:id', async (req, res) => {
    try {
        const id = req.params.id;
        const result = await req.dbclient.db("UnityShopDB").collection("users").deleteOne({
            _id: new ObjectId(id)
        });
        res.send(result);
    } catch (error) {
        res.status(500).send(error);
    }
});
router.get('/:id', async (req, res) => {
    try {
        const id = req.params.id;           
        const user = await req.dbclient.db("UnityShopDB").collection("users").findOne({
            _id: new ObjectId(id)
        });
        res.send(user);
    } catch (error) {
        res.status(500).send(error);
    }           
});

module.exports = router;