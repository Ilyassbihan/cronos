require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');

if (!process.env.BOT_TOKEN) {
    console.error('FATAL: BOT_TOKEN is missing in environment variables.');
    process.exit(1);
}

const bot = new Telegraf(process.env.BOT_TOKEN);
const XON_BASE_URL = 'https://api.xposedornot.com/v1';

// Global Error Handler
bot.catch((err, ctx) => {
    console.error(`Error for ${ctx.updateType}:`, err);
    ctx.reply('❌ An error occurred while processing your command.').catch(() => {});
});

// Helper: Format HTML text for safe output
const sanitize = (text) => String(text || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// --- XposedOrNot API Service ---
const XONService = {
    // GET /v1/check-email/{email}
    async checkEmail(email) {
        try {
            const response = await axios.get(`${XON_BASE_URL}/check-email/${encodeURIComponent(email)}`);
            return response.data;
        } catch (error) {
            if (error.response && error.response.status === 404) {
                return { status: 'safe', email };
            }
            throw error;
        }
    },

    // GET /v1/breach-analytics?email={email}
    async getAnalytics(email) {
        try {
            const response = await axios.get(`${XON_BASE_URL}/breach-analytics`, {
                params: { email }
            });
            return response.data;
        } catch (error) {
            if (error.response && error.response.status === 404) {
                return { status: 'safe', email };
            }
            throw error;
        }
    },

    // GET /v1/breaches
    async getBreaches(domain = null) {
        const params = domain ? { domain } : {};
        const response = await axios.get(`${XON_BASE_URL}/breaches`, { params });
        return response.data;
    }
};

// --- Main Menu Interface ---
const getMainMenu = () => {
    return Markup.inlineKeyboard([
        [
            Markup.button.callback('📊 Breach Analytics', 'menu_analytics'),
            Markup.button.callback('🔍 Quick Email Check', 'menu_check')
        ],
        [
            Markup.button.callback('📂 Browse Breaches', 'menu_breaches'),
            Markup.button.callback('⚙️ System Status', 'menu_status')
        ]
    ]);
};

// --- Commands ---

bot.start(async (ctx) => {
    const welcomeText = 
        `👋 <b>Welcome to the Intelligence Bot!</b>\n\n` +
        `Powered by <b>XposedOrNot</b> threat data.\n\n` +
        `<b>Available Commands:</b>\n` +
        `• <code>/analytics &lt;email&gt;</code> - Deep breach analytics & metrics\n` +
        `• <code>/checkemail &lt;email&gt;</code> - Quick breach check\n` +
        `• <code>/breaches &lt;domain&gt;</code> - Inspect specific domain leaks\n` +
        `• <code>/status</code> - View bot health`;

    await ctx.replyWithHTML(welcomeText, getMainMenu());
});

// Command: /analytics <email>
bot.command('analytics', async (ctx) => {
    const email = ctx.payload.trim();

    if (!email || !email.includes('@')) {
        return ctx.replyWithHTML('⚠️ Please specify a valid email address.\n\nExample:\n<code>/analytics user@example.com</code>');
    }

    const statusMsg = await ctx.replyWithHTML(`⏳ Querying XposedOrNot analytics for <code>${sanitize(email)}</code>...`);

    try {
        const data = await XONService.getAnalytics(email);

        if (data.status === 'safe' || !data.BreachesSummary) {
            return ctx.telegram.editMessageText(
                ctx.chat.id,
                statusMsg.message_id,
                undefined,
                `🛡️ <b>Good news!</b> No breach records found for <code>${sanitize(email)}</code> in XposedOrNot databases.`,
                { parse_mode: 'HTML' }
            );
        }

        const summary = data.BreachesSummary || {};
        const breaches = data.ExposedBreaches?.breaches_details || [];
        const topBreaches = breaches.slice(0, 5).map(b => `• <b>${sanitize(b.breach)}</b> (${b.xposed_records?.toLocaleString() || 'N/A'} records)`).join('\n');
        const exposedData = data.xposed_data || 'N/A';

        const report = 
            `📊 <b>XposedOrNot Breach Analytics Report</b>\n\n` +
            `🎯 <b>Target:</b> <code>${sanitize(email)}</code>\n` +
            `💥 <b>Total Breaches:</b> <code>${summary.total_breaches || breaches.length}</code>\n` +
            `⚠️ <b>Risk Score:</b> <code>${summary.risk_score || 'N/A'}</code>\n` +
            `🗓️ <b>First Detected:</b> <code>${summary.first_breach || 'N/A'}</code>\n\n` +
            `🔓 <b>Exposed Data Types:</b>\n<code>${sanitize(exposedData)}</code>\n\n` +
            `🏢 <b>Top Affected Entities:</b>\n${topBreaches || 'None listed'}`;

        await ctx.telegram.editMessageText(
            ctx.chat.id,
            statusMsg.message_id,
            undefined,
            report,
            { parse_mode: 'HTML' }
        );

    } catch (error) {
        console.error('XON Analytics Error:', error.message);
        await ctx.telegram.editMessageText(
            ctx.chat.id,
            statusMsg.message_id,
            undefined,
            '❌ Failed to fetch analytics data. Rate limit exceeded or host unreachable.',
            { parse_mode: 'HTML' }
        );
    }
});

// Command: /checkemail <email>
bot.command('checkemail', async (ctx) => {
    const email = ctx.payload.trim();

    if (!email || !email.includes('@')) {
        return ctx.replyWithHTML('⚠️ Usage: <code>/checkemail target@example.com</code>');
    }

    try {
        const data = await XONService.checkEmail(email);

        if (data.status === 'safe' || !data.breaches) {
            return ctx.replyWithHTML(`✅ <code>${sanitize(email)}</code> was <b>not found</b> in any public leaks.`);
        }

        const breachList = Array.isArray(data.breaches[0]) ? data.breaches[0].join(', ') : data.breaches.join(', ');

        const text = 
            `🚨 <b>Breach Alert Detected!</b>\n\n` +
            `<b>Email:</b> <code>${sanitize(email)}</code>\n` +
            `<b>Exposed in:</b>\n<code>${sanitize(breachList)}</code>\n\n` +
            `💡 <i>Run <code>/analytics ${sanitize(email)}</code> for full exposure metrics.</i>`;

        await ctx.replyWithHTML(text);
    } catch (error) {
        await ctx.reply('❌ Error checking email exposure status.');
    }
});

// Command: /breaches [domain]
bot.command('breaches', async (ctx) => {
    const domain = ctx.payload.trim();

    try {
        const data = await XONService.getBreaches(domain || null);
        const breachArray = Array.isArray(data) ? data : data.exposed_breaches || [];

        if (breachArray.length === 0) {
            return ctx.replyWithHTML(`No breaches found for domain: <code>${sanitize(domain)}</code>`);
        }

        const count = breachArray.length;
        const samples = breachArray.slice(0, 8).map(b => `• <b>${sanitize(b.BreachID || b.name || b)}</b>`).join('\n');

        const text = 
            `📂 <b>XposedOrNot Breach Repository</b>\n\n` +
            (domain ? `<b>Domain Filter:</b> <code>${sanitize(domain)}</code>\n` : '') +
            `<b>Total Breaches Listed:</b> ${count}\n\n` +
            `<b>Recent Examples:</b>\n${samples}`;

        await ctx.replyWithHTML(text);
    } catch (error) {
        await ctx.reply('❌ Unable to retrieve breach list from repository.');
    }
});

// Interface Handlers
bot.action('menu_analytics', (ctx) => {
    ctx.answerCbQuery();
    ctx.replyWithHTML('Type: <code>/analytics email@example.com</code> to run a deep analysis.');
});

bot.action('menu_check', (ctx) => {
    ctx.answerCbQuery();
    ctx.replyWithHTML('Type: <code>/checkemail email@example.com</code> for a fast leak check.');
});

bot.action('menu_breaches', (ctx) => {
    ctx.answerCbQuery();
    ctx.replyWithHTML('Type: <code>/breaches domain.com</code> to search domain incidents.');
});

bot.action('menu_status', (ctx) => {
    ctx.answerCbQuery();
    const mode = process.env.WEBHOOK_DOMAIN ? 'Webhook (Live Server)' : 'Polling (Local Dev)';
    ctx.replyWithHTML(`⚙️ <b>Status:</b> Active\n🌐 <b>Mode:</b> <code>${mode}</code>\n🔗 <b>API Provider:</b> XposedOrNot`);
});

// Webhook & Deployment Compatibility
const PORT = process.env.PORT || 3000;
const WEBHOOK_DOMAIN = process.env.WEBHOOK_DOMAIN;

if (WEBHOOK_DOMAIN) {
    bot.launch({
        webhook: {
            domain: WEBHOOK_DOMAIN,
            port: Number(PORT)
        }
    }).then(() => console.log(`[SERVER] Webhook running on port ${PORT}`));
} else {
    bot.launch().then(() => console.log('[SERVER] Polling mode active'));
}

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
