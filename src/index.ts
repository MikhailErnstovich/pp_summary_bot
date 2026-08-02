import TelegramBot from "node-telegram-bot-api";
import Groq from "groq-sdk";
import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";

dotenv.config();

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const GROQ_KEY = process.env.GROQ_API_KEY;

if (!TELEGRAM_TOKEN || !GROQ_KEY) {
  throw new Error("Missing TELEGRAM_BOT_TOKEN or GROQ_API_KEY");
}

const bot = new TelegramBot(TELEGRAM_TOKEN, {
  polling: true,
});

const groq = new Groq({
  apiKey: GROQ_KEY,
});

const DOWNLOAD_DIR = path.resolve("./downloads");

fs.mkdirSync(DOWNLOAD_DIR, {
  recursive: true,
});

async function downloadTelegramAudio(
  fileId: string,
  extension: string
): Promise<string> {
  const tempPath = await bot.downloadFile(fileId, DOWNLOAD_DIR);

  const finalPath = `${tempPath}.${extension}`;

  fs.renameSync(tempPath, finalPath);

  return finalPath;
}

async function transcribeAudio(filePath: string): Promise<string> {
  const result = await groq.audio.transcriptions.create({
    file: fs.createReadStream(filePath),
    model: "whisper-large-v3",
    response_format: "json",
    language: "ru"
  });

  return result.text;
}

async function summarizeText(text: string): Promise<string> {
  const response = await groq.chat.completions.create({
    model: "llama-3.3-70b-versatile",

    messages: [
      {
        role: "system",
        content: `Всегда отвечай только на русском языке. Кратко суммируй текст в 2–3 пунктах. Не выдумывай информацию.`.trim(),
      },
      {
        role: "user",
        content: text,
      },
    ],

    temperature: 0.3,
  });

  return (
    response.choices[0]?.message?.content?.trim() || "No summary generated."
  );
}

async function processVoiceMessage(msg: TelegramBot.Message) {
  if (!msg.voice) {
    return;
  }

  const chatId = msg.chat.id;

  let audioPath: string | undefined;

  try {
    await bot.sendChatAction(chatId, "typing");

    audioPath = await downloadTelegramAudio(msg.voice.file_id, "ogg");

    const transcript = await transcribeAudio(audioPath);

    const summary = await summarizeText(transcript);

    await bot.sendMessage(chatId, `📝 Summary\n\n${summary}`, {
      reply_to_message_id: msg.message_id,
    });
  } catch (error) {
    console.error("Processing error:", error);

    await bot.sendMessage(chatId, "❌ Failed to process audio.", {
      reply_to_message_id: msg.message_id,
    });
  } finally {
    if (audioPath && fs.existsSync(audioPath)) {
      fs.unlinkSync(audioPath);
    }
  }
}

// Telegram voice messages
bot.on("voice", async (msg) => {
  await processVoiceMessage(msg);
});

// Normal audio files (mp3, m4a, etc.)
bot.on("audio", async (msg) => {
  if (!msg.audio) {
    return;
  }

  const chatId = msg.chat.id;

  let audioPath: string | undefined;

  try {
    await bot.sendChatAction(chatId, "typing");

    const extension = msg.audio.mime_type?.split("/")[1] || "mp3";

    audioPath = await downloadTelegramAudio(msg.audio.file_id, extension);

    const transcript = await transcribeAudio(audioPath);

    const summary = await summarizeText(transcript);

    await bot.sendMessage(chatId, `📝 Summary\n\n${summary}`, {
      reply_to_message_id: msg.message_id,
    });
  } catch (error) {
    console.error("Audio processing error:", error);

    await bot.sendMessage(chatId, "❌ Failed to process audio.", {
      reply_to_message_id: msg.message_id,
    });
  } finally {
    if (audioPath && fs.existsSync(audioPath)) {
      fs.unlinkSync(audioPath);
    }
  }
});

bot.on("polling_error", (error) => {
  console.error("Telegram polling error:", error.message);
});

console.log("Telegram audio summary bot running...");
