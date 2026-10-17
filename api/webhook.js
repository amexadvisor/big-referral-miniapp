export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(200).send('Bot webhook is active.');
  }

  const BOT_TOKEN = process.env.BOT_TOKEN;
  const WEBAPP_URL = process.env.WEBAPP_URL; // Your Vercel https:// URL
  const update = req.body;

  if (!update || !update.message) {
    return res.status(200).json({ ok: true });
  }

  const msg = update.message;
  const chatId = msg.chat.id;

  // 1. Check if the user sent a Premium Custom Emoji to get its ID
  const allEntities = [...(msg.entities || []), ...(msg.caption_entities || [])];
  const customEmojis = allEntities.filter(e => e.type === 'custom_emoji');

  if (customEmojis.length > 0) {
    const lines = customEmojis.map((e, i) => 
      `#${i + 1} Emoji ID (Tap to copy):\n<code>${e.custom_emoji_id}</code>\nFor Message Text:\n<code>[emoji:${e.custom_emoji_id}]</code>`
    );

    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: `✨ <b>Premium Emoji ID Found!</b>\n\n${lines.join('\n\n')}\n\nPaste this ID inside the Mini App!`,
        parse_mode: 'HTML'
      })
    });
    return res.status(200).json({ ok: true });
  }

  // 2. Handle /start command
  if (msg.text && msg.text.startsWith('/start')) {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: `👋 <b>Welcome to @Big_refferal_chat Poster!</b>\n\n• Click below to open the Mini App and publish your post.\n• 💡 <b>Tip:</b> Send me any <b>Premium Emoji</b> right here in this chat and I will give you its <b>Emoji ID</b>!`,
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [[
            {
              text: '🚀 Open Post Creator',
              style: 'primary',
              web_app: { url: WEBAPP_URL || 'https://your-vercel-app.vercel.app' }
            }
          ]]
        }
      })
    });
  }

  return res.status(200).json({ ok: true });
}
