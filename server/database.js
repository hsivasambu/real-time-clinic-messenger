const mysql = require("mysql2/promise");

const pool = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "hospital_chat",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

async function storeMessage(message) {
  try {
    await pool.execute(
      "INSERT INTO messages (id, room_id, user_id, user_name, content, message_type, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [
        message.id,
        message.roomId,
        message.userId,
        message.userName,
        message.content,
        message.type,
        message.timestamp,
      ]
    );
  } catch (error) {
    console.error("Error storing message:", error);
    throw error;
  }
}

async function getRecentMessages(roomId, limit = 50) {
  try {
    const [rows] = await pool.execute(
      "SELECT * FROM messages WHERE room_id = ? ORDER BY created_at DESC LIMIT ?",
      [roomId, limit]
    );
    return rows.reverse(); // Return in chronological order
  } catch (error) {
    console.error("Error fetching messages:", error);
    throw error;
  }
}

async function searchMessages(roomId, query, limit = 20) {
  try {
    const [rows] = await pool.execute(
      "SELECT * FROM messages WHERE room_id = ? AND MATCH(content) AGAINST(? IN NATURAL LANGUAGE MODE) ORDER BY created_at DESC LIMIT ?",
      [roomId, query, limit]
    );
    return rows;
  } catch (error) {
    console.error("Error searching messages:", error);
    throw error;
  }
}

module.exports = {
  storeMessage,
  getRecentMessages,
  searchMessages,
};
