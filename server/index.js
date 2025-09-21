const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const path = require("path");
const config = require("./config");
const RedisManager = require("./redis-manager");

// Initialize Express app
const app = express();
const server = http.createServer(app);

// Initialize Socket.IO with configuration
const io = socketIo(server, config.WEBSOCKET_CONFIG);

// Initialize Redis manager
const redisManager = new RedisManager();

// Serve static files from public directory
app.use(express.static(path.join(__dirname, "../public")));

// In-memory storage for active connections on this server instance
const activeConnections = new Map();
const subscribedRooms = new Set(); // Track which rooms this server is subscribed to

// Server instance ID for debugging multi-server scenarios
const SERVER_ID =
  process.env.SERVER_ID || `server-${Math.random().toString(36).substr(2, 5)}`;
console.log(`🚀 Server instance ID: ${SERVER_ID}`);

async function setupRedisMessageHandler() {
  redisManager.subscriber.on("message", (channel, message) => {
    try {
      const data = JSON.parse(message);
      const roomId = channel.split(":")[1];

      // Don't process messages from this server instance
      if (data.serverId === SERVER_ID) {
        return;
      }

      console.log(
        `📨 Received ${data.type || "message"} from ${
          data.serverId
        } for room ${roomId}`
      );

      // Handle different message types properly
      switch (data.type) {
        case "user_joined":
          console.log(
            `🔄 Relaying user_joined: ${data.userName} to room ${roomId}`
          );
          io.to(roomId).emit("user_joined", {
            userId: data.userId,
            userName: data.userName,
            roomId: data.roomId,
            timestamp: data.timestamp,
          });
          break;

        case "user_left":
          console.log(
            `🔄 Relaying user_left: ${data.userName} from room ${roomId}`
          );
          io.to(roomId).emit("user_left", {
            userId: data.userId,
            userName: data.userName,
            roomId: data.roomId,
            timestamp: data.timestamp,
            reason: data.reason,
          });
          break;

        case "room_info":
          console.log(
            `🔄 Relaying room_info for room ${roomId}: ${data.userCount} users`
          );
          io.to(roomId).emit("room_info", {
            roomId: data.roomId,
            userCount: data.userCount,
            timestamp: data.timestamp,
          });
          break;

        case "user_typing":
          console.log(
            `🔄 Relaying typing: ${data.userName} (${
              data.isTyping ? "started" : "stopped"
            }) in room ${roomId}`
          );
          io.to(roomId).emit("user_typing", {
            userId: data.userId,
            userName: data.userName,
            isTyping: data.isTyping,
          });
          break;

        default:
          // Regular chat message
          console.log(
            `🔄 Relaying message from ${data.userName} to room ${roomId}`
          );
          io.to(roomId).emit("new_message", data);
          break;
      }
    } catch (error) {
      console.error("Error processing Redis message:", error);
    }
  });
}

