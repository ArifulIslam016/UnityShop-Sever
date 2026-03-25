require("dotenv").config();
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const { MongoClient, ServerApiVersion } = require("mongodb");

const app = express();
const port = process.env.PORT || 5000;

// Create HTTP server
const server = http.createServer(app);

// Initialize Socket.io
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE"],
  },
});

// Middleware
app.use(cors());
app.use(express.json());

// Inject socket into every request
app.use((req, res, next) => {
  req.io = io;
  next();
});

// MongoDB Connection
const uri = process.env.MONGODB_URL;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

let connectionPromise = null;

async function connectToDatabase() {
  if (!connectionPromise) {
    connectionPromise = client.connect().then(() => {
      console.log("Successfully connected to MongoDB!");
      runAuctionCheck(client); // Start the scheduled task for auction checks
      return client;
    });
  }
  return connectionPromise;
}

// Ensure DB connected before request
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

// Routes
const aboutRoutes = require("./routes/about");
const contactRoutes = require("./routes/contact");
const homeRoutes = require("./routes/home");
const usersRoutes = require("./routes/users");
const productRoutes = require("./routes/product");
const cartRoutes = require("./routes/cart");
const authRoutes = require("./routes/auth");
const ordersRoutes = require("./routes/orders");
const promoRoutes = require("./routes/promo");
const runAuctionCheck = require("./routes/scheduledTask");
// Root endpoint
app.get("/", (req, res) => {
  res.send("Welcome to the UnityShop API!");
});

// Route handlers
app.use("/about", aboutRoutes);
app.use("/contact", contactRoutes);
app.use("/home", homeRoutes);
app.use("/users", usersRoutes);
app.use("/auth", authRoutes);
app.use("/payment", require("./routes/payment"));
app.use("/products", productRoutes);
app.use("/product", productRoutes);
app.use("/orders", ordersRoutes);
app.use("/cart", cartRoutes);
app.use("/notifications", require("./routes/notifications"));
app.use("/upload", require("./routes/upload"));
app.use("/seller-requests", require("./routes/sellerRequests"));
app.use("/group-buy", require("./routes/groupBuy"));
app.use("/promo", promoRoutes);
app.use("/reviews", require("./routes/reviews"));
app.use("/bids", require("./routes/bids"));
// app.use('/scheduled-tasks', require('./routes/scheduledTask'));

// Import Socket Handlers
const productViewerSocket = require("./sockets/productViewer");

// Socket Connection
io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

  // General room join system
  socket.on("join", (room) => {
    if (room) {
      socket.join(room);
      console.log(`Socket ${socket.id} joined room: ${room}`);
    }
  });

  // Product live viewer tracking
  productViewerSocket(io, socket);

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
  });
});

// Start Server
// Start Server and Database Connection immediately
server.listen(port, async () => {
  console.log(`Server running on port ${port}`);
  try {
    // Ensure DB connection is established at startup
    await connectToDatabase();
  } catch (err) {
    console.error("Initial DB connection failed:", err);
  }
});
module.exports = app;
