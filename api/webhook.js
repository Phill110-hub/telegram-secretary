export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  try {
    const update = req.body;

    if (update.business_message) {
      const msg = update.business_message;
      const chatId = msg.chat.id;
      const connectionId = msg.business_connection_id;
      const senderId = msg.from.id;
      const incomingText = msg.text || "";
      const messageId = msg.message_id;
      
      // Prevent the bot from talking to you
      const myTelegramId = 6275195489; // UPDATE THIS
      if (senderId === myTelegramId) {
        return res.status(200).send("OK");
      }

      // --- 1. THE SHADOW BLOCKLIST ---
      // Add the Telegram IDs of annoying users here. The bot will ignore them.
      const blockedUsers = [111111111, 222222222];
      if (blockedUsers.includes(senderId)) {
        return res.status(200).send("OK");
      }

      // --- 2. LINK DETECTION & MODERATION ---
      const urlRegex = /(https?:\/\/[^\s]+|www\.[^\s]+)/ig;
      if (urlRegex.test(incomingText)) {
        // Attempt to delete the message containing the link
        await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/deleteMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: chatId,
            message_id: messageId
          })
        });

        // Send a stern warning
        await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: chatId,
            text: "Automated Admin: Please do not send links in this chat. Your message has been removed.",
            business_connection_id: connectionId
          })
        });
        
        return res.status(200).send("OK");
      }

      // --- 3. THE GEMINI AI INTEGRATION ---
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;
      
      const aiResponse = await fetch(geminiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ 
              text: "You are a highly capable digital secretary managing the personal Telegram DMs for a busy Kenyan software developer and law student. You can speak English and Swahili fluently. If someone asks about legal drafting, football betting odds, or troubleshooting AI tools, politely let them know they are busy and you will pass the message along. Ask if their inquiry is urgent. Keep your tone natural, conversational, and concise. Do not sound like a robot." 
            }]
          },
          contents: [{ parts: [{ text: incomingText }] }]
        })
      });

      const aiData = await aiResponse.json();
      
      // Extract the generated text safely
      let replyText = "I am currently away, but I will get back to you soon.";
      if (aiData.candidates && aiData.candidates.length > 0) {
        replyText = aiData.candidates[0].content.parts[0].text;
      }

      // Send the AI's reply back to Telegram
      await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: replyText,
          business_connection_id: connectionId
        })
      });
    }

    return res.status(200).send("OK");

  } catch (error) {
    console.error("Worker Error:", error);
    return res.status(500).send("Error");
  }
}
