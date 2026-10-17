import { Redis } from '@upstash/redis';

global.dailyMemoryStore = global.dailyMemoryStore || {};

function getTodayDate() {
  return new Date().toISOString().split('T')[0]; // YYYY-MM-DD
}

export default async function handler(req, res) {
  const { userId, deviceId } = req.query;
  if (!userId) return res.status(400).json({ error: 'Missing userId' });

  const today = getTodayDate();
  const countKey = `posts_${userId}_${today}`;
  const taskKey = `task_done_${userId}_${today}`;
  const banKey = `banned_${userId}`;
  const deviceKey = `device_user_${deviceId}_${today}`; // Tracks 1 account per device per day

  let postsToday = 0;
  let taskDone = false;
  let isBanned = false;
  let deviceConflict = false;

  try {
    if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
      const redis = Redis.fromEnv();
      const [c, t, b, registeredUser] = await Promise.all([
        redis.get(countKey),
        redis.get(taskKey),
        redis.get(banKey),
        deviceId ? redis.get(deviceKey) : Promise.resolve(null)
      ]);
      postsToday = Number(c || 0);
      taskDone = Boolean(t);
      isBanned = Boolean(b);
      // If another user already used this device today for their 1st task, flag it
      if (deviceId && registeredUser && String(registeredUser) !== String(userId)) {
        deviceConflict = true;
      } else if (deviceId && !registeredUser) {
        await redis.set(deviceKey, userId);
        await redis.expire(deviceKey, 86400);
      }
    } else {
      postsToday = Number(global.dailyMemoryStore[countKey] || 0);
      taskDone = Boolean(global.dailyMemoryStore[taskKey]);
      isBanned = Boolean(global.dailyMemoryStore[banKey]);
      if (deviceId && global.dailyMemoryStore[deviceKey] && global.dailyMemoryStore[deviceKey] !== String(userId)) {
        deviceConflict = true;
      } else if (deviceId) {
        global.dailyMemoryStore[deviceKey] = userId;
      }
    }

    const requiredAdType = (taskDone || postsToday >= 1) ? 'reward' : 'task';

    return res.status(200).json({
      date: today,
      postsToday,
      taskCompletedToday: taskDone || postsToday >= 1,
      requiredAdType,
      isBanned,
      deviceConflict
    });
  } catch (err) {
    return res.status(200).json({
      date: today,
      postsToday: 0,
      taskCompletedToday: false,
      requiredAdType: 'task',
      isBanned: false,
      deviceConflict: false
    });
  }
}
