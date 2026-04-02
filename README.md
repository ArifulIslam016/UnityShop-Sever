<div align="center">

# ✦ Unity Shop — Backend API ✦

### _The Intelligence & Logistics Core of Unity Shop_

_A robust Node.js, Express 5, and Socket.io server powering real-time bidding, multi-vendor operations, and AI intelligence._

---

[![Node.js](https://img.shields.io/badge/Node.js-20%2B-339933?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org/)
[![Express](https://img.shields.io/badge/Express-5.x-000000?style=for-the-badge&logo=express&logoColor=white)](https://expressjs.com/)
[![MongoDB](https://img.shields.io/badge/MongoDB-Mongoose-47A248?style=for-the-badge&logo=mongodb&logoColor=white)](https://mongodb.com/)
[![Socket.io](https://img.shields.io/badge/Socket.io-Realtime-010101?style=for-the-badge&logo=socket.io&logoColor=white)](https://socket.io/)
[![JWT](https://img.shields.io/badge/JWT-Auth-000000?style=for-the-badge&logo=jsonwebtokens&logoColor=white)](https://jwt.io/)
[![OpenAI](https://img.shields.io/badge/OpenAI-GenAI-412991?style=for-the-badge&logo=openai&logoColor=white)](https://openai.com/)

</div>

---

## 📖 Table of Contents

| #   | Section                                              |
| --- | ---------------------------------------------------- |
| 01  | [✦ Overview](#-overview)                             |
| 02  | [⚡ Tech Stack & Libraries](#-tech-stack--libraries) |
| 03  | [⚙️ Core Modules](#-core-modules)                    |
| 04  | [🔌 API Routes Overview](#-api-routes-overview)      |
| 05  | [📁 Directory Structure](#-directory-structure)      |
| 06  | [🔑 Environment Variables](#-environment-variables)  |
| 07  | [🚀 Getting Started](#-getting-started)              |

---

## ✦ Overview

The **Unity Shop Backend** is a highly scalable, event-driven REST API constructed to manage complex multi-tenant e-commerce workflows. It serves as the central nervous system for the Unity Shop platform, securely channeling data between the Next.js frontend client, the MongoDB database, and various 3rd-party services (AI LLMs, Cloudinary, Payment Gateways).

It features a heavily guarded Role-Based Access Control (RBAC) middleware, enabling strict boundaries between ordinary Users, Sellers, Delivery agents, Managers, and Admins.

---

## ⚡ Tech Stack & Libraries

| Dependency          | Role / Purpose                                                                 |
| ------------------- | ------------------------------------------------------------------------------ |
| **Express.js**      | High-performance web framework for handling API routing.                       |
| **Mongoose**        | Object Data Modeling (ODM) for MongoDB schema enforcement.                     |
| **Socket.io**       | Bidirectional events for live product viewers, chat, and real-time bidding.    |
| **JSONWebToken**    | Stateless authentication protocol for session validation.                      |
| **Bcrypt.js**       | Cryptographic hashing for secure user password storage.                        |
| **OpenAI / Gemini** | Generative AI integration for `AINegoBot` and conversational support features. |
| **Cloudinary**      | Asset management and dynamic media URL generation.                             |
| **Node-Cron**       | Time-based task schedulers for ending flash sales or group buys automatically. |
| **Nodemailer**      | SMTP protocol mailer for order invoices and verification links.                |

---

## ⚙️ Core Modules

### 🤖 AI Processing (`/utils/aiHelper.js`)

Serves as the central AI liaison computing prompts and formatting context for:

- **AINegoBot:** Evaluates customer bids against seller profit margins mathematically and returns natural conversational counter-offers.
- **CostEngine:** Analyzes distances, dimensions, and locale to generate predictive delivery expenses.

### 📡 WebSocket Interactivity (`/sockets`)

Manages rooms and namespace groups to broadcast:

- Active live product viewers (e.g., "14 people are looking at this right now!").
- Real-time acceptance or rejection signals for ongoing unit negotiations.
- Manager-to-Delivery notification dispatches.

### 🛡️ Security & RBAC (`/middleware/auth.js`)

Guards endpoints securely. Decodes Bearer tokens and applies matrix layers preventing malicious capability escalations across `Admin`, `Manager`, `Delivery`, `Seller`, and `User` roles.

---

## 🔌 API Routes Overview

The backend uses segmented routers to maintain cleanly separated domains. All endpoints are generally prefixed with `/api/...`

- **`auth.routes.js`**: Login, Registration, JWT Refreshing.
- **`users.routes.js`**: Profile modifications, RBAC elevations.
- **`product.routes.js`**: Full CRUD operations for global multi-vendor catalog.
- **`orders.routes.js`**: Placement, checkout validations, and status timeline tracking.
- **`negotiations.routes.js`**: AI-powered and Seller-powered price haggling endpoints.
- **`groupBuy.routes.js`**: Social discount purchasing pools.
- **`deliveryRequests.routes.js`**: Logistics, delivery agent assignment.
- **`ai.routes.js`**: Direct interfaces for smart chatbot interactions.

---

## 📁 Directory Structure

```text
UnityShop-Sever/
├── index.js                # Core API routing & server instantiation
├── package.json            # Dependencies and scripts (npm start, npm run dev)
├── vercel.json             # Deployment settings (if migrating to Vercel Serverless)
│
├── middleware/
│   └── auth.js             # JWT validation and Role checkers
│
├── models/
│   └── Negotiation.js      # Mongoose Schemas (User, Product, Order, etc.)
│
├── routes/
│   ├── ai.js               # AI controller bindings
│   ├── auth.js             # Authentication flows
│   ├── bids.js             # Bid handling
│   ├── groupBuy.js         # Group Buy logic
│   ├── orders.js           # Checkout and history
│   ├── payment.js          # Gateway integrations
│   └── ...                 # (20+ specialized modules)
│
├── sockets/
│   └── productViewer.js    # Socket event listeners and emitters
│
└── utils/
    ├── aiHelper.js         # OpenAI/Gemini LLM prompt dispatchers
    └── cloudinary.js       # Cloud CDN file handling
```

---

## 🔑 Environment Variables

Create a `.env` file at the root of the `UnityShop-Sever` directory with the following structure:

```env
# ── Server ──────────────────────────────
PORT=5000
NODE_ENV=development

# ── Database ────────────────────────────
MONGODB_URI=mongodb+srv://<user>:<password>@cluster.mongodb.net/unityshop?retryWrites=true&w=majority

# ── Authentication ──────────────────────
JWT_SECRET=your_super_secret_jwt_key
JWT_EXPIRE=30d

# ── AI Keys ─────────────────────────────
OPENAI_API_KEY=sk-...
GEMINI_API_KEY=AIzaSy...

# ── Media Uploads (Cloudinary) ──────────
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret

# ── Email Setup (SMTP) ──────────────────
EMAIL_SERVICE=gmail
EMAIL_USER=your_email@gmail.com
EMAIL_PASS=your_app_password
```

---

## 🚀 Getting Started

Ensure you have **Node.js (v18+)** and **MongoDB** installed or accessible via cloud.

1. **Navigate to the Backend directory**

```bash
cd UnityShop-Sever
```

2. **Install all dependencies**

```bash
npm install
```

3. **Provide Config**

- Duplicate `.env.example` or manually create `.env`
- Fill in the Environment Variables as shown above.

4. **Launch the Server**

```bash
npm run dev
# Starts the Express API and Socket.io endpoints locally on port 5000
```

<div align="center">
_Built securely from the ground up for Unity Shop._
</div>
