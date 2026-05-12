import { MongoClient } from "mongodb";

const uri = process.env.MONGODB_URI;

let client;

async function getClient() {
  if (!client) {
    if (!uri) throw new Error("Database configuration missing");
    client = new MongoClient(uri);
    await client.connect();
  }
  return client;
}

function parseRespawnHours(text) {
  if (!text) return null;
  const match = text.match(/(\d+)\s*Hour/i);
  if (match) return parseInt(match[1], 10);
  // Also check for just numbers
  const numMatch = text.match(/(\d+)/);
  return numMatch ? parseInt(numMatch[1], 10) : null;
}

function parseWeeklyRespawns(text) {
  if (!text) return null;
  const entries = text.split(",").map(t => t.trim());
  const times = [];
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  
  entries.forEach(entry => {
    const match = entry.match(/(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s+(\d{1,2}):(\d{2})/i);
    if (match) {
      times.push({
        weekday: match[1],
        hour: parseInt(match[2]),
        minute: parseInt(match[3])
      });
    }
  });
  return times.length > 0 ? times : null;
}

function getNextWeeklySpawn(schedule) {
  const now = new Date();
  const nowUtcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  const baseNow = new Date(nowUtcMs + 8 * 3600000);
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  
  let soonest = null;
  
  schedule.forEach(item => {
    const targetDay = days.indexOf(item.weekday);
    const d = new Date(baseNow);
    const today = baseNow.getDay();
    
    let diff = targetDay - today;
    if (diff < 0) diff += 7;
    
    d.setDate(baseNow.getDate() + diff);
    d.setHours(item.hour, item.minute, 0, 0);
    
    if (d <= baseNow) {
      d.setDate(d.getDate() + 7);
    }
    
    if (!soonest || d < soonest) soonest = d;
  });
  
  if (soonest) {
    return soonest.getTime() + (8 - 8) * 3600000;
  }
  return null;
}

export default async function handler(req, res) {
  try {
    console.log("Notify API called");
    const client = await getClient();
    const db = client.db("galaxy_l9");
    
    // Get Discord settings
    const settingsCollection = db.collection("settings");
    const discordSettings = await settingsCollection.findOne({ type: "discord" });
    
    if (!discordSettings?.data?.enabled) {
      return res.status(200).json({ message: "Notifications disabled" });
    }
    
    if (!discordSettings?.data?.webhookUrl) {
      return res.status(200).json({ message: "No webhook configured" });
    }
    
    const { webhookUrl, roleId, notifyIntervals } = discordSettings.data;
    console.log("Settings loaded:", { enabled: discordSettings.data.enabled, intervals: notifyIntervals });
    
    const now = Date.now();
    const bosses = await db.collection("bosses").find({}).toArray();
    console.log("Found bosses:", bosses.length);
    
    const notifications = [];
    const notifiedKey = "discord_notified_" + new Date().toISOString().slice(0, 13); // hourly key
    
    for (const boss of bosses) {
      if (!boss.last_killed) continue;
      
      const hours = parseRespawnHours(boss.respawn);
      const weekly = parseWeeklyRespawns(boss.respawn);
      
      let respawnTime = null;
      
      if (hours !== null) {
        const respawnMs = hours * 3600 * 1000;
        respawnTime = Number(boss.last_killed) + respawnMs;
      } else if (weekly) {
        respawnTime = getNextWeeklySpawn(weekly);
      }
      
      if (!respawnTime) continue;
      
      const timeUntilRespawn = respawnTime - now;
      console.log(`${boss.name}: respawn in ${Math.round(timeUntilRespawn/60000)}min`);
      
      // Check each interval
      for (const interval of notifyIntervals) {
        const key = `${boss.name}-${interval}`;
        
        // Get notified times from localStorage on the server-side we can't access
        // So we'll track with a simple time-based check
        
        if (interval === 0) {
          // "Now" - respawned within last 2 minutes
          if (timeUntilRespawn <= 0 && timeUntilRespawn > -120000) {
            let content = `✅ **${boss.name}** (Lv. ${boss.level}) at ${boss.location} has respawned!`;
            if (roleId) content = `<@&${roleId}> ${content}`;
            notifications.push({ key, content, boss: boss.name, type: 'respawned' });
          }
        } else {
          // Pre-respawn notifications - within 1 minute of the interval
          const intervalMs = interval * 60 * 1000;
          if (timeUntilRespawn > 0 && timeUntilRespawn <= intervalMs + 60000 && timeUntilRespawn >= intervalMs - 60000) {
            const timeText = interval >= 60 ? `${Math.floor(interval/60)}h` : `${interval}m`;
            let content = `🎯 **${boss.name}** (Lv. ${boss.level}) respawns in ${timeText}!`;
            if (roleId) content = `<@&${roleId}> ${content}`;
            notifications.push({ key, content, boss: boss.name, type: 'warning', interval });
          }
        }
      }
    }
    
    console.log("Notifications to send:", notifications.length);
    
    // Send notifications
    for (const notif of notifications) {
      try {
        const body = notif.type === 'respawned' 
          ? { content: notif.content, embeds: [{ title: "🔔 Boss Respawned!", description: notif.content, color: 0x22c55e }] }
          : { content: notif.content, embeds: [{ title: "⏰ Boss Respawn Soon!", description: notif.content, color: 0xf59e0b }] };
        
        await fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body)
        });
        console.log("Sent:", notif.boss);
      } catch (e) {
        console.error("Failed to send:", notif.boss, e.message);
      }
    }
    
    res.status(200).json({ success: true, sent: notifications.length });
  } catch (err) {
    console.error("notify API error:", err);
    res.status(500).json({ error: err.message });
  }
}