import { MongoClient } from "mongodb";
import fs from "fs";
import path from "path";

let client;
const uri = process.env.MONGODB_URI;
const imagesDir = path.join(process.cwd(), "images");

// Ensure images directory exists
if (!fs.existsSync(imagesDir)) {
    fs.mkdirSync(imagesDir, { recursive: true });
}

export default async function handler(req, res) {
    if (!client) {
        client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true });
        await client.connect();
    }

    const db = client.db("galaxy_l9");
    const collection = db.collection("bosses");

    try {
        if (req.method === "POST") {
            // Add or Edit boss
            const { name, location, level, respawn, imageData, editingBossName } = req.body;

            if (!name || !location || level === undefined || !respawn) {
                return res.status(400).json({ error: "Missing required fields" });
            }

            let imagePath = null;

            // Handle image upload
            if (imageData) {
                try {
                    // Convert base64 to buffer
                    const base64Data = imageData.replace(/^data:image\/\w+;base64,/, "");
                    const buffer = Buffer.from(base64Data, "base64");

                    // Check size (4MB max)
                    if (buffer.length > 4 * 1024 * 1024) {
                        return res.status(400).json({ error: "Image must be less than 4MB" });
                    }

                    // Generate filename
                    const timestamp = Date.now();
                    const ext = imageData.match(/data:image\/(\w+)/)?.[1] || "png";
                    const filename = `${name.replace(/\s+/g, "_")}_${timestamp}.${ext}`;
                    imagePath = `images/${filename}`;

                    // Save image file
                    fs.writeFileSync(path.join(imagesDir, filename), buffer);
                } catch (err) {
                    console.error("Image processing error:", err);
                    return res.status(500).json({ error: "Failed to process image" });
                }
            }

            if (editingBossName) {
                // Edit existing boss
                const updateData = {
                    name,
                    location,
                    level: parseInt(level),
                    respawn
                };

                // Only update image path if new image was provided
                if (imagePath) {
                    updateData.image = imagePath;
                }

                await collection.updateOne(
                    { name: editingBossName },
                    { $set: updateData }
                );

                return res.status(200).json({ success: true, message: "Boss updated" });
            } else {
                // Add new boss
                const newBoss = {
                    name,
                    location,
                    level: parseInt(level),
                    respawn,
                    last_killed: null
                };

                if (imagePath) {
                    newBoss.image = imagePath;
                }

                await collection.insertOne(newBoss);
                return res.status(200).json({ success: true, message: "Boss added" });
            }
        } else if (req.method === "DELETE") {
            // Delete boss
            const { bossName } = req.body;

            if (!bossName) {
                return res.status(400).json({ error: "Missing bossName" });
            }

            // Get boss to find associated image
            const boss = await collection.findOne({ name: bossName });

            // Delete image file if exists
            if (boss?.image) {
                try {
                    const imagePath = path.join(process.cwd(), boss.image);
                    if (fs.existsSync(imagePath)) {
                        fs.unlinkSync(imagePath);
                    }
                } catch (err) {
                    console.error("Failed to delete image:", err);
                }
            }

            // Delete boss from database
            const result = await collection.deleteOne({ name: bossName });

            if (result.deletedCount === 0) {
                return res.status(404).json({ error: "Boss not found" });
            }

            return res.status(200).json({ success: true, message: "Boss deleted" });
        } else {
            return res.status(405).json({ error: "Method Not Allowed" });
        }
    } catch (err) {
        console.error("Error in manageBoss:", err);
        return res.status(500).json({ error: err.message });
    }
}
