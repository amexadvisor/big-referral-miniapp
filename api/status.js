import { Redis } from '@upstash/redis';

global.dailyMemoryStore = global.dailyMemoryStore || {};

function getTodayDate() {
  return new Date().toISOString().split('T')[0]; // YYYY-MM-DD
}

export default async function handler(req, res) {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'Missing userId' });

  const today = getTodayDate();
  const countKey = `posts_${userId}_${today}`;
  const taskKey = `task_done_${userId}_${today}`;

  let postsToday = 0;
  let taskDone = false;

  try {
    if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
      const redis = Redis.fromEnv();
      const [c, t] = await Promise.all([redis.get(countKey), redis.get(taskKey)]);
      postsToday = Number(c || 0);
      taskDone = Boolean(t);
    } else {
      postsToday = Number(global.dailyMemoryStore[countKey] || 0);
      taskDone = Boolean(global.dailyMemoryStore[taskKey]);
    }

    // If taskDone is true OR postsToday >= 1, strictly require 'reward' ad
    const requiredAdType = (taskDone || postsToday >= 1) ? 'reward' : 'task';

    return res.status(200).json({
      date: today,
      postsToday,
      taskCompletedToday: taskDone || postsToday >= 1,
      requiredAdType
    });
  } catch (err) {
    return res.status(200).json({
      date: today,
      postsToday: 0,
      taskCompletedToday: false,
      requiredAdType: 'task'
    });
  }
}
