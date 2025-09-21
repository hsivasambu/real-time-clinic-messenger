// server/kafka.js
const { Kafka } = require("kafkajs");

const kafka = new Kafka({
  clientId: "hospital-chat",
  brokers: ["localhost:9092"],
});

const producer = kafka.producer();
const consumer = kafka.consumer({ groupId: "chat-processors" });

async function publishMessage(topic, message) {
  await producer.send({
    topic,
    messages: [
      {
        key: message.roomId,
        value: JSON.stringify(message),
        timestamp: Date.now(),
      },
    ],
  });
}

async function startMessageProcessor() {
  await consumer.subscribe({ topic: "chat-messages" });

  await consumer.run({
    eachMessage: async ({ topic, partition, message }) => {
      const chatMessage = JSON.parse(message.value.toString());

      // Async processing: store in database, trigger notifications, etc.
      await storeMessage(chatMessage);

      // Could add: push notifications, analytics, content moderation
    },
  });
}

module.exports = {
  publishMessage,
  startMessageProcessor,
};
