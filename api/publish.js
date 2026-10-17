import { Redis } from '@upstash/redis';

global.dailyMemoryStore = global.dailyMemoryStore || {};
global.recentPayoutsCache = global.recentPayoutsCache || [];

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
  const { action, targetUserId, BOT_TOKEN: tokenOverride } = req.body || {};
  const BOT_TOKEN = process.env.BOT_TOKEN || tokenOverride;

  if (action === 'ban' && req.headers['x-admin-id'] === ADMIN_ID) {
    if (process.env.UPSTASH_REDIS_REST_URL) {
      const redis = Redis.fromEnv();
      await redis.set(`banned_${targetUserId}`, '1');
    } else {
      global.dailyMemoryStore[`banned_${targetUserId}`] = true;
    }
    return res.status(200).json({ success: true, message: `User ${targetUserId} banned.` });
  }

  if (action === 'unban' && req.headers['x-admin-id'] === ADMIN_ID) {
    if (process.env.UPSTASH_REDIS_REST_URL) {
      const redis = Redis.fromEnv();
      await redis.del(`banned_${targetUserId}`);
    } else {
      delete global.dailyMemoryStore[`banned_${targetUserId}`];
    }
    return res.status(200).json({ success: true, message: `User ${targetUserId} unbanned.` });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

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

  if (!userId) return res.status(400).json({ error: 'Missing userId' });

  try {
    let isBanned = false;
    if (process.env.UPSTASH_REDIS_REST_URL) {
      const redis = Redis.fromEnv();
      isBanned = Boolean(await redis.get(`banned_${userId}`));
    } else {
      isBanned = Boolean(global.dailyMemoryStore[`banned_${userId}`]);
    }

    if (isBanned) {
      return res.status(403).json({ error: 'Your account has been restricted from publishing.' });
    }

    const cleanHtmlText = formatMessageWithPremiumEmojis(text || '');

    let replyMarkup = undefined;
    if (includeButton && buttonUrl) {
      const btnObj = { text: buttonText || 'Visit Link', url: buttonUrl };
      if (['primary', 'success', 'danger'].includes(buttonStyle)) btnObj.style = buttonStyle;
      if (buttonEmojiId && /^\d+$/.test(buttonEmojiId.trim())) btnObj.icon_custom_emoji_id = buttonEmojiId.trim();
      replyMarkup = { inline_keyboard: [[btnObj]] };
    }

    let tgData = null;
    let publishedMsgId = null;

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
    } else if (mediaItems.length === 1) {
      const item = mediaItems[0];
      const isVideo = item.type === 'video';
      const tgRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${isVideo ? 'sendVideo' : 'sendPhoto'}`, {
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
    } else {
      const mediaArray = mediaItems.slice(0, 10).map((item, idx) => ({
        type: item.type,
        media: item.file_id,
        ...(idx === 0 && !replyMarkup && cleanHtmlText ? { caption: cleanHtmlText, parse_mode: 'HTML' } : {})
      }));

      const albumRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMediaGroup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: GROUP_ID, media: mediaArray })
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
      return res.status(400).json({ error: `Telegram Error: ${tgData?.description || 'Failed'}` });
    }

    const payoutRecord = {
      id: Math.random().toString(36).substring(2, 9),
      user: firstName || 'Verified Member',
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      preview: (text || 'Media Post').substring(0, 45) + '...',
      link: `https://t.me/${GROUP_ID.replace('@', '')}/${publishedMsgId}`
    };
    global.recentPayoutsCache.unshift(payoutRecord);
    if (global.recentPayoutsCache.length > 10) global.recentPayoutsCache.pop();

    const today = getTodayDate();
    const countKey = `posts_${userId}_${today}`;
    const taskKey = `task_done_${userId}_${today}`;
    let newCount = 1;

    if (process.env.UPSTASH_REDIS_REST_URL) {
      const redis = Redis.fromEnv();
      newCount = await redis.incr(countKey);
      await redis.set(taskKey, '1');
      await Promise.all([redis.expire(countKey, 86400), redis.expire(taskKey, 86400)]);
    } else {
      global.dailyMemoryStore[countKey] = (global.dailyMemoryStore[countKey] || 0) + 1;
      global.dailyMemoryStore[taskKey] = true;
      newCount = global.dailyMemoryStore[countKey];
    }

    const postLink = publishedMsgId ? `https://t.me/${GROUP_ID.replace('@', '')}/${publishedMsgId}` : `https://t.me/${GROUP_ID.replace('@', '')}`;
    const adminLogHtml =
      `🔔 <b>New Post Published in ${GROUP_ID}!</b>\n\n` +
      `👤 <b>User:</b> ${firstName ? firstName.replace(/</g, '&lt;') : 'Unknown'} ${username ? `(@${username})` : ''}\n` +
      `🆔 <b>User ID:</b> <code>${userId}</code>\n` +
      `🎬 <b>Ad Verified:</b> ${adTypeWatched === 'task' ? '✅ Task Block (task-54445)' : '🎥 Reward Block (54445)'}\n` +
      `📊 <b>Posts Today:</b> ${newCount}\n\n` +
      `📝 <b>Content:</b>\n${cleanHtmlText || '<i>(Media)</i>'}\n\n` +
      `🔗 <a href="${postLink}">View Post</a>`;

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
      postsToday: newCount,
      taskCompletedToday: true,
      nextAdType: 'reward',
      recentPayouts: global.recentPayoutsCache
    });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error.' });
  }
}
