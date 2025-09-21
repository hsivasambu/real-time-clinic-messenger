const Redis = require("ioredis");

class RedisManager {
  constructor() {
    // Create separate Redis connections for pub/sub
    // (Redis requirement: subscribers can't use same connection for other operations)
    this.publisher = new Redis({
      host: process.env.REDIS_HOST || "localhost",
      port: process.env.REDIS_PORT || 6379,
      retryDelayOnFailover: 100,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 3,
    });

    this.subscriber = new Redis({
      host: process.env.REDIS_HOST || "localhost",
      port: process.env.REDIS_PORT || 6379,
      retryDelayOnFailover: 100,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 3,
    });

    // General Redis client for other operations
    this.client = new Redis({
      host: process.env.REDIS_HOST || "localhost",
      port: process.env.REDIS_PORT || 6379,
      retryDelayOnFailover: 100,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 3,
    });

    this.setupErrorHandling();
    this.isConnected = false;
  }

  setupErrorHandling() {
    [this.publisher, this.subscriber, this.client].forEach((redis, index) => {
      const names = ["publisher", "subscriber", "client"];

      redis.on("connect", () => {
        console.log(`✅ Redis ${names[index]} connected`);
        this.isConnected = true;
      });

      redis.on("error", (error) => {
        console.error(`❌ Redis ${names[index]} error:`, error.message);
        this.isConnected = false;
      });

      redis.on("close", () => {
        console.log(`🔌 Redis ${names[index]} connection closed`);
        this.isConnected = false;
      });
    });
  }

  // Publish a message to a room channel
  async publishToRoom(roomId, message) {
    try {
      const channel = `room:${roomId}`;
      const messageStr = JSON.stringify(message);

      await this.publisher.publish(channel, messageStr);
      console.log(
        `📤 Published to ${channel}:`,
        message.content?.substring(0, 50)
      );

      return true;
    } catch (error) {
      console.error("Error publishing message:", error);
      return false;
    }
  }

  // Subscribe to a room channel
  async subscribeToRoom(roomId, callback) {
    try {
      const channel = `room:${roomId}`;

      // Set up message handler if not already set
      if (!this.subscriber.listenerCount("message")) {
        this.subscriber.on("message", (receivedChannel, message) => {
          try {
            const parsedMessage = JSON.parse(message);
            const roomId = receivedChannel.split(":")[1];

            console.log(
              `📥 Received from ${receivedChannel}:`,
              parsedMessage.content?.substring(0, 50)
            );
            callback(roomId, parsedMessage);
          } catch (error) {
            console.error("Error parsing received message:", error);
          }
        });
      }

      await this.subscriber.subscribe(channel);
      console.log(`🔔 Subscribed to ${channel}`);

      return true;
    } catch (error) {
      console.error("Error subscribing to room:", error);
      return false;
    }
  }

  // Unsubscribe from a room channel
  async unsubscribeFromRoom(roomId) {
    try {
      const channel = `room:${roomId}`;
      await this.subscriber.unsubscribe(channel);
      console.log(`🔕 Unsubscribed from ${channel}`);
      return true;
    } catch (error) {
      console.error("Error unsubscribing from room:", error);
      return false;
    }
  }

  // Store connection info in Redis (for multi-server awareness)
  async storeConnection(socketId, connectionInfo) {
    try {
      const key = `connection:${socketId}`;
      const value = JSON.stringify({
        ...connectionInfo,
        serverId: process.env.SERVER_ID || "server-1",
        timestamp: new Date().toISOString(),
      });

      // Store with 1 hour expiration
      await this.client.setex(key, 3600, value);
      return true;
    } catch (error) {
      console.error("Error storing connection:", error);
      return false;
    }
  }

  // Remove connection info from Redis
  async removeConnection(socketId) {
    try {
      const key = `connection:${socketId}`;
      await this.client.del(key);
      return true;
    } catch (error) {
      console.error("Error removing connection:", error);
      return false;
    }
  }

  // Get active room statistics
  async getRoomStats(roomId) {
    try {
      const pattern = `connection:*`;
      const keys = await this.client.keys(pattern);

      let roomUserCount = 0;
      const users = [];
      const userIds = new Set(); // Prevent duplicate counting

      for (const key of keys) {
        try {
          const connectionData = await this.client.get(key);
          if (connectionData) {
            const connection = JSON.parse(connectionData);
            if (
              connection.roomId === roomId &&
              !userIds.has(connection.userId)
            ) {
              roomUserCount++;
              userIds.add(connection.userId);
              users.push({
                userId: connection.userId,
                userName: connection.userName,
                serverId: connection.serverId,
                joinedAt: connection.timestamp,
              });
            }
          }
        } catch (parseError) {
          console.warn("Failed to parse connection data for key:", key);
          // Clean up corrupted data
          await this.client.del(key);
        }
      }

      return {
        roomId,
        userCount: roomUserCount,
        users,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      console.error("Error getting room stats:", error);
      return {
        roomId,
        userCount: 0,
        users: [],
        timestamp: new Date().toISOString(),
      };
    }
  }

  // Health check
  async healthCheck() {
    try {
      await this.client.ping();
      return {
        status: "healthy",
        connected: this.isConnected,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return {
        status: "unhealthy",
        connected: false,
        error: error.message,
        timestamp: new Date().toISOString(),
      };
    }
  }

  // Graceful shutdown
  async disconnect() {
    try {
      await Promise.all([
        this.publisher.disconnect(),
        this.subscriber.disconnect(),
        this.client.disconnect(),
      ]);
      console.log("🔌 All Redis connections closed");
    } catch (error) {
      console.error("Error disconnecting from Redis:", error);
    }
  }
}

module.exports = RedisManager;
