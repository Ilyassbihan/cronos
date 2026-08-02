import { Telegraf, Markup } from 'telegraf';

const XON_BASE_URL = 'https://api.xposedornot.com/v1';
const XON_PASS_URL = 'https://passwords.xposedornot.com/api/v1/pass/anon';
const TELEGRAPH_API = 'https://api.telegra.ph';

const sanitize = (str) => String(str || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// --- Telegraph Instant View Generator ---
async function createTelegraphReport(title, contentNodes) {
    try {
        const accRes = await fetch(`${TELEGRAPH_API}/createAccount?short_name=IntelBot&author_name=Threat+Intelligence+Engine`);
        const accData = await accRes.json();
        const accessToken = accData.result.access_token;

        const pageRes = await fetch(`${TELEGRAPH_API}/createPage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                access_token: accessToken,
                title: title,
                author_name: 'Threat Intelligence Engine',
                content: contentNodes,
                return_content: false
            })
        });
        const pageData = await pageRes.json();
        return pageData.result.url;
    } catch (err) {
        console.error('Telegraph API Error:', err);
        return null;
    }
}

// --- Threat Intelligence Services ---
const ThreatService = {
    async checkEmail(email) {
        const res = await fetch(`${XON_BASE_URL}/check-email/${encodeURIComponent(email)}`);
        if (res.status === 404) return { status: 'safe', email };
        if (!res.ok) throw new Error('API Error');
        return await res.json();
    },

    async getAnalytics(email) {
        const res = await fetch(`${XON_BASE_URL}/breach-analytics?email=${encodeURIComponent(email)}`);
        if (res.status === 404) return { status: 'safe', email };
        if (!res.ok) throw new Error('API Error');
        return await res.json();
    },

    async getBreaches(domain = null) {
        const url = domain ? `${XON_BASE_URL}/breaches?domain=${encodeURIComponent(domain)}` : `${XON_BASE_URL}/breaches`;
        const res = await fetch(url);
        return await res.json();
    },

    async checkPassword(password) {
        const msgUint8 = new TextEncoder().encode(password);
        const hashBuffer = await crypto.subtle.digest('SHA-512', msgUint8);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const fullHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
        const prefix = fullHash.substring(0, 10);

        const res = await fetch(`${XON_PASS_URL}/${prefix}`);
        if (res.status === 404) return { exposed: false, count: 0 };
        const data = await res.json();
        const matches = data?.SearchPassAnon || [];
        const match = matches.find(i => i.char.toUpperCase() === fullHash || i.char.toUpperCase() === fullHash.substring(10));
        return match ? { exposed: true, count: match.count || '1+' } : { exposed: false, count: 0 };
    }
};

// --- Bot Router Setup ---
function setupBot(token) {
    const bot = new Telegraf(token);

    const getMainMenu = () => Markup.inlineKeyboard([
        [Markup.button.callback('📊 Breach Analytics', 'm_analytics'), Markup.button.callback('🔍 Check Email', 'm_check')],
        [Markup.button.callback('🔒 Check Password', 'm_pass'), Markup.button.callback('📂 Browse Breaches', 'm_breaches')],
        [Markup.button.callback('⚙️ System Status', 'm_status')]
    ]);

    bot.start(async (ctx) => {
        const text = 
            `👋 <b>Universal Intelligence Bot</b>\n\n` +
            `Powered by <b>Telegraf.js</b> & <b>Cloudflare Workers</b>.\n\n` +
            `<b>Available Commands:</b>\n` +
            `• <code>/analytics &lt;email&gt;</code> - Generate a Telegraph Instant View report\n` +
            `• <code>/checkemail &lt;email&gt;</code> - Quick breach search\n` +
            `• <code>/checkpass &lt;password&gt;</code> - Privacy-preserving k-Anonymity check\n` +
            `• <code>/breaches [domain]</code> - Search breach directory\n` +
            `• <code>/status</code> - View bot state & runtime details`;

        await ctx.replyWithHTML(text, getMainMenu());
    });

    bot.command('analytics', async (ctx) => {
        const email = ctx.payload.trim();
        if (!email || !email.includes('@')) {
            return ctx.replyWithHTML('⚠️ Usage: <code>/analytics target@example.com</code>');
        }

        const statusMsg = await ctx.replyWithHTML(`⏳ Analyzing exposure history for <code>${sanitize(email)}</code>...`);

        try {
            const data = await ThreatService.getAnalytics(email);

            if (data.status === 'safe' || !data.BreachesSummary) {
                return ctx.telegram.editMessageText(
                    ctx.chat.id, statusMsg.message_id, undefined,
                    `🛡️ <b>No breach records found</b> for <code>${sanitize(email)}</code>.`,
                    { parse_mode: 'HTML' }
                );
            }

            const summary = data.BreachesSummary || {};
            const breaches = data.ExposedBreaches?.breaches_details || [];

            const telegraphNodes = [
                { tag: 'h4', children: [`Target: ${email}`] },
                { tag: 'p', children: [`Total Breaches: ${summary.total_breaches || breaches.length} | Risk Score: ${summary.risk_score || 'N/A'}`] },
                { tag: 'h4', children: ['Exposed Data Categories'] },
                { tag: 'p', children: [data.xposed_data || 'General exposure'] },
                { tag: 'h4', children: ['Breach Timeline'] }
            ];

            breaches.forEach(b => {
                telegraphNodes.push({
                    tag: 'p',
                    children: [`• `, { tag: 'strong', children: [b.breach || 'Unknown'] }, ` - Leaked Records: ${b.xposed_records?.toLocaleString() || 'N/A'}`]
                });
            });

            const telegraphUrl = await createTelegraphReport(`Breach Report: ${email}`, telegraphNodes);

            const replyHtml = 
                `📊 <b>Threat Analytics Complete</b>\n\n` +
                `🎯 <b>Target:</b> <code>${sanitize(email)}</code>\n` +
                `💥 <b>Breaches Found:</b> <code>${summary.total_breaches || breaches.length}</code>\n` +
                `⚠️ <b>Risk Score:</b> <code>${summary.risk_score || 'N/A'}</code>\n\n` +
                (telegraphUrl ? `🔗 <a href="${telegraphUrl}">Open Telegraph Instant View Report</a>` : '⚠️ Failed to generate Instant View link.');

            await ctx.telegram.editMessageText(
                ctx.chat.id, statusMsg.message_id, undefined, replyHtml,
                { parse_mode: 'HTML', disable_web_page_preview: false }
            );
        } catch (err) {
            await ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, undefined, '❌ Error generating analytics report.');
        }
    });

    bot.command('checkemail', async (ctx) => {
        const email = ctx.payload.trim();
        if (!email || !email.includes('@')) return ctx.replyWithHTML('⚠️ Usage: <code>/checkemail email@domain.com</code>');

        try {
            const data = await ThreatService.checkEmail(email);
            if (data.status === 'safe' || !data.breaches) {
                return ctx.replyWithHTML(`✅ <code>${sanitize(email)}</code> is clean across known leaks.`);
            }
            const list = Array.isArray(data.breaches[0]) ? data.breaches[0].join(', ') : data.breaches.join(', ');
            await ctx.replyWithHTML(`🚨 <b>Breach Alert!</b>\n\n<b>Exposed In:</b>\n<code>${sanitize(list)}</code>`);
        } catch (err) {
            await ctx.reply('❌ Query failed.');
        }
    });

    bot.command('checkpass', async (ctx) => {
        const password = ctx.payload.trim();
        if (!password) return ctx.replyWithHTML('⚠️ Usage: <code>/checkpass yourpassword</code>');

        try { await ctx.deleteMessage(); } catch (e) {}

        const statusMsg = await ctx.replyWithHTML('🔒 <i>Checking k-Anonymity hash...</i>');
        try {
            const res = await ThreatService.checkPassword(password);
            if (!res.exposed) {
                return ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, undefined, '🛡️ <b>Password is Safe!</b> No matches found.', { parse_mode: 'HTML' });
            }
            await ctx.telegram.editMessageText(
                ctx.chat.id, statusMsg.message_id, undefined,
                `🚨 <b>EXPOSED PASSWORD!</b>\nFound <code>${res.count}</code> times in public leaks. Change it immediately!`,
                { parse_mode: 'HTML' }
            );
        } catch (err) {
            await ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, undefined, '❌ Hash verification error.');
        }
    });

    bot.command('breaches', async (ctx) => {
        const domain = ctx.payload.trim();
        try {
            const data = await ThreatService.getBreaches(domain || null);
            const breaches = Array.isArray(data) ? data : data.exposed_breaches || [];
            if (!breaches.length) return ctx.replyWithHTML(`No recorded breaches for domain: <code>${sanitize(domain)}</code>`);

            const samples = breaches.slice(0, 8).map(b => `• <b>${sanitize(b.BreachID || b.name || b)}</b>`).join('\n');
            await ctx.replyWithHTML(`📂 <b>Breach Directory (${breaches.length} Entries)</b>\n\n${samples}`);
        } catch (err) {
            await ctx.reply('❌ Unable to pull breach repository.');
        }
    });

    bot.command('status', (ctx) => {
        ctx.replyWithHTML(
            `⚙️ <b>Bot Health Diagnostics</b>\n\n` +
            `• <b>Engine:</b> Telegraf.js\n` +
            `• <b>Environment:</b> Cloudflare Workers\n` +
            `• <b>Execution:</b> Edge Request Handler`
        );
    });

    bot.action('m_analytics', (ctx) => { ctx.answerCbQuery(); ctx.replyWithHTML('Type: <code>/analytics target@example.com</code>'); });
    bot.action('m_check', (ctx) => { ctx.answerCbQuery(); ctx.replyWithHTML('Type: <code>/checkemail email@example.com</code>'); });
    bot.action('m_pass', (ctx) => { ctx.answerCbQuery(); ctx.replyWithHTML('Type: <code>/checkpass password123</code>'); });
    bot.action('m_breaches', (ctx) => { ctx.answerCbQuery(); ctx.replyWithHTML('Type: <code>/breaches example.com</code>'); });
    bot.action('m_status', (ctx) => { ctx.answerCbQuery(); ctx.replyWithHTML('Run <code>/status</code> to output system parameters.'); });

    return bot;
}

// --- Cloudflare Worker Module Handler ---
export default {
    async fetch(request, env, ctx) {
        if (request.method !== 'POST') {
            return new Response('Telegram Bot Worker Active', { status: 200 });
        }

        try {
            const bot = setupBot(env.BOT_TOKEN);
            const update = await request.json();
            await bot.handleUpdate(update);
            return new Response('OK', { status: 200 });
        } catch (err) {
            console.error('Worker Processing Error:', err);
            return new Response('Error handling update', { status: 500 });
        }
    }
};
