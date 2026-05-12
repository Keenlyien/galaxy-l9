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
      times.push({ weekday: match[1], hour: parseInt(match[2]), minute: parseInt(match[3]) });
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
    if (d <= baseNow) d.setDate(d.getDate() + 7);
    if (!soonest || d < soonest) soonest = d;
  });

  if (soonest) return soonest.getTime() + (8 - 8) * 3600000;
  return null;
}

async function sendDiscordMessage(webhookUrl, content, title, color) {
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      content,
      embeds: [{
        title,
        description: content,
        color,
        timestamp: new Date().toISOString()
      }]
    })
  });

  if (response.ok) {
    console.log("Sent:", content);
    return true;
  } else {
    console.error("Failed:", response.status, await response.text());
    return false;
  }
}

export default async function handler(req, res) {
  try {
    const body = typeof req.body === 'object' ? req.body : {};
    console.log("Notify API called", req.method, body);

    // Allow both GET and POST for cron job compatibility
    if (req.method !== 'GET' && req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }
    
    const client = await getClient();
    const db = client.db("galaxy_l9");

    const settingsCollection = db.collection("settings");
    const discordSettings = await settingsCollection.findOne({ type: "discord" });
    console.log("Discord settings found:", JSON.stringify(discordSettings));

    if (!discordSettings?.data?.enabled) {
      console.log("Notifications disabled in settings");
      return res.status(200).json({ message: "Notifications disabled" });
    }

    if (!discordSettings?.data?.webhookUrl) {
      console.log("No webhook configured");
      return res.status(200).json({ message: "No webhook configured" });
    }

    const { webhookUrl, roleId } = discordSettings?.data || {};
    const { bossName, unkill, killed } = body;
    
    const bosses = await db.collection("bosses").find({}).toArray();
    const now = Date.now();

    const sent = [];

    if (bossName && (unkill || killed)) {
      const boss = bosses.find(b => b.name === bossName);
      if (!boss) return res.status(404).json({ error: "Boss not found" });

      let content;
      if (unkill) {
        content = `**${boss.name}** (Lv. ${boss.level}) at ${boss.location} has respawned!`;
      } else {
        content = `**${boss.name}** killed at ${boss.location}!`;
      }
      if (roleId) content = `<@&${roleId}> ${content}`;

      await sendDiscordMessage(
        webhookUrl,
        content,
        unkill ? "Boss Respawned!" : "Boss Killed!",
        unkill ? 0x22c55e : 0xef4444
      );
      sent.push({ boss: boss.name, type: unkill ? "respawned" : "killed" });

      return res.status(200).json({ success: true, sent });
    }

    // Pre-notification logic removed - will be implemented differently

    res.status(200).json({ success: true, sent });
  } catch (err) {
    console.error("notify API error:", err);
    res.status(500).json({ error: err.message });
  }
}
