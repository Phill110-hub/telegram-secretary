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
      const myTelegramId = 6275195489; 
      if (senderId === myTelegramId) {
        return res.status(200).send("OK");
      }

      // --- 1. THE SHADOW BLOCKLIST ---
      const blockedUsers = [111111111, 222222222];
      if (blockedUsers.includes(senderId)) {
        return res.status(200).send("OK");
      }

      // --- 2. AGGRESSIVE LINK DETECTION & MODERATION ---
      const urlRegex = /(https?:\/\/[^\s]+|www\.[^\s]+|[a-zA-Z0-9\-\.]+\.[a-zA-Z]{2,}(\/\S*)?)/ig;
      if (urlRegex.test(incomingText)) {
        await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/deleteMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, message_id: messageId })
        });

        await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: chatId,
            text: "⚠️ *Security Alert:*\nLinks are not permitted in this chat. Your message was automatically deleted.",
            parse_mode: "Markdown",
            business_connection_id: connectionId
          })
        });
        return res.status(200).send("OK");
      }

      // --- 3. CHECK FOR ACTIVE HANDOVER PAUSE ---
      const upstashUrl = process.env.UPSTASH_REDIS_REST_URL;
      const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN;

      if (upstashUrl && upstashToken) {
        const checkPauseReq = await fetch(upstashUrl, {
          method: "POST",
          headers: { "Authorization": `Bearer ${upstashToken}` },
          body: JSON.stringify(["GET", `pause:${chatId}`])
        });
        const checkPauseData = await checkPauseReq.json();
        
        // If the pause flag exists, exit immediately and let the human handle it
        if (checkPauseData.result !== null) {
          return res.status(200).send("OK");
        }
      }

      // --- 4. TYPING STATUS INDICATOR ---
      await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendChatAction`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, action: "typing", business_connection_id: connectionId })
      });

      // --- 5. RETRIEVE MEMORY FROM REDIS ---
      let pastMessages = [];
      if (upstashUrl && upstashToken) {
        const historyReq = await fetch(upstashUrl, {
          method: "POST",
          headers: { "Authorization": `Bearer ${upstashToken}` },
          body: JSON.stringify(["LRANGE", `chat:${chatId}`, 0, -1])
        });
        const historyData = await historyReq.json();
        if (historyData.result && Array.isArray(historyData.result)) {
          pastMessages = historyData.result.map(m => JSON.parse(m));
        }
      }

      // --- 6. GEMINI AI GENERATION WITH HANDOVER INSTRUCTIONS ---
      const currentDateTime = new Date().toLocaleString("en-KE", { timeZone: "Africa/Nairobi" });
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${process.env.GEMINI_API_KEY}`;
      
      const userMsgObj = { role: "user", parts: [{ text: incomingText }] };
      
      const aiResponse = await fetch(geminiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ 
              text: `You are Phil's highly capable digital secretary managing his personal Telegram DMs. Current Date & Time in Kenya: ${currentDateTime}. 
              Answer naturally and keep it concise (1-2 sentences). 
              
              CRITICAL: If the user has just successfully left their final question, finished detailing their issue, or wrapped up the chat (e.g., saying 'thank you', 'ok', 'goodbye', or providing their details), you MUST end your response message with the exact tag: [HANDOVER]. This tells the system to mute you so Phil can read it.` 
            }]
          },
          contents: [...pastMessages, userMsgObj], 
          generationConfig: { temperature: 0.7, maxOutputTokens: 150 }
        })
      });

      const aiData = await aiResponse.json();
      
      let replyText = "I am currently away, but I will get back to you soon. Is it urgent?";
      if (aiData.candidates && aiData.candidates.length > 0) {
        replyText = aiData.candidates[0].content.parts[0].text;
      } else if (aiData.error) {
        replyText = `⚙️ *System Error:* \n_${aiData.error.message}_`; 
      }

      // Check if the AI wants to hand over the chat to you
      let triggerHandover = false;
      if (replyText.includes("[HANDOVER]")) {
        triggerHandover = true;
        // Clean out the hidden system tag so the user doesn't see it
        replyText = replyText.replace("[HANDOVER]", "").trim();
      }

      // --- 7. SAVE NEW MEMORY & EXECUTE HANDOVER IF DETECTED ---
      if (upstashUrl && upstashToken) {
        const aiMsgObj = { role: "model", parts: [{ text: replyText }] };
        const pipelineOperations = [
          ["RPUSH", `chat:${chatId}`, JSON.stringify(userMsgObj), JSON.stringify(aiMsgObj)],
          ["LTRIM", `chat:${chatId}`, -20, -1]
        ];

        // If handover is triggered, add the 2-hour (7200 seconds) pause operation to the Redis pipeline
        if (triggerHandover) {
          pipelineOperations.push(["SET", `pause:${chatId}`, "active", "EX", 7200]);
        }

        await fetch(`${upstashUrl}/pipeline`, {
          method: "POST",
          headers: { "Authorization": `Bearer ${upstashToken}` },
          body: JSON.stringify(pipelineOperations)
        });
      }

      // --- 8. SEND THE FINAL AI RESPONSE ---
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
                  
