require("dotenv").config();
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const { MongoClient, ServerApiVersion } = require("mongodb");
const mongoose = require("mongoose");

const app = express();
const port = process.env.PORT || 5000;
const DEBUG_SOCKET = process.env.DEBUG_SOCKET === "true";

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
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// Inject socket into every request
app.use((req, res, next) => {
  req.io = io;
  next();
});

// ================= MongoDB Connection =================
const uri = process.env.MONGODB_URL;
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

let isConnected = false;
let dbClient = null;

async function connectToDatabase() {
  if (!isConnected) {
    await client.connect();
    // Connect Mongoose
    await mongoose.connect(uri, {
      serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
      },
    });
    isConnected = true;
    dbClient = client;
    console.log("✅ Successfully connected to MongoDB!");
    const runAuctionCheck = require("./routes/scheduledTask");
    runAuctionCheck(client); // Start the scheduled task for auction checks
  }
  return dbClient;
}

// Attach db client to every request (already connected)
app.use((req, res, next) => {
  req.dbclient = dbClient;
  next();
});

// ================= Routes =================
const aboutRoutes = require("./routes/about");
const contactRoutes = require("./routes/contact");
const homeRoutes = require("./routes/home");
const usersRoutes = require("./routes/users");
const productRoutes = require("./routes/product");
const cartRoutes = require("./routes/cart");
const authRoutes = require("./routes/auth");
const ordersRoutes = require("./routes/orders");
const promoRoutes = require("./routes/promo");

app.get("/", (req, res) => {
  res.send("Welcome to the UnityShop API!");
});

app.use("/about", aboutRoutes);
app.use("/contact", contactRoutes);
app.use("/home", homeRoutes);
app.use("/users", usersRoutes);
app.use("/auth", authRoutes);
app.use("/payment", require("./routes/payment"));
app.use("/products", productRoutes);
// app.use("/product", productRoutes);
app.use("/orders", ordersRoutes);
app.use("/cart", cartRoutes);
app.use("/notifications", require("./routes/notifications"));
app.use("/upload", require("./routes/upload"));
app.use("/seller-requests", require("./routes/sellerRequests"));
app.use("/group-buy", require("./routes/groupBuy"));
app.use("/promo", promoRoutes);
app.use("/reviews", require("./routes/reviews"));
app.use("/bids", require("./routes/bids"));

// AI Routes
const aiRoutes = require("./routes/ai");
app.use("/api/ai", aiRoutes);

// Negotiation Routes
const negotiationRoutes = require("./routes/negotiations");
app.use("/api/negotiations", negotiationRoutes);

// ================= Socket Handlers =================
const productViewerSocket = require("./sockets/productViewer");

io.on("connection", (socket) => {
  if (DEBUG_SOCKET) {
    console.log("Client connected:", socket.id);
  }
  socket.on("join", (room) => {
    if (room) {
      socket.join(room);
      if (DEBUG_SOCKET) {
        console.log(`Socket ${socket.id} joined room: ${room}`);
      }
    }
  });
  productViewerSocket(io, socket);
  socket.on("disconnect", () => {
    if (DEBUG_SOCKET) {
      console.log("Client disconnected:", socket.id);
    }
  });
});

// ================= Start Server after DB Connection =================
async function startServer() {
  try {
    await connectToDatabase(); // Wait for DB connection
    server.listen(port, () => {
      console.log(`🚀 Server running on port ${port}`);
    });
  } catch (err) {
    console.error("❌ Failed to connect to database:", err);
    process.exit(1);
  }
}

startServer();

module.exports = app;
