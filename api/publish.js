import { Redis } from '@upstash/redis';

global.dailyMemoryStore = global.dailyMemoryStore || {};

const ADMIN_ID = '8026237972';

function getTodayDate() {
  return new Date().toISOString().split('T')[0];
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
    mediaItems = [],
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

    // 1. Text-only post
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
    // 2. Single Photo or Video
    else if (mediaItems.length === 1) {
      const item = mediaItems[0];
      const isVideo = item.type === 'video';
      const endpoint = isVideo ? 'sendVideo' : 'sendPhoto';

      const tgRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: GROUP_ID,
          [isVideo ? 'video' : 'photo']: item.file_id,
          caption: cleanHtmlText,
          parse_mode: 'HTML',
          reply_markup: replyMarkup
        })
      });
      tgData = await tgRes.json();
      publishedMsgId = tgData.result?.message_id;
    }
    // 3. Multi-Photo/Video Album (2 to 10 items)
    else {
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

    // Lock Task Block Ad for the rest of today & increment post count
    const today = getTodayDate();
    const countKey = `posts_${userId}_${today}`;
    const taskKey = `task_done_${userId}_${today}`;
    let newCount = 1;

    if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
      const redis = Redis.fromEnv();
      newCount = await redis.incr(countKey);
      await redis.set(taskKey, '1');
      await Promise.all([
        redis.expire(countKey, 86400),
        redis.expire(taskKey, 86400)
      ]);
    } else {
      global.dailyMemoryStore[countKey] = (global.dailyMemoryStore[countKey] || 0) + 1;
      global.dailyMemoryStore[taskKey] = true;
      newCount = global.dailyMemoryStore[countKey];
    }

    // Notify Admin (8026237972)
    const postLink = publishedMsgId
      ? `https://t.me/${GROUP_ID.replace('@', '')}/${publishedMsgId}`
      : `https://t.me/${GROUP_ID.replace('@', '')}`;

    const adminLogHtml =
      `🔔 <b>New Post Published in ${GROUP_ID}!</b>\n\n` +
      `👤 <b>User:</b> ${firstName ? firstName.replace(/</g, '&lt;') : 'Unknown'} ${username ? `(@${username})` : ''}\n` +
      `🆔 <b>User ID:</b> <code>${userId}</code>\n` +
      `🎬 <b>Ad Completed:</b> ${adTypeWatched === 'task' ? '✅ Task Block Ad (1/1 Daily Used)' : '🎥 Reward Block Ad'}\n` +
      `📊 <b>User's Posts Today:</b> ${newCount}\n` +
      `🖼 <b>Media Attached:</b> ${mediaItems.length} file(s)\n` +
      `🔘 <b>URL Button:</b> ${includeButton ? `${buttonText} (${buttonStyle}) ->${buttonUrl}` : 'None'}\n\n` +
      `📝 <b>Message Content:</b>\n${cleanHtmlText || '<i>(Media only)</i>'}\n\n` +
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
    }).catch(() => {});

    return res.status(200).json({
      success: true,
      date: today,
      postsToday: newCount,
      taskCompletedToday: true,
      nextAdType: 'reward'
    });
  } catch (err) {
    console.error('Publish Error:', err);
    return res.status(500).json({ error: 'Internal server error while publishing.' });
  }
}
