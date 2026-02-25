const cors = require("cors");
require("dotenv").config();
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const app = express();
const port = process.env.PORT || 5000;

// Initialize Socket.io
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // Allow all origins
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE"],
  },
});

const { MongoClient, ServerApiVersion } = require("mongodb");
app.use(cors());
app.use(express.json());

// Inject io into request object
app.use((req, res, next) => {
  req.io = io;
  next();
});

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
app.use("/notifications", require("./routes/notifications"));


if (process.env.NODE_ENV !== "production") {
  server.listen(port, () => {
    console.log(`Server listening on port ${port}`);
  });
}

// Socket.io connection logging
io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);
  
  socket.on("join", (room) => {
    if (room) {
      socket.join(room);
      console.log(`Socket ${socket.id} joined room: ${room}`);
    }
  });


  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
  });
});

module.exports = app;

