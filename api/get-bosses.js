import clientPromise from "../../lib/mongodb";

export const config = { runtime: "nodejs" };

export default async function handler(req, res) {
  try {
    const client = await clientPromise;
    const db = client.db("galaxy_l9");
    const bosses = await db.collection("bosses").find({}).toArray();
    res.json(bosses);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
}
