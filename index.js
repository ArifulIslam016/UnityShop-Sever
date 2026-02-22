const cors = require("cors");
require("dotenv").config();
const express = require("express");
const app = express();
const port = process.env.PORT || 5000;

// const aboutRoutes = require("./routes/about");
// const contactRoutes = require("./routes/contact");
// const homeRoutes = require("./routes/home");
// const usersRoutes = require("./routes/users");

const { MongoClient, ServerApiVersion } = require("mongodb");
app.use(cors());
app.use(express.json());

const uri = process.env.MONGODB_URL;
console.log(uri);
// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});
app.use((req, res, next) => {
  req.dbclient = client;
  next();
});

const aboutRoutes = require("./routes/about");
const contactRoutes = require("./routes/contact");
const homeRoutes = require("./routes/home");
const usersRoutes = require("./routes/users");
const productRoutes = require("./routes/product");
const authRoutes = require("./routes/auth");
async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();
    app.get("/", (req, res) => {
      res.send("Hello World!");
    });

    app.use("/about", aboutRoutes);
    app.use("/contact", contactRoutes);
    app.use("/home", homeRoutes);
    app.use("/users", usersRoutes);
    app.use("/auth", authRoutes);
    app.use("/payment", require("./routes/payment"));
    app.use("/product", productRoutes);
    app.listen(port, () => {
      console.log(`Example app listening on port ${port}`);
    });

    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!",
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);