// Connection event handler
io.on("connection", (socket) => {
  console.log(
    `[${new Date().toISOString()}] User connected: ${socket.id} on ${SERVER_ID}`
  );

  // Handle user joining a room
  socket.on("join_room", async (userData) => {
    try {
      const { userId, roomId, userName } = userData;

      // Validate input
      if (!userId || !roomId || !userName) {
        socket.emit("error", { message: "Missing required fields" });
        return;
      }

      console.log(
        `User ${userName} (${userId}) joining room ${roomId} on ${SERVER_ID}`
      );

      // Store connection information locally
      const connectionInfo = {
        userId,
        roomId,
        userName,
        socketId: socket.id,
        joinedAt: new Date(),
        serverId: SERVER_ID,
      };

      activeConnections.set(socket.id, connectionInfo);

      // Store connection in Redis for multi-server awareness
      await redisManager.storeConnection(socket.id, connectionInfo);

      // Join the Socket.IO room locally
      socket.join(roomId);

      // Subscribe this server to the room's Redis channel if not already subscribed
      if (!subscribedRooms.has(roomId)) {
        await redisManager.subscribeToRoom(roomId, () => {
          // Callback handled by main Redis message handler
        });
        subscribedRooms.add(roomId);
      }

      // Send confirmation to the user FIRST
      socket.emit("joined_room", {
        roomId,
        message: `Successfully joined ${roomId}`,
        serverId: SERVER_ID,
        timestamp: new Date(),
      });

      // Get updated room statistics from Redis
      const roomStats = await redisManager.getRoomStats(roomId);

      // 🔥 FIX: Send join notification through Redis (not just locally)
      const joinMessage = {
        type: "user_joined",
        userId,
        userName,
        roomId,
        serverId: SERVER_ID,
        timestamp: new Date(),
      };

      // Publish to Redis so ALL servers get this event
      await redisManager.publishToRoom(roomId, joinMessage);

      // 🔥 FIX: Send room info through Redis (not just locally)
      const roomInfoMessage = {
        type: "room_info",
        roomId,
        userCount: roomStats.userCount,
        serverId: SERVER_ID,
        timestamp: new Date(),
      };

      // Publish to Redis so ALL servers get updated room info
      await redisManager.publishToRoom(roomId, roomInfoMessage);
    } catch (error) {
      console.error("Error in join_room:", error);
      socket.emit("error", { message: "Failed to join room" });
    }
  });

  // Handle sending messages
  socket.on("send_message", async (messageData) => {
    try {
      const connectionInfo = activeConnections.get(socket.id);

      if (!connectionInfo) {
        socket.emit("error", { message: "User not connected to any room" });
        return;
      }

      const { content, type = "text" } = messageData;

      if (!content || content.trim().length === 0) {
        socket.emit("error", { message: "Message content cannot be empty" });
        return;
      }

      // Create properly structured message object
      const message = {
        id: require("uuid").v4(),
        userId: connectionInfo.userId,
        userName: connectionInfo.userName,
        roomId: connectionInfo.roomId,
        content: content.trim(),
        type,
        serverId: SERVER_ID,
        timestamp: new Date().toISOString(), // Use ISO string for consistency
        socketId: socket.id,
      };

      console.log(
        `💬 Message from ${connectionInfo.userName} in ${connectionInfo.roomId} on ${SERVER_ID}: ${content}`
      );

      // Publish message to Redis (will be received by all server instances)
      const published = await redisManager.publishToRoom(
        connectionInfo.roomId,
        message
      );

      if (!published) {
        socket.emit("error", { message: "Failed to send message" });
        return;
      }

      // Also broadcast to local clients immediately (for better UX)
      io.to(connectionInfo.roomId).emit("new_message", message);
    } catch (error) {
      console.error("Error in send_message:", error);
      socket.emit("error", { message: "Failed to send message" });
    }
  });

  // Handle typing indicators
  // Handle typing indicators - FIXED VERSION
  socket.on("typing_start", async () => {
    const connectionInfo = activeConnections.get(socket.id);
    if (connectionInfo) {
      const typingMessage = {
        type: "user_typing",
        userId: connectionInfo.userId,
        userName: connectionInfo.userName,
        roomId: connectionInfo.roomId,
        isTyping: true,
        serverId: SERVER_ID,
        timestamp: new Date(),
      };

      // 🔥 FIX: Send through Redis, not just locally
      await redisManager.publishToRoom(connectionInfo.roomId, typingMessage);

      console.log(
        `⌨️ ${connectionInfo.userName} started typing in ${connectionInfo.roomId}`
      );
    }
  });

  socket.on("typing_stop", async () => {
    const connectionInfo = activeConnections.get(socket.id);
    if (connectionInfo) {
      const typingMessage = {
        type: "user_typing",
        userId: connectionInfo.userId,
        userName: connectionInfo.userName,
        roomId: connectionInfo.roomId,
        isTyping: false,
        serverId: SERVER_ID,
        timestamp: new Date(),
      };

      // 🔥 FIX: Send through Redis, not just locally
      await redisManager.publishToRoom(connectionInfo.roomId, typingMessage);

      console.log(
        `⌨️ ${connectionInfo.userName} stopped typing in ${connectionInfo.roomId}`
      );
    }
  });

  // Handle disconnection
  socket.on("disconnect", async (reason) => {
    const connectionInfo = activeConnections.get(socket.id);

    if (connectionInfo) {
      console.log(
        `[${new Date().toISOString()}] User ${
          connectionInfo.userName
        } disconnected from ${SERVER_ID}: ${reason}`
      );

      const { userId, roomId, userName } = connectionInfo;

      // Remove from local active connections
      activeConnections.delete(socket.id);

      // Remove from Redis
      await redisManager.removeConnection(socket.id);

      // 🔥 FIX: Send leave notification through Redis
      const leaveMessage = {
        type: "user_left",
        userId,
        userName,
        roomId,
        serverId: SERVER_ID,
        timestamp: new Date(),
        reason,
      };

      await redisManager.publishToRoom(roomId, leaveMessage);

      // 🔥 FIX: Update room info through Redis
      const roomStats = await redisManager.getRoomStats(roomId);
      const roomInfoMessage = {
        type: "room_info",
        roomId,
        userCount: roomStats.userCount,
        serverId: SERVER_ID,
        timestamp: new Date(),
      };

      await redisManager.publishToRoom(roomId, roomInfoMessage);
    } else {
      console.log(
        `[${new Date().toISOString()}] Unknown user disconnected from ${SERVER_ID}: ${
          socket.id
        }`
      );
    }
  });

  // Handle errors
  socket.on("error", (error) => {
    console.error(`Socket error for ${socket.id} on ${SERVER_ID}:`, error);
  });
});

