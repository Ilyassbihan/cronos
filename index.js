require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');
const crypto = require('crypto');

if (!process.env.BOT_TOKEN) {
    console.error('FATAL: BOT_TOKEN is missing from environment variables.');
    process.exit(1);
}

const bot = new Telegraf(process.env.BOT_TOKEN);
const XON_BASE_URL = 'https://api.xposedornot.com/v1';
const XON_PASS_URL = 'https://passwords.xposedornot.com/api/v1/pass/anon';
const TELEGRAPH_API = 'https://api.telegra.ph';

// Helper: Sanitize HTML tags
const sanitize = (str) => String(str || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// --- Telegraph Page Generator (Instant View Reports) ---
async function createTelegraphReport(title, contentNodes) {
    try {
        // Create temporary Telegraph account
        const accRes = await axios.get(`${TELEGRAPH_API}/createAccount`, {
            params: { short_name: 'IntelBot', author_name: 'XposedOrNot Bot' }
        });
        const accessToken = accRes.data.result.access_token;

        // Publish Instant View Page
        const pageRes = await axios.post(`${TELEGRAPH_API}/createPage`, {
            access_token: accessToken,
            title: title,
            author_name: 'Threat Intelligence Engine',
            content: JSON.stringify(contentNodes),
            return_content: false
        });

        return pageRes.data.result.url;
    } catch (err) {
        console.error('Telegraph Generation Error:', err.message);
        return null;
    }
}

// --- XposedOrNot API Services ---
const XONService = {
    async checkEmail(email) {
        try {
            const res = await axios.get(`${XON_BASE_URL}/check-email/${encodeURIComponent(email)}`);
            return res.data;
        } catch (err) {
            if (err.response?.status === 404) return { status: 'safe', email };
            throw err;
        }
    },

    async getAnalytics(email) {
        try {
            const res = await axios.get(`${XON_BASE_URL}/breach-analytics`, { params: { email } });
            return res.data;
        } catch (err) {
            if (err.response?.status === 404) return { status: 'safe', email };
            throw err;
        }
    },

    async checkPassword(password) {
        const fullHash = crypto.createHash('sha3-512').update(password).digest('hex').toUpperCase();
        const prefix = fullHash.substring(0, 10);

        try {
            const res = await axios.get(`${XON_PASS_URL}/${prefix}`);
            const matches = res.data?.SearchPassAnon || [];
            const match = matches.find(i => i.char.toUpperCase() === fullHash || i.char.toUpperCase() === fullHash.substring(10));
            return match ? { exposed: true, count: match.count || '1+' } : { exposed: false, count: 0 };
        } catch (err) {
            if (err.response?.status === 404) return { exposed: false, count: 0 };
            throw err;
        }
    }
};

// --- Bot Commands ---

bot.start(async (ctx) => {
    const text = 
        `👋 <b>Welcome to the Intelligence Bot!</b>\n\n` +
        `Built with <b>Telegraf.js</b> and powered by <b>XposedOrNot</b> API.\n\n` +
        `<b>Available Commands:</b>\n` +
        `• <code>/analytics &lt;email&gt;</code> - Generate Telegraph Instant View report\n` +
        `• <code>/checkemail &lt;email&gt;</code> - Fast breach detection\n` +
        `• <code>/checkpass &lt;password&gt;</code> - k-Anonymity password lookup\n` +
        `• <code>/status</code> - View hosting connection state`;

    await ctx.replyWithHTML(text, Markup.inlineKeyboard([
        [Markup.button.callback('📊 Analytics', 'm_analytics'), Markup.button.callback('🔍 Check Email', 'm_check')],
        [Markup.button.callback('🔒 Check Password', 'm_pass'), Markup.button.callback('⚙️ Status', 'm_status')]
    ]));
});

// Command: /analytics <email> (Generates Telegraph Instant View Page)
bot.command('analytics', async (ctx) => {
    const email = ctx.payload.trim();
    if (!email || !email.includes('@')) {
        return ctx.replyWithHTML('⚠️ Usage: <code>/analytics target@example.com</code>');
    }

    const statusMsg = await ctx.replyWithHTML(`⏳ Querying threat data for <code>${sanitize(email)}</code>...`);

    try {
        const data = await XONService.getAnalytics(email);

        if (data.status === 'safe' || !data.BreachesSummary) {
            return ctx.telegram.editMessageText(
                ctx.chat.id, statusMsg.message_id, undefined,
                `🛡️ <b>No breach records found</b> for <code>${sanitize(email)}</code>.`,
                { parse_mode: 'HTML' }
            );
        }

        const summary = data.BreachesSummary || {};
        const breaches = data.ExposedBreaches?.breaches_details || [];

        // Build Telegraph Document Structure
        const telegraphNodes = [
            { tag: 'h4', children: [`Target: ${email}`] },
            { tag: 'p', children: [`Total Breaches: ${summary.total_breaches || breaches.length} | Risk Score: ${summary.risk_score || 'N/A'}`] },
            { tag: 'h4', children: ['Exposed Data Categories'] },
            { tag: 'p', children: [data.xposed_data || 'General exposure'] },
            { tag: 'h4', children: ['Breach History Details'] }
        ];

        breaches.forEach(b => {
            telegraphNodes.push({
                tag: 'p',
                children: [`• `, { tag: 'strong', children: [b.breach || 'Unknown'] }, ` - Records: ${b.xposed_records?.toLocaleString() || 'N/A'}`]
            });
        });

        // Publish to Telegraph
        const telegraphUrl = await createTelegraphReport(`Breach Report: ${email}`, telegraphNodes);

        const replyHtml = 
            `📊 <b>Breach Analytics Complete</b>\n\n` +
            `🎯 <b>Target:</b> <code>${sanitize(email)}</code>\n` +
            `💥 <b>Total Breaches:</b> <code>${summary.total_breaches || breaches.length}</code>\n` +
            `⚠️ <b>Risk Score:</b> <code>${summary.risk_score || 'N/A'}</code>\n\n` +
            (telegraphUrl ? `🔗 <a href="${telegraphUrl}">View Full Telegraph Instant View Report</a>` : '⚠️ Could not generate Telegraph page.');

        await ctx.telegram.editMessageText(
            ctx.chat.id, statusMsg.message_id, undefined, replyHtml,
            { parse_mode: 'HTML', disable_web_page_preview: false }
        );

    } catch (err) {
        await ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, undefined, '❌ Error generating analytics report.');
    }
});

