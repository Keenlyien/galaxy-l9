import { sendDiscord } from "./discordNotify.js";
import { getBossesFromDB, updateBossFlags } from "./db.js";

const TEN_MIN = 10 * 60 * 1000;

export async function checkRespawns() {
    const bosses = await getBossesFromDB();
    const now = Date.now();

    for (const boss of bosses) {
        if (!boss.last_killed || !boss.respawn_hours) continue;

        const respawnAt = boss.last_killed + boss.respawn_hours * 3600000;

        // 10-minute warning
        if (
            respawnAt - now <= TEN_MIN &&
            respawnAt - now > 0 &&
            !boss.notified_10m
        ) {
            await sendDiscord(
                `⏰ **${boss.name}** respawns in 10 minutes!`
            );

            await updateBossFlags(boss.name, { notified_10m: true });
        }

        // Respawn alert
        if (now >= respawnAt && !boss.notified_spawn) {
            await sendDiscord(
                `🔔 **${boss.name}** has respawned!`
            );

            await updateBossFlags(boss.name, { notified_spawn: true });
        }
    }
}
