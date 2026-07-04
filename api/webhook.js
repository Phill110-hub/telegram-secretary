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
      // Add the Telegram IDs of annoying users here. The bot will silently ignore them.
      const blockedUsers = [111111111, 222222222];
      if (blockedUsers.includes(senderId)) {
        return res.status(200).send("OK");
      }

      // --- 2. AGGRESSIVE LINK DETECTION & MODERATION ---
      // This regex catches http, https, www, and raw domains like "spam.com"
      const urlRegex = /(https?:\/\/[^\s]+|www\.[^\s]+|[a-zA-Z0-9\-\.]+\.[a-zA-Z]{2,}(\/\S*)?)/ig;
      if (urlRegex.test(incomingText)) {
        
        // Delete the offending message
        await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/deleteMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, message_id: messageId })
        });

        // Send a stern warning using Markdown formatting
        await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: chatId,
            text: "⚠️ *Security Alert:*\nLinks are not permitted in this chat. Your message was automatically deleted. If this is urgent, please send plain text.",
            parse_mode: "Markdown",
            business_connection_id: connectionId
          })
        });
        
        return res.status(200).send("OK");
      }

      // --- 3. TYPING STATUS INDICATOR ---
      // Tell the Telegram client to show "typing..." while Gemini processes the API request
      await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendChatAction`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          action: "typing",
          business_connection_id: connectionId
        })
      });

      // --- 4. ADVANCED GEMINI AI CONFIGURATION ---
      // Dynamically inject the current date and time so the AI is temporally aware
      const currentDateTime = new Date().toLocaleString("en-KE", { timeZone: "Africa/Nairobi" });
      
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;
      
      const aiResponse = await fetch(geminiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ 
              text: `You are Phil's highly capable digital secretary managing his personal Telegram DMs. 
Current Date & Time in Kenya: ${currentDateTime}.

Your goal is to sound like a real, helpful human assistant (not a robotic AI). 
Guidelines:
1. Greet the user naturally.
2. Politely ask if their message is urgent or important so you know whether to interrupt Phil. 
3. Speak in English, but comfortably switch to Swahili if the user initiates it.
4. Keep your responses concise (1-3 sentences maximum).
5. Let them know Phil is currently busy, but assure them you will pass the message along.
6. Use Telegram-friendly formatting (e.g., *bolding* important words).` 
            }]
          },
          contents: [{ role: "user", parts: [{ text: incomingText }] }],
          generationConfig: {
            temperature: 0.7, // Balances creativity with logical restraint
            maxOutputTokens: 150 // Keeps responses fast and conversational
          }
        })
      });

      const aiData = await aiResponse.json();
      
      // Extract the generated text safely, or print the exact API error for debugging
      let replyText = "I am currently away, but I will get back to you soon. Is it urgent?";
      if (aiData.candidates && aiData.candidates.length > 0) {
        replyText = aiData.candidates[0].content.parts[0].text;
      } else if (aiData.error) {
        replyText = `⚙️ *System Error:* \n_${aiData.error.message}_`; 
      }

      // --- 5. SEND THE FINAL AI RESPONSE ---
      await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: replyText,
          parse_mode: "Markdown",
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
                  
