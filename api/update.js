import clientPromise from "../../lib/mongodb";
import { getSSEController } from "../../lib/sseController";


export const config = {
runtime: "nodejs",
};


export default async function handler(req, res) {
if (req.method !== "POST") return res.status(405).end();


try {
const { name, status, respawntime } = req.body;
if (!name || !status) return res.status(400).json({ error: "Missing fields" });


const client = await clientPromise;
const db = client.db("galaxy_l9");


await db.collection("bosses").updateOne(
{ name },
{
$set: {
name,
status,
respawntime: respawntime || null,
lastUpdated: new Date(),
},
},
{ upsert: true }
);


const { broadcast } = getSSEController();
broadcast({ name, status, respawntime });


res.json({ success: true });
} catch (err) {
console.error(err);
res.status(500).json({ error: "Server error" });
}
}
