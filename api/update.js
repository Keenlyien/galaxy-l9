// api/update.js
import clientPromise from "../lib/mongodb.js";
import { broadcast } from "./events.js";

export const config = {
  runtime: "nodejs"
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST only" });
  }

  try {
    const { name } = JSON.parse(req.body);
    if (!name) return res.status(400).json({ error: "Missing boss name" });

    const client = await clientPromise;
    const db = client.db("galaxy_l9");

    const now = new Date();

    await db.collection("bosses").updateOne(
      { name },
      { $set: { last_killed: now } }
    );

    // 🔥 Broadcast the update to all connected clients
    broadcast({
      type: "update",
      name,
      last_killed: now
    });

    return res.status(200).json({ success: true });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
}
