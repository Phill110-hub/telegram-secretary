export default async function handler(req, res) {
  // Only accept POST requests from Telegram
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    // Vercel parses the incoming JSON body automatically
    const update = req.body;

    if (update.business_message) {
      const msg = update.business_message;
      const chatId = msg.chat.id;
      const connectionId = msg.business_connection_id;
      const senderId = msg.from.id;
      const incomingText = msg.text || "";
      
      // Prevent infinite loops by ignoring your own messages
      const myTelegramId = 6275195489; // Update this to your numeric ID
      if (senderId === myTelegramId) {
        return res.status(200).send("OK");
      }

      // --- AI / Routing Logic ---
      // This is where you can pipe the incomingText to an evaluation pipeline
      const replyText = `Automated response: I received your message saying "${incomingText}"`;

      const telegramUrl = `https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendMessage`;
      
      // Native fetch is available in Vercel Node.js runtimes
      await fetch(telegramUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: replyText,
          business_connection_id: connectionId
        })
      });
    }

    // Always acknowledge the webhook immediately to prevent Telegram retries
    return res.status(200).send("OK");

  } catch (error) {
    console.error("Webhook Error:", error);
    return res.status(500).send("Internal Server Error");
  }
}
