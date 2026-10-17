export const config = {
  api: {
    bodyParser: {
      sizeLimit: '4.5mb'
    }
  }
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const BOT_TOKEN = process.env.BOT_TOKEN;
  const ADMIN_ID = '8026237972'; // Your Telegram ID for staging & admin logs

  if (!BOT_TOKEN) {
    return res.status(500).json({ error: 'Missing BOT_TOKEN environment variable' });
  }

  const { base64Data, mimeType, fileName } = req.body;
  if (!base64Data || !mimeType) {
    return res.status(400).json({ error: 'Missing media data' });
  }

  try {
    const isVideo = mimeType.startsWith('video/');
    const buffer = Buffer.from(base64Data, 'base64');
    const blob = new Blob([buffer], { type: mimeType });

    const form = new FormData();
    form.append('chat_id', ADMIN_ID);
    form.append('disable_notification', 'true');
    form.append(isVideo ? 'video' : 'photo', blob, fileName || (isVideo ? 'video.mp4' : 'photo.jpg'));

    const endpoint = isVideo ? 'sendVideo' : 'sendPhoto';
    const tgRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${endpoint}`, {
      method: 'POST',
      body: form
    });

    const tgData = await tgRes.json();
    if (!tgData.ok) {
      return res.status(400).json({
        error: tgData.description || 'Failed to upload media. Make sure you (8026237972) have started the bot!'
      });
    }

    // Extract reusable Telegram file_id
    let fileId = null;
    if (isVideo && tgData.result.video) {
      fileId = tgData.result.video.file_id;
    } else if (tgData.result.photo) {
      const photos = tgData.result.photo;
      fileId = photos[photos.length - 1].file_id; // Highest resolution photo
    }

    // Delete temporary staging message so your chat stays tidy
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/deleteMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: ADMIN_ID,
        message_id: tgData.result.message_id
      })
    });

    return res.status(200).json({
      success: true,
      type: isVideo ? 'video' : 'photo',
      file_id: fileId
    });
  } catch (err) {
    console.error('Upload error:', err);
    return res.status(500).json({ error: 'Media upload failed (Keep each file under 4MB).' });
  }
}
