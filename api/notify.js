import { MongoClient } from "mongodb";

const uri = process.env.MONGODB_URI;

if (!uri) {
  console.error("MONGODB_URI environment variable is not set!");
}

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
  const match = text.match(/(\d+)\s*Hour/);
  return match ? parseInt(match[1], 10) : null;
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

function getNextWeeklySpawn(schedule, tzOffset = 8) {
  const now = new Date();
  const nowUtcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  const baseNow = new Date(nowUtcMs + 8 * 3600000);
  
  let soonest = null;
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  
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
    return soonest.getTime() + (tzOffset - 8) * 3600000;
  }
  return null;
}

function weekdayToIndex(day) {
  return ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"].indexOf(day);
}

export default async function handler(req, res) {
  try {
    const client = await getClient();
    const db = client.db("galaxy_l9");
    
    // Get Discord settings
    const settingsCollection = db.collection("settings");
    const discordSettings = await settingsCollection.findOne({ type: "discord" });
    
    if (!discordSettings?.data?.enabled || !discordSettings?.data?.webhookUrl) {
      return res.status(200).json({ message: "Notifications disabled or no webhook configured" });
    }
    
    const { webhookUrl, roleId, notifyIntervals } = discordSettings.data;
    const now = Date.now();
    
    // Get all bosses
    const bosses = await db.collection("bosses").find({}).toArray();
    
    const notifications = [];
    
    for (const boss of bosses) {
      const lastKilled = boss.last_killed;
      if (!lastKilled) continue;
      
      const hours = parseRespawnHours(boss.respawn);
      const weekly = parseWeeklyRespawns(boss.respawn);
      
      let respawnTime = null;
      
      if (hours !== null) {
        const respawnMs = hours * 3600 * 1000;
        respawnTime = Number(lastKilled) + respawnMs;
      } else if (weekly) {
        respawnTime = getNextWeeklySpawn(weekly, 8);
      }
      
      if (!respawnTime) continue;
      
      const timeUntilRespawn = respawnTime - now;
      
      // Check if any interval matches
      for (const interval of notifyIntervals) {
        const intervalMs = interval * 60 * 1000;
        const diff = Math.abs(timeUntilRespawn - intervalMs);
        
        // Within 1 minute tolerance
        if (diff < 60000 && timeUntilRespawn > 0 && timeUntilRespawn < intervalMs + 60000) {
          // Check if we already notified for this interval (store in localStorage on client, 
          // but for now we'll just send)
          
          const timeText = interval >= 60 
            ? `${Math.floor(interval/60)} hour${interval >= 120 ? 's' : ''}` 
            : `${interval} minute${interval > 1 ? 's' : ''}`;
          
          let content = `🎯 **${boss.name}** (Lv. ${boss.level}) at ${boss.location} will respawn in ${timeText}!`;
          if (roleId) {
            content = `<@&${roleId}> ${content}`;
          }
          
          notifications.push({
            boss: boss.name,
            respawnTime: new Date(respawnTime).toISOString(),
            interval: interval,
            content
          });
        }
      }
    }
    
    // Send Discord notifications (deduplicate by boss+interval)
    const sent = new Set();
    for (const notif of notifications) {
      const key = `${notif.boss}-${notif.interval}`;
      if (sent.has(key)) continue;
      sent.add(key);
      
      try {
        await fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ 
            content: notif.content,
            embeds: [{
              title: "Boss Respawn Alert",
              description: notif.content,
              color: 0x6366f1,
              fields: [
                { name: "Boss", value: notif.boss, inline: true },
                { name: "Respawn At", value: new Date(notif.respawnTime).toLocaleString(), inline: true }
              ]
            }]
          })
        });
      } catch (e) {
        console.error("Failed to send notification:", e);
      }
    }
    
    res.status(200).json({ 
      success: true, 
      notificationsSent: sent.size,
      details: notifications
    });
  } catch (err) {
    console.error("notify API error:", err);
    res.status(500).json({ error: err.message });
  }
}