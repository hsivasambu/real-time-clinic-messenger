module.exports = {
  PORT: process.env.PORT || 3001,
  REDIS_URL: process.env.REDIS_URL || "redis://localhost:6379",
  CLIENT_URL:
    process.env.CLIENT_URL ||
    process.env.RENDER_EXTERNAL_URL ||
    "http://localhost:3000",

  // WebSocket configuration
  WEBSOCKET_CONFIG: {
    cors: {
      origin: [
        process.env.CLIENT_URL || "http://localhost:3000",
        process.env.RENDER_EXTERNAL_URL,
        "https://*.onrender.com", // Allow all Render domains
      ].filter(Boolean),
      methods: ["GET", "POST"],
      credentials: true,
    },
    // Connection timeout
    pingTimeout: 60000,
    pingInterval: 25000,
    // Render-specific settings
    allowEIO3: true,
    transports: ["websocket", "polling"],
  },
};
