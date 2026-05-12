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

export default async function handler(req, res) {
  try {
    const client = await getClient();
    const db = client.db("galaxy_l9");
    const collection = db.collection("settings");

    if (req.method === "GET") {
      const settings = await collection.findOne({ type: "discord" });
      res.status(200).json(settings?.data || { 
        webhookUrl: "", 
        roleId: "", 
        notifyIntervals: [5, 10, 15, 20],
        enabled: false 
      });
    } 
    else if (req.method === "POST") {
      const { webhookUrl, roleId, notifyIntervals, enabled } = req.body;
      
      await collection.updateOne(
        { type: "discord" },
        { 
          $set: { 
            type: "discord",
            data: {
              webhookUrl: webhookUrl || "",
              roleId: roleId || "",
              notifyIntervals: notifyIntervals || [5, 10, 15, 20],
              enabled: enabled || false
            },
            updatedAt: new Date()
          }
        },
        { upsert: true }
      );
      
      res.status(200).json({ success: true });
    }
    else {
      res.status(405).json({ error: "Method Not Allowed" });
    }
  } catch (err) {
    console.error("discord API error:", err);
    res.status(500).json({ error: err.message || "Internal server error" });
  }
}