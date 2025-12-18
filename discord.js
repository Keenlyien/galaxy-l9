const webhookUrl = 'https://discord.com/api/webhooks/1450765161085407308/6FG1vsuRbUmXLeNhaZ3eGX_2zsd5CSiuZCq_N3GWU3ShyZ1--hFY-3G2tYutEWA7i_Fx'; // Replace with your webhook URL
const roleId = '1450764771220652092'; // Replace with the actual role ID

async function sendDiscordMessage(message) {
    const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            content: `<@&${roleId}> ${message}`
        })
    });

    if (!response.ok) {
        throw new Error(`Failed to send message: ${response.status}`);
    }
}

// Example usage:
const bossName = 'Boss Name';
const timeLeft = 10 * 60 * 1000; // 10 minutes in milliseconds
const now = Date.now();
const respawnAt = now + timeLeft;

// Check if the boss is about to respawn
if (timeLeft <= 0) {
    sendDiscordMessage(`@everyone ${bossName} is respawning!`);
} else {
    const timeRemaining = new Date(respawnAt - Date.now());
    const minutes = Math.floor(timeRemaining / (1000 * 60));
    const seconds = Math.floor((timeRemaining % (1000 * 60)) / 1000);
    sendDiscordMessage(`@everyone ${bossName} will respawn in ${minutes}m ${seconds}s!`);
}