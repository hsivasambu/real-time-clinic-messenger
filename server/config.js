module.exports = {
  PORT: process.env.PORT || 3001,
  REDIS_URL: process.env.REDIS_URL || "redis://localhost:6379",
  CLIENT_URL: process.env.CLIENT_URL || "http://localhost:3000",

  // WebSocket configuration
  WEBSOCKET_CONFIG: {
    cors: {
      origin: process.env.CLIENT_URL || "http://localhost:3000",
      methods: ["GET", "POST"],
    },
    // Connection timeout
    pingTimeout: 60000,
    pingInterval: 25000,
  },
};
