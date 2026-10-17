import { Redis } from '@upstash/redis';

// Fallback memory map if Redis env vars aren't added yet
global.dailyMemoryStore = global.dailyMemoryStore || {};

function getTodayKey(userId) {
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  return `posts_${userId}_${today}`;
}

export default async function handler(req, res) {
  const { userId } = req.query;
  if (!userId) {
    return res.status(400).json({ error: 'Missing userId' });
  }

  const key = getTodayKey(userId);
  let postsToday = 0;

  try {
    if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
      const redis = Redis.fromEnv();
      postsToday = (await redis.get(key)) || 0;
    } else {
      postsToday = global.dailyMemoryStore[key] || 0;
    }

    postsToday = Number(postsToday);

    // 0 posts today -> must watch 'task' ad first. 1+ posts today -> watch 'reward' ad
    return res.status(200).json({
      postsToday,
      requiredAdType: postsToday === 0 ? 'task' : 'reward'
    });
  } catch (err) {
    console.error('Status check error:', err);
    return res.status(200).json({ postsToday: 0, requiredAdType: 'task' });
  }
}
