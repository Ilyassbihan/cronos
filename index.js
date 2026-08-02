require('dotenv').config();
const { Telegraf } = require('telegraf');

// Initialize bot using the environment variable
const bot = new Telegraf(process.env.BOT_TOKEN);

// --- Commands ---
bot.start((ctx) => {
    ctx.reply('🚀 Bot is online and ready!');
});

bot.command('status', (ctx) => {
    const mode = process.env.WEBHOOK_DOMAIN ? 'Webhook (Host)' : 'Polling (Local)';
    ctx.reply(`✅ System Active | Mode: ${mode}`);
});

bot.on('text', (ctx) => {
    ctx.reply(`Received: ${ctx.message.text}`);
});

// --- Hosting Setup ---
const PORT = process.env.PORT || 3000;
const WEBHOOK_DOMAIN = process.env.WEBHOOK_DOMAIN;

if (WEBHOOK_DOMAIN) {
    // Production Webhook Mode for justhostmyapp.app
    bot.launch({
        webhook: {
            domain: WEBHOOK_DOMAIN,
            port: PORT
        }
    }).then(() => console.log(`[Host] Webhook running on port ${PORT}`));
} else {
    // Development Polling Mode (Local / Codespaces)
    bot.launch().then(() => console.log('[Dev] Bot running via Polling'));
}

// Graceful Shutdown
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
