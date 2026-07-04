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

      // --- 2. LINK DETECTION & MODERATION ---
      let incomingText = msg.text || "";
      const urlRegex = /(https?:\/\/[^\s]+|www\.[^\s]+|[a-zA-Z0-9\-\.]+\.[a-zA-Z]{2,}(\/\S*)?)/ig;
      if (incomingText && urlRegex.test(incomingText)) {
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

      // --- 5. AUDIO & VOICE NOTE PROCESSING ---
      let audioPart = null;
      if (msg.voice) {
        const fileId = msg.voice.file_id;
        
        // Ask Telegram for the file path
        const fileReq = await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/getFile?file_id=${fileId}`);
        const fileData = await fileReq.json();
        
        if (fileData.ok) {
          const filePath = fileData.result.file_path;
          const audioUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${filePath}`;
          
          // Download the audio buffer and convert to base64
          const audioReq = await fetch(audioUrl);
          const arrayBuffer = await audioReq.arrayBuffer();
          const base64Audio = Buffer.from(arrayBuffer).toString('base64');
          
          audioPart = {
            inlineData: {
              mimeType: msg.voice.mime_type || "audio/ogg",
              data: base64Audio
            }
          };
          incomingText = "[User sent a voice note. Listen to the audio to understand their message.]";
        }
      }

      // --- 6. RETRIEVE MEMORY FROM REDIS ---
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

      // --- 7. GEMINI AI GENERATION ---
      const currentDateTime = new Date().toLocaleString("en-KE", { timeZone: "Africa/Nairobi" });
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;
      
      // Construct the dynamic user message (Text + Audio if present)
      const userParts = [];
      if (incomingText) userParts.push({ text: incomingText });
      if (audioPart) userParts.push(audioPart);
      const userMsgObj = { role: "user", parts: userParts };
      
      const aiResponse = await fetch(geminiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ 
              text: `You are Phil's highly capable digital secretary managing his personal Telegram DMs. Current Date & Time in Kenya: ${currentDateTime}. 
              Answer naturally, keep it concise (1-2 sentences), and acknowledge any audio messages you hear. 
              
              CRITICAL: If the user has just successfully left their final question, finished detailing their issue, or wrapped up the chat, you MUST end your response message with the exact tag: [HANDOVER].` 
            }]
          },
          contents: [...pastMessages, userMsgObj], 
          generationConfig: { temperature: 0.7, maxOutputTokens: 150 }
        })
      });

      const aiData = await aiResponse.json();
      
      let replyText = "I am currently away, but I will get back to you soon.";
      if (aiData.candidates && aiData.candidates.length > 0) {
        replyText = aiData.candidates[0].content.parts[0].text;
      } else if (aiData.error) {
        replyText = `⚙️ *System Error:* \n_${aiData.error.message}_`; 
      }

      let triggerHandover = false;
      if (replyText.includes("[HANDOVER]")) {
        triggerHandover = true;
        replyText = replyText.replace("[HANDOVER]", "").trim();
      }

      // --- 8. SAVE NEW MEMORY & EXECUTE HANDOVER ---
      if (upstashUrl && upstashToken) {
        // Strip the heavy audio buffer before saving to Redis to save space
        const safeUserMsgObj = { role: "user", parts: [{ text: incomingText }] };
        const aiMsgObj = { role: "model", parts: [{ text: replyText }] };
        
        const pipelineOperations = [
          ["RPUSH", `chat:${chatId}`, JSON.stringify(safeUserMsgObj), JSON.stringify(aiMsgObj)],
          ["LTRIM", `chat:${chatId}`, -20, -1]
        ];

        if (triggerHandover) {
          pipelineOperations.push(["SET", `pause:${chatId}`, "active", "EX", 7200]);
        }

        await fetch(`${upstashUrl}/pipeline`, {
          method: "POST",
          headers: { "Authorization": `Bearer ${upstashToken}` },
          body: JSON.stringify(pipelineOperations)
        });
      }

      // --- 9. SEND THE FINAL AI RESPONSE ---
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
