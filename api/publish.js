import { Redis } from '@upstash/redis';

global.dailyMemoryStore = global.dailyMemoryStore || {};

const ADMIN_ID = '8026237972';

function getTodayKey(userId) {
  const today = new Date().toISOString().split('T')[0];
  return `posts_${userId}_${today}`;
}

function formatMessageWithPremiumEmojis(rawText = '') {
  const escaped = rawText
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  return escaped.replace(/\[emoji:(\d+)\]/g, '<tg-emoji emoji-id="$1">⭐</tg-emoji>');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const BOT_TOKEN = process.env.BOT_TOKEN;
  const GROUP_ID = process.env.GROUP_ID || '@Big_refferal_chat';

  if (!BOT_TOKEN) {
    return res.status(500).json({ error: 'Missing BOT_TOKEN environment variable.' });
  }

  const {
    userId,
    username,
    firstName,
    text,
    mediaItems = [], // Array of { type: 'photo'|'video', file_id: '...' }
    includeButton,
    buttonText,
    buttonUrl,
    buttonStyle,
    buttonEmojiId,
    adTypeWatched
  } = req.body;

  if (!userId || (!text && mediaItems.length === 0)) {
    return res.status(400).json({ error: 'Please write a message or attach media.' });
  }

  try {
    // Clean message text WITHOUT any "Posted by..." header
    const cleanHtmlText = formatMessageWithPremiumEmojis(text || '');

    // Build InlineKeyboardButton if requested
    let replyMarkup = undefined;
    if (includeButton && buttonUrl) {
      const btnObj = {
        text: buttonText || 'Visit Link',
        url: buttonUrl
      };

      if (['primary', 'success', 'danger'].includes(buttonStyle)) {
        btnObj.style = buttonStyle;
      }

      if (buttonEmojiId && /^\d+$/.test(buttonEmojiId.trim())) {
        btnObj.icon_custom_emoji_id = buttonEmojiId.trim();
      }

      replyMarkup = {
        inline_keyboard: [[btnObj]]
      };
    }

    let tgData = null;
    let publishedMsgId = null;

    // CASE 1: No Media -> Standard Text Message
    if (mediaItems.length === 0) {
      const tgRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: GROUP_ID,
          text: cleanHtmlText,
          parse_mode: 'HTML',
          disable_web_page_preview: false,
          reply_markup: replyMarkup
        })
      });
      tgData = await tgRes.json();
      publishedMsgId = tgData.result?.message_id;
    }

    // CASE 2: Exactly 1 Photo or Video -> sendPhoto / sendVideo with Caption + Inline Button
    else if (mediaItems.length === 1) {
      const item = mediaItems[0];
      const isVideo = item.type === 'video';
      const endpoint = isVideo ? 'sendVideo' : 'sendPhoto';

      const payload = {
        chat_id: GROUP_ID,
        [isVideo ? 'video' : 'photo']: item.file_id,
        caption: cleanHtmlText,
        parse_mode: 'HTML',
        reply_markup: replyMarkup
      };

      const tgRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      tgData = await tgRes.json();
      publishedMsgId = tgData.result?.message_id;
    }

    // CASE 3: Multiple Photos/Videos (2 to 10) -> sendMediaGroup
    else {
      // If user DID NOT request a button, put caption on the 1st media item of the album
      // If user DID request a button, send the album first, then send the text + button replying to the album
      const putCaptionOnAlbum = !replyMarkup;

      const mediaArray = mediaItems.slice(0, 10).map((item, idx) => ({
        type: item.type,
        media: item.file_id,
        ...(idx === 0 && putCaptionOnAlbum && cleanHtmlText
          ? { caption: cleanHtmlText, parse_mode: 'HTML' }
          : {})
      }));

      const albumRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMediaGroup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: GROUP_ID,
          media: mediaArray
        })
      });
      tgData = await albumRes.json();

      if (tgData.ok && Array.isArray(tgData.result) && tgData.result.length > 0) {
        publishedMsgId = tgData.result[0].message_id;

        // If user also wanted an inline button, attach it right below the album
        if (replyMarkup) {
          await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: GROUP_ID,
              text: cleanHtmlText || '👇',
              parse_mode: 'HTML',
              reply_to_message_id: publishedMsgId,
              reply_markup: replyMarkup
            })
          });
        }
      }
    }

    if (!tgData || !tgData.ok) {
      return res.status(400).json({
        error: `Telegram Error: ${tgData?.description || 'Failed to publish post'}`
      });
    }

    // Increment daily post count
    const key = getTodayKey(userId);
    let newCount = 1;

    if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
      const redis = Redis.fromEnv();
      newCount = await redis.incr(key);
      await redis.expire(key, 86400);
    } else {
      global.dailyMemoryStore[key] = (global.dailyMemoryStore[key] || 0) + 1;
      newCount = global.dailyMemoryStore[key];
    }

    // =========================================================================
    // NOTIFY ADMIN (8026237972) EVERY TIME A POST IS PUBLISHED
    // =========================================================================
    const postLink = publishedMsgId
      ? `https://t.me/${GROUP_ID.replace('@', '')}/${publishedMsgId}`
      : `https://t.me/${GROUP_ID.replace('@', '')}`;

    const adminLogHtml =
      `🔔 <b>New Post Published in ${GROUP_ID}!</b>\n\n` +
      `👤 <b>User:</b> ${firstName ? firstName.replace(/</g, '&lt;') : 'Unknown'} ${username ? `(@${username})` : ''}\n` +
      `🆔 <b>User ID:</b> <code>${userId}</code>\n` +
      `🎬 <b>Ad Completed:</b> ${adTypeWatched === 'task' ? '✅ Task Block Ad (1st Today)' : '🎥 Reward Block Ad'}\n` +
      `📊 <b>User's Posts Today:</b> ${newCount}\n` +
      `🖼 <b>Media Attached:</b> ${mediaItems.length} file(s)\n` +
      `🔘 <b>URL Button:</b> ${includeButton ? `${buttonText} (${buttonStyle}) ->${buttonUrl}` : 'None'}\n\n` +
      `📝 <b>Message Preview:</b>\n${cleanHtmlText || '<i>(Media only)</i>'}\n\n` +
      `🔗 <a href="${postLink}">View Published Post in Group</a>`;

    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: ADMIN_ID,
        text: adminLogHtml,
        parse_mode: 'HTML',
        disable_web_page_preview: true
      })
    }).catch((e) => console.error('Admin notification error:', e));

    return res.status(200).json({
      success: true,
      postsToday: newCount,
      nextAdType: 'reward'
    });
  } catch (err) {
    console.error('Publish Error:', err);
    return res.status(500).json({ error: 'Internal server error while publishing.' });
  }
}
