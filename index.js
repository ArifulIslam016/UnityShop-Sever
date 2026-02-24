const cors = require("cors");
require("dotenv").config();
const express = require("express");
const app = express();
const port = process.env.PORT || 5000;

const { MongoClient, ServerApiVersion } = require("mongodb");
app.use(cors());
app.use(express.json());

const uri = process.env.MONGODB_URL;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

// Cache the connection promise for serverless (Vercel)
let connectionPromise = null;

async function connectToDatabase() {
  if (!connectionPromise) {
    connectionPromise = client.connect().then(() => {
      console.log("Successfully connected to MongoDB!");
      return client;
    });
  }
  return connectionPromise;
}

// Middleware: ensure MongoDB is connected before handling any request
app.use(async (req, res, next) => {
  try {
    await connectToDatabase();
    req.dbclient = client;
    next();
  } catch (error) {
    console.error("MongoDB connection error:", error);
    res.status(500).json({ error: "Database connection failed" });
  }
});

// Import routes
const aboutRoutes = require("./routes/about");
const contactRoutes = require("./routes/contact");
const homeRoutes = require("./routes/home");
const usersRoutes = require("./routes/users");
const productRoutes = require("./routes/product");
const catRoutes = require("./routes/cart");
const authRoutes = require("./routes/auth");
const ordersRoutes = require("./routes/orders");

// Register routes at the top level (NOT inside an async function)
app.get("/", (req, res) => {
  res.send("Hello World!");
});

app.use("/about", aboutRoutes);
app.use("/contact", contactRoutes);
app.use("/home", homeRoutes);
app.use("/users", usersRoutes);
app.use("/auth", authRoutes);
app.use("/payment", require("./routes/payment"));
app.use("/products", productRoutes);
app.use("/orders", ordersRoutes);
app.use("/product", productRoutes);
app.use("/cart", catRoutes);

// For local development only
if (process.env.NODE_ENV !== "production") {
  app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
  });
}

module.exports = app;
