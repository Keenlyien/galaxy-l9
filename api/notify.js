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

export default async function handler(req, res) {
  try {
    console.log("Notify API called", req.method, req.body);
    const client = await getClient();
    const db = client.db("galaxy_l9");

    const settingsCollection = db.collection("settings");
    const discordSettings = await settingsCollection.findOne({ type: "discord" });

    if (!discordSettings?.data?.enabled) {
      return res.status(200).json({ message: "Notifications disabled" });
    }

    if (!discordSettings?.data?.webhookUrl) {
      return res.status(200).json({ message: "No webhook configured" });
    }

    const { webhookUrl, roleId } = discordSettings.data;
    const { bossName, unkill, killed } = req.body;

    if (!bossName) {
      return res.status(400).json({ error: "bossName is required" });
    }

    const boss = await db.collection("bosses").findOne({ name: bossName });
    if (!boss) {
      return res.status(404).json({ error: "Boss not found" });
    }

    let content;
    if (unkill) {
      content = `**${boss.name}** (Lv. ${boss.level}) at ${boss.location} has respawned!`;
    } else if (killed) {
      content = `**${boss.name}** killed at ${boss.location}!`;
    } else {
      return res.status(400).json({ error: "Must specify unkill or killed" });
    }

    if (roleId) content = `<@&${roleId}> ${content}`;

    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content,
        embeds: [{
          title: unkill ? "Boss Respawned!" : "Boss Killed!",
          description: content,
          color: unkill ? 0x22c55e : 0xef4444,
          timestamp: new Date().toISOString()
        }]
      })
    });

    if (!response.ok) {
      console.error("Discord webhook failed:", response.status, await response.text());
      return res.status(500).json({ error: "Failed to send notification" });
    }

    res.status(200).json({ success: true, message: content });
  } catch (err) {
    console.error("notify API error:", err);
    res.status(500).json({ error: err.message });
  }
}