// Health check endpoint
app.get("/health", async (req, res) => {
  const redisHealth = await redisManager.healthCheck();

  res.json({
    status: redisHealth.status,
    serverId: SERVER_ID,
    timestamp: new Date(),
    activeConnections: activeConnections.size,
    subscribedRooms: Array.from(subscribedRooms),
    redis: redisHealth,
  });
});

// Enhanced metrics endpoint
app.get("/metrics", async (req, res) => {
  const metrics = {
    serverId: SERVER_ID,
    activeConnections: activeConnections.size,
    subscribedRooms: Array.from(subscribedRooms),
    localConnections: {},
  };

  // Add local connection details
  for (const [socketId, info] of activeConnections) {
    if (!metrics.localConnections[info.roomId]) {
      metrics.localConnections[info.roomId] = [];
    }
    metrics.localConnections[info.roomId].push({
      userId: info.userId,
      userName: info.userName,
      socketId: socketId.substring(0, 8) + "...",
    });
  }

  res.json(metrics);
});

// Global room statistics endpoint (Redis-based)
app.get("/rooms/:roomId/stats", async (req, res) => {
  const { roomId } = req.params;
  const stats = await redisManager.getRoomStats(roomId);
  res.json(stats);
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error("Express error:", error);
  res.status(500).json({ error: "Internal server error" });
});

// Initialize Redis message handling
setupRedisMessageHandler().catch(console.error);

// Start the server
server.listen(config.PORT, () => {
  console.log(
    `🚀 Hospital Chat Server (${SERVER_ID}) running on port ${config.PORT}`
  );
  console.log(`📊 Health check: http://localhost:${config.PORT}/health`);
  console.log(`📈 Metrics: http://localhost:${config.PORT}/metrics`);
});

// Graceful shutdown
const gracefulShutdown = async () => {
  console.log("Shutting down gracefully...");

  // Close Redis connections
  await redisManager.disconnect();

  // Close server
  server.close(() => {
    console.log("Server closed");
    process.exit(0);
  });
};

process.on("SIGTERM", gracefulShutdown);
process.on("SIGINT", gracefulShutdown);
