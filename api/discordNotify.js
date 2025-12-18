export async function sendDiscord(message) {
    const webhook = process.env.DISCORD_WEBHOOK_URL;
    const roleId = process.env.DISCORD_ROLE_ID;

    if (!webhook || !roleId) {
        console.error("Discord env vars missing");
        return;
    }

    await fetch(webhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            content: `<@&${roleId}> ${message}`
        })
    });
}