// Command: /checkemail <email>
bot.command('checkemail', async (ctx) => {
    const email = ctx.payload.trim();
    if (!email || !email.includes('@')) return ctx.replyWithHTML('⚠️ Usage: <code>/checkemail target@example.com</code>');

    try {
        const data = await XONService.checkEmail(email);
        if (data.status === 'safe' || !data.breaches) {
            return ctx.replyWithHTML(`✅ <code>${sanitize(email)}</code> was <b>not found</b> in public leaks.`);
        }
        const list = Array.isArray(data.breaches[0]) ? data.breaches[0].join(', ') : data.breaches.join(', ');
        await ctx.replyWithHTML(`🚨 <b>Exposed in:</b>\n<code>${sanitize(list)}</code>`);
    } catch (err) {
        await ctx.reply('❌ Failed to check email status.');
    }
});

// Command: /checkpass <password>
bot.command('checkpass', async (ctx) => {
    const password = ctx.payload.trim();
    if (!password) return ctx.replyWithHTML('⚠️ Usage: <code>/checkpass yourpassword</code>');

    try { await ctx.deleteMessage(); } catch (e) {}

    const statusMsg = await ctx.replyWithHTML('🔒 <i>Checking k-Anonymity hash...</i>');
    try {
        const res = await XONService.checkPassword(password);
        if (!res.exposed) {
            return ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, undefined, '🛡️ <b>Password is Safe!</b> No matches found.', { parse_mode: 'HTML' });
        }
        await ctx.telegram.editMessageText(
            ctx.chat.id, statusMsg.message_id, undefined,
            `🚨 <b>EXPOSED PASSWORD!</b>\nFound <code>${res.count}</code> times in leaks. Change it immediately!`,
            { parse_mode: 'HTML' }
        );
    } catch (err) {
        await ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, undefined, '❌ Error checking password.');
    }
});

// Command: /status
bot.command('status', (ctx) => {
    const mode = process.env.WEBHOOK_DOMAIN ? 'Webhook (justhostmyapp.app)' : 'Polling (Local Dev)';
    ctx.replyWithHTML(`⚙️ <b>Status:</b> Online\n🌐 <b>Mode:</b> <code>${mode}</code>\n⚡ <b>Engine:</b> Telegraf.js + Telegraph API`);
});

// Button Handlers
bot.action('m_analytics', (ctx) => { ctx.answerCbQuery(); ctx.replyWithHTML('Type: <code>/analytics email@example.com</code>'); });
bot.action('m_check', (ctx) => { ctx.answerCbQuery(); ctx.replyWithHTML('Type: <code>/checkemail email@example.com</code>'); });
bot.action('m_pass', (ctx) => { ctx.answerCbQuery(); ctx.replyWithHTML('Type: <code>/checkpass password123</code>'); });
bot.action('m_status', (ctx) => { ctx.answerCbQuery(); ctx.replyWithHTML(`Engine: Telegraf.js | Port: <code>${process.env.PORT || 3000}</code>`); });

// --- Server Environment Integration ---
const PORT = process.env.PORT || 3000;
const WEBHOOK_DOMAIN = process.env.WEBHOOK_DOMAIN;

if (WEBHOOK_DOMAIN) {
    bot.launch({ webhook: { domain: WEBHOOK_DOMAIN, port: Number(PORT) } })
       .then(() => console.log(`[SERVER] Webhook running on port ${PORT}`));
} else {
    bot.launch().then(() => console.log('[SERVER] Polling active (Local Dev)'));
}

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
