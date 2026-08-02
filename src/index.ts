import TelegramBot from "node-telegram-bot-api";
import OpenAI from "openai";
import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";

dotenv.config();

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN!, {
  polling: true,
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const DOWNLOAD_DIR = "./downloads";

fs.mkdirSync(DOWNLOAD_DIR, {
  recursive: true,
});

async function transcribe(filePath: string): Promise<string> {
  const result = await openai.audio.transcriptions.create({
    model: "gpt-4o-transcribe",
    file: fs.createReadStream(filePath),
  });

  return result.text;
}

async function summarize(text: string): Promise<string> {
  const response = await openai.responses.create({
    model: "gpt-5",
    input: [
      {
        role: "system",
        content:
          "Summarize the audio in 1-3 short bullet points. Keep it concise.",
      },
      {
        role: "user",
        content: text,
      },
    ],
  });

  return response.output_text;
}

async function processAudio(
  fileId: string,
  chatId: number,
  messageId: number
) {
  let localPath: string | undefined;

  try {
    await bot.sendChatAction(chatId, "typing");

    localPath = await bot.downloadFile(fileId, DOWNLOAD_DIR);

    const transcript = await transcribe(localPath);

    const summary = await summarize(transcript);

    await bot.sendMessage(chatId, `📝 Summary\n\n${summary}`, {
      reply_to_message_id: messageId,
    });
  } catch (error) {
    console.error(error);

    await bot.sendMessage(chatId, "Failed to summarize audio.", {
      reply_to_message_id: messageId,
    });
  } finally {
    if (localPath && fs.existsSync(localPath)) {
      fs.unlinkSync(localPath);
    }
  }
}

bot.on("voice", async (msg) => {
  if (!msg.voice) return;

  await processAudio(
    msg.voice.file_id,
    msg.chat.id,
    msg.message_id
  );
});

bot.on("audio", async (msg) => {
  if (!msg.audio) return;

  await processAudio(
    msg.audio.file_id,
    msg.chat.id,
    msg.message_id
  );
});

console.log("Bot is running...");