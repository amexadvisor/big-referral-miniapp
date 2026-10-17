import { Redis } from '@upstash/redis';

global.dailyMemoryStore = global.dailyMemoryStore || {};

function getTodayKey(userId) {
  const today = new Date().toISOString().split('T')[0];
  return `posts_${userId}_${today}`;
}

// Escape HTML in user message except our converted <tg-emoji> tags
function formatMessageWithPremiumEmojis(rawText) {
  const escaped = rawText
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Convert [emoji:5368324170671202286] into <tg-emoji emoji-id="5368324170671202286">⭐</tg-emoji>
  return escaped.replace(/\[emoji:(\d+)\]/g, '<tg-emoji emoji-id="$1">⭐</tg-emoji>');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const BOT_TOKEN = process.env.BOT_TOKEN;
  const GROUP_ID = process.env.GROUP_ID || '@Big_refferal_chat';

  if (!BOT_TOKEN) {
    return res.status(500).json({ error: 'Server is missing BOT_TOKEN environment variable.' });
  }

  const {
    userId,
    username,
    text,
    includeButton,
    buttonText,
    buttonUrl,
    buttonStyle,       // "ordinary" | "primary" (blue) | "success" (green) | "danger" (red)
    buttonEmojiId      // Optional 19-digit custom_emoji_id for the button icon
  } = req.body;

  if (!userId || !text) {
    return res.status(400).json({ error: 'User ID and message text are required.' });
  }

  try {
    const formattedBody = formatMessageWithPremiumEmojis(text);
    const sender = username ? `@${username}` : `User (${userId})`;
    const finalHtmlText = `📢 <b>Post by ${sender}:</b>\n\n${formattedBody}`;

    const telegramPayload = {
      chat_id: GROUP_ID,
      text: finalHtmlText,
      parse_mode: 'HTML',
      disable_web_page_preview: false
    };

    // Build InlineKeyboardButton with native Telegram Bot API 9.4 properties
    if (includeButton && buttonUrl) {
      const btnObj = {
        text: buttonText || 'Visit Link',
        url: buttonUrl
      };

      // 1. Native Button Color ("primary" = Blue, "success" = Green, "danger" = Red)
      // If "ordinary", we omit `style` so Telegram uses the default ordinary button style
      if (['primary', 'success', 'danger'].includes(buttonStyle)) {
        btnObj.style = buttonStyle;
      }

      // 2. Native Premium Emoji on the Button
      if (buttonEmojiId && /^\d+$/.test(buttonEmojiId.trim())) {
        btnObj.icon_custom_emoji_id = buttonEmojiId.trim();
      }

      telegramPayload.reply_markup = {
        inline_keyboard: [[btnObj]]
      };
    }

    // Call Telegram Bot API directly
    const tgRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(telegramPayload)
    });

    const tgData = await tgRes.json();

    if (!tgData.ok) {
      return res.status(400).json({
        error: `Telegram Error: ${tgData.description}`
      });
    }

    // Increment daily post count so the user gets Reward Ads for the rest of today
    const key = getTodayKey(userId);
    let newCount = 1;

    if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
      const redis = Redis.fromEnv();
      newCount = await redis.incr(key);
      await redis.expire(key, 86400); // Auto-expire after 24h
    } else {
      global.dailyMemoryStore[key] = (global.dailyMemoryStore[key] || 0) + 1;
      newCount = global.dailyMemoryStore[key];
    }

    return res.status(200).json({
      success: true,
      postsToday: newCount,
      nextAdType: 'reward'
    });
  } catch (err) {
    console.error('Publish Error:', err);
    return res.status(500).json({ error: 'Internal server error while publishing post.' });
  }
}
