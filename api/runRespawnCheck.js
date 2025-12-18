import { checkRespawns } from "./respawnChecker.js";

export default async function handler(req, res) {
    await checkRespawns();
    res.status(200).send("OK");
}
