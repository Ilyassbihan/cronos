# Telegraf.js Breach Intelligence Bot

A Telegram bot built with **Telegraf.js** for threat intelligence, breach analytics via **XposedOrNot**, k-Anonymity password auditing, and automated **Telegra.ph** Instant View report generation.

## Features
- **`/analytics <email>`**: Deep breach breakdown published straight to a Telegraph Instant View page.
- **`/checkemail <email>`**: Rapid check for leaked email addresses.
- **`/checkpass <password>`**: SHA3-512 k-Anonymity password exposure check with auto-message deletion.
- **`justhostmyapp.app` Ready**: Automatic detection between local Polling and production Webhooks.

## Environment Variables
- `BOT_TOKEN`: Your Telegram bot token from BotFather.
- `WEBHOOK_DOMAIN`: (Production only) `https://your-app.justhostmyapp.app`
