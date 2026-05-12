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
    console.log("Notify API called", req.body);
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
    const notifications = [];
    const bosses = await db.collection("bosses").find({}).toArray();
    const now = Date.now();
    
    // Immediate triggers from UI
    const isKillTrigger = req.body?.killed === true;
    const isUnkillTrigger = req.body?.unkill === true;
    const triggerBoss = req.body?.bossName;
    
    // Handle KILL - send respawn time notification
    if (isKillTrigger && triggerBoss) {
      const boss = bosses.find(b => b.name === triggerBoss);
      if (boss) {
        const hours = parseRespawnHours(boss.respawn);
        if (hours !== null && hours > 0) {
          const totalMinutes = Math.round(hours * 60);
          const hoursVal = Math.floor(totalMinutes / 60);
          const minsVal = totalMinutes % 60;
          let timeText = "";
          if (hoursVal > 0 && minsVal > 0) timeText = `${hoursVal}h ${minsVal}m`;
          else if (hoursVal > 0) timeText = `${hoursVal} hour(s)`;
          else timeText = `${minsVal} minutes`;
          
          let content = `💀 **${boss.name}** (Lv. ${boss.level}) at ${boss.location} killed! Respawns in **${timeText}**`;
          if (roleId) content = `<@&${roleId}> ${content}`;
          notifications.push({ content, type: 'killed' });
        }
      }
    }
    
    // Handle UNKILL - send spawned notification
    else if (isUnkillTrigger && triggerBoss) {
      const boss = bosses.find(b => b.name === triggerBoss);
      if (boss) {
        let content = `✅ **${boss.name}** (Lv. ${boss.level}) at ${boss.location} has respawned!`;
        if (roleId) content = `<@&${roleId}> ${content}`;
        notifications.push({ content, type: 'respawned' });
      }
    }
    
    // Normal check from cron - check all bosses
    else {
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
        const minutesUntil = Math.round(timeUntilRespawn / 60000);
        
        console.log(`${boss.name}: ${minutesUntil} minutes (${timeUntilRespawn}ms)`);
        
        // Check "Now" - respawned within last 2 minutes
        if (notifyIntervals.includes(0) && timeUntilRespawn <= 0 && timeUntilRespawn > -120000) {
          let content = `✅ **${boss.name}** (Lv. ${boss.level}) at ${boss.location} has respawned!`;
          if (roleId) content = `<@&${roleId}> ${content}`;
          notifications.push({ content, type: 'respawned' });
        }
        
        // Check pre-respawn intervals (only for future respawns)
        if (timeUntilRespawn > 0) {
          for (const interval of notifyIntervals) {
            if (interval === 0) continue;
            
            const intervalMs = interval * 60 * 1000;
            const diff = Math.abs(timeUntilRespawn - intervalMs);
            
            // Within 30 seconds of the interval
            if (diff < 30000) {
              const timeText = interval >= 60 ? `${Math.floor(interval/60)} hour(s)` : `${interval} minutes`;
              let content = `🎯 **${boss.name}** (Lv. ${boss.level}) at ${boss.location} will respawn in **${timeText}**!`;
              if (roleId) content = `<@&${roleId}> ${content}`;
              notifications.push({ content, type: 'warning', interval });
              console.log("Will send warning for:", boss.name, "at", interval, "min");
              break;
            }
          }
        }
      }
    }
    
    console.log("Total notifications to send:", notifications.length);
    
    // Send all notifications
    for (const notif of notifications) {
      try {
        let title, color;
        if (notif.type === 'killed') {
          title = "💀 Boss Killed!";
          color = 0xef4444;
        } else if (notif.type === 'respawned') {
          title = "✅ Boss Respawned!";
          color = 0x22c55e;
        } else {
          title = "⏰ Boss Respawn Soon!";
          color = 0xf59e0b;
        }
        
        await fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            content: notif.content,
            embeds: [{
              title,
              description: notif.content,
              color,
              timestamp: new Date().toISOString()
            }]
          })
        });
        console.log("Sent:", notif.content);
      } catch (e) {
        console.error("Failed to send:", e.message);
      }
    }
    
    res.status(200).json({ success: true, sent: notifications.length });
  } catch (err) {
    console.error("notify API error:", err);
    res.status(500).json({ error: err.message });
  }
}