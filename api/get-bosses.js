// api/get-bosses.js
import clientPromise from "../lib/mongodb.js";

export const config = {
  runtime: "nodejs"
};

export default async function handler(req, res) {
  try {
    const client = await clientPromise;
    const db = client.db("galaxy_l9");

    const bosses = await db.collection("bosses").find({}).toArray();

    res.status(200).json(bosses);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load bosses" });
  }
}
