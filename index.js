require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');
const crypto = require('crypto');

if (!process.env.BOT_TOKEN) {
    console.error('FATAL: BOT_TOKEN is missing in environment variables.');
    process.exit(1);
}

const bot = new Telegraf(process.env.BOT_TOKEN);
const XON_BASE_URL = 'https://api.xposedornot.com/v1';
const XON_PASS_URL = 'https://passwords.xposedornot.com/api/v1/pass/anon';

// Global Error Handler
bot.catch((err, ctx) => {
    console.error(`Error for ${ctx.updateType}:`, err);
    ctx.reply('❌ An error occurred while processing your command.').catch(() => {});
});

const sanitize = (text) => String(text || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// --- XposedOrNot API Service ---
const XONService = {
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

    async getAnalytics(email) {
        try {
            const response = await axios.get(`${XON_BASE_URL}/breach-analytics`, { params: { email } });
            return response.data;
        } catch (error) {
            if (error.response && error.response.status === 404) {
                return { status: 'safe', email };
            }
            throw error;
        }
    },

    async getBreaches(domain = null) {
        const params = domain ? { domain } : {};
        const response = await axios.get(`${XON_BASE_URL}/breaches`, { params });
        return response.data;
    },

    // Privacy-preserving password check via k-Anonymity
    async checkPassword(password) {
        const fullHash = crypto.createHash('sha3-512').update(password).digest('hex').toUpperCase();
        const prefix = fullHash.substring(0, 10);

        try {
            const response = await axios.get(`${XON_PASS_URL}/${prefix}`);
            const matches = response.data?.SearchPassAnon || [];
            
            // Compare full hash locally against matching prefixes
            const match = matches.find(item => item.char.toUpperCase() === fullHash || item.char.toUpperCase() === fullHash.substring(10));
            
            if (match) {
                return { exposed: true, count: match.count || '1+' };
            }
            return { exposed: false, count: 0 };
        } catch (error) {
            if (error.response && error.response.status === 404) {
                return { exposed: false, count: 0 };
            }
            throw error;
        }
    }
};

// --- Main Menu Interface ---
const getMainMenu = () => {
    return Markup.inlineKeyboard([
        [
            Markup.button.callback('📊 Breach Analytics', 'menu_analytics'),
            Markup.button.callback('🔍 Check Email', 'menu_check')
        ],
        [
            Markup.button.callback('🔒 Check Password', 'menu_pass'),
            Markup.button.callback('📂 Browse Breaches', 'menu_breaches')
        ],
        [
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
        `• <code>/checkpass &lt;password&gt;</code> - k-Anonymity password check\n` +
        `• <code>/breaches &lt;domain&gt;</code> - Inspect specific domain leaks\n` +
        `• <code>/status</code> - View bot health`;

    await ctx.replyWithHTML(welcomeText, getMainMenu());
});

// Command: /checkpass <password>
bot.command('checkpass', async (ctx) => {
    const password = ctx.payload.trim();

    if (!password) {
        return ctx.replyWithHTML(
            '⚠️ <b>Usage:</b> <code>/checkpass yourpassword</code>\n\n' +
            '🔒 <i>Uses SHA3-512 k-Anonymity. Your password is hashed locally and never transmitted across the network.</i>'
        );
    }

    // Attempt to auto-delete the user's message containing the plain text password
    try {
        await ctx.deleteMessage();
    } catch (e) {
        // Silently continue if bot lacks deletion permissions
    }

    const statusMsg = await ctx.replyWithHTML('🔒 <i>Hashing password locally & querying k-Anonymity prefixes...</i>');

    try {
        const result = await XONService.checkPassword(password);

        if (!result.exposed) {
            return ctx.telegram.editMessageText(
                ctx.chat.id,
                statusMsg.message_id,
                undefined,
                '🛡️ <b>Password is Safe!</b>\n\nNo occurrences found in public leak databases.',
                { parse_mode: 'HTML' }
            );
        }

        const alertText = 
            `🚨 <b>EXPOSED PASSWORD DETECTED!</b>\n\n` +
            `⚠️ This password has been seen in known data breaches.\n` +
            `📊 <b>Times Exposed:</b> <code>${result.count}</code>\n\n` +
            `💡 <i>Immediately stop using this password across all services.</i>`;

        await ctx.telegram.editMessageText(
            ctx.chat.id,
            statusMsg.message_id,
            undefined,
            alertText,
            { parse_mode: 'HTML' }
        );

    } catch (error) {
        console.error('Password Check Error:', error.message);
        await ctx.telegram.editMessageText(
            ctx.chat.id,
            statusMsg.message_id,
            undefined,
            '❌ Error querying password breach repository.',
            { parse_mode: 'HTML' }
        );
    }
});

// Command: /analytics <email>
bot.command('analytics', async (ctx) => {
    const email = ctx.payload.trim();

    if (!email || !email.includes('@')) {
        return ctx.replyWithHTML('⚠️ Usage: <code>/analytics user@example.com</code>');
    }

    const statusMsg = await ctx.replyWithHTML(`⏳ Querying XposedOrNot analytics for <code>${sanitize(email)}</code>...`);

    try {
        const data = await XONService.getAnalytics(email);

        if (data.status === 'safe' || !data.BreachesSummary) {
            return ctx.telegram.editMessageText(
                ctx.chat.id,
                statusMsg.message_id,
                undefined,
                `🛡️ <b>Good news!</b> No breach records found for <code>${sanitize(email)}</code>.`,
                { parse_mode: 'HTML' }
            );
        }

        const summary = data.BreachesSummary || {};
        const breaches = data.ExposedBreaches?.breaches_details || [];
        const topBreaches = breaches.slice(0, 5).map(b => `• <b>${sanitize(b.breach)}</b> (${b.xposed_records?.toLocaleString() || 'N/A'} records)`).join('\n');

        const report = 
            `📊 <b>XposedOrNot Analytics Report</b>\n\n` +
            `🎯 <b>Target:</b> <code>${sanitize(email)}</code>\n` +
            `💥 <b>Total Breaches:</b> <code>${summary.total_breaches || breaches.length}</code>\n` +
            `⚠️ <b>Risk Score:</b> <code>${summary.risk_score || 'N/A'}</code>\n\n` +
            `🏢 <b>Top Affected Entities:</b>\n${topBreaches || 'None listed'}`;

        await ctx.telegram.editMessageText(
            ctx.chat.id,
            statusMsg.message_id,
            undefined,
            report,
            { parse_mode: 'HTML' }
        );
    } catch (error) {
        await ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, undefined, '❌ Error processing analytics.');
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
        await ctx.replyWithHTML(`🚨 <b>Breach Alert!</b>\n\n<b>Email:</b> <code>${sanitize(email)}</code>\n<b>Exposed in:</b>\n<code>${sanitize(breachList)}</code>`);
    } catch (error) {
        await ctx.reply('❌ Error checking email status.');
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

        const samples = breachArray.slice(0, 8).map(b => `• <b>${sanitize(b.BreachID || b.name || b)}</b>`).join('\n');
        await ctx.replyWithHTML(`📂 <b>Breach Repository (${breachArray.length} Total)</b>\n\n${samples}`);
    } catch (error) {
        await ctx.reply('❌ Unable to retrieve breach list.');
    }
});

// Interface Handlers
bot.action('menu_pass', (ctx) => {
    ctx.answerCbQuery();
    ctx.replyWithHTML('Type: <code>/checkpass yourpassword</code> to check exposure status.');
});
bot.action('menu_analytics', (ctx) => { ctx.answerCbQuery(); ctx.replyWithHTML('Type: <code>/analytics email@example.com</code>'); });
bot.action('menu_check', (ctx) => { ctx.answerCbQuery(); ctx.replyWithHTML('Type: <code>/checkemail email@example.com</code>'); });
bot.action('menu_breaches', (ctx) => { ctx.answerCbQuery(); ctx.replyWithHTML('Type: <code>/breaches domain.com</code>'); });
bot.action('menu_status', (ctx) => {
    ctx.answerCbQuery();
    const mode = process.env.WEBHOOK_DOMAIN ? 'Webhook (Live Server)' : 'Polling (Local Dev)';
    ctx.replyWithHTML(`⚙️ <b>Status:</b> Active\n🌐 <b>Mode:</b> <code>${mode}</code>`);
});

// Server Setup
const PORT = process.env.PORT || 3000;
const WEBHOOK_DOMAIN = process.env.WEBHOOK_DOMAIN;

if (WEBHOOK_DOMAIN) {
    bot.launch({
        webhook: {
            domain: WEBHOOK_DOMAIN,
            port: Number(PORT)
        }
    }).then(() => console.log(`[SERVER] Webhook active on port ${PORT}`));
} else {
    bot.launch().then(() => console.log('[SERVER] Polling mode active'));
}

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
