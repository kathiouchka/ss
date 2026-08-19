# Solana Jito/Jupiter Event-Driven Trading Bot

An experimental Node.js service that reacts to Solana transaction webhooks, tracks token-related events, requests swaps through Jupiter, submits bundles through Jito, and reports operational events to Discord.

This repository documents a personal engineering prototype. It interacts with real wallets and external blockchain infrastructure and is **not production-ready financial software**.

## What the project does

The service receives arrays of Solana transaction events through an Express webhook endpoint. Based on `SWAP` and `TRANSFER` activity involving configured wallets, it can:

- identify a token mint from incoming activity;
- retrieve token metadata and check whether its freeze authority is enabled;
- request buy or sell quotes from the Jupiter API;
- deserialize and sign a versioned Solana transaction;
- submit the transaction and a tip as a Jito bundle;
- monitor the token price and trigger a configurable sell path;
- track buy and sell amounts in memory and calculate PnL;
- transfer surplus SOL to a configured profit wallet;
- send operational messages to Discord and local log files.

## Architecture

```text
Solana webhook provider
        |
        v
Express webhook server
        |
        +--> token metadata checks
        +--> in-memory trading state and PnL
        +--> Jupiter quote and swap API
                    |
                    v
               Jito bundle

Logs ----------------------------> Discord / filesystem
```

| Component | Responsibility |
| --- | --- |
| `src/index.js` | Environment validation, startup and global error handling |
| `src/services/webhookServer.js` | Webhook ingestion, event interpretation and trading state |
| `src/services/jupiterApi.js` | RPC access, Jupiter swaps, Jito bundles and SOL transfers |
| `src/utils/tokenInfo.js` | Token metadata and freeze-authority lookup |
| `src/utils/logger.js` | Local and Discord logging |

## Technology

- Node.js with ECMAScript modules
- Express
- `@solana/web3.js` and `@solana/spl-token`
- Jupiter Quote and Swap APIs
- Jito block engine client
- Helius RPC and webhook events
- Discord webhooks

## Local setup

### Requirements

- Node.js 18 or later
- A Solana wallet dedicated to testing
- A Helius API key and webhook configuration
- Access to Jupiter and Jito endpoints
- Discord webhook URLs if Discord logging is enabled

Install the dependencies:

```bash
git clone https://github.com/ycallerisa/solana-jito-sniper-bot.git
cd solana-jito-sniper-bot
npm install
```

Create a local `.env` file:

```dotenv
PRIVATE_KEY=
API_KEY=
SELLER=
DISTRIB=
BOT_WALLET=
PROFIT_WALLET=
MASTER_WALLET=
DISCORD_WEBHOOK_URL=
DISCORD_WEBHOOK_URL_2=
DISCORD_WEBHOOK_URL_3=
```

Start the current entry point with:

```bash
node src/index.js
```

The webhook server listens on port `3000` and exposes `POST /webhook`.

## Security status and known limitations

The current implementation should be treated as a controlled prototype:

- the webhook endpoint does not yet verify request signatures or prevent replay attacks;
- webhook payloads are not validated against a strict schema;
- trading state is held in mutable process memory and is not safe for multiple instances;
- transactions returned by the swap provider are signed without a complete local allowlist of expected instructions and accounts;
- transaction submission currently uses `skipPreflight: true` in one transfer path;
- the repository does not yet contain automated tests;
- private keys must never be committed, printed or reused from a primary wallet.

For any deployment, place the endpoint behind an authenticated gateway, restrict network access, use a low-value isolated wallet, validate every transaction before signing, and implement idempotency and replay protection.

## Engineering focus

This project was built to explore event-driven backend design on Solana, third-party API orchestration, transaction construction, operational logging, retry behavior and stateful automation. The next development milestone is a security-focused hardening pass covering authenticated ingestion, transaction-policy validation and adversarial tests.

## Disclaimer

This project is provided for engineering and educational purposes. It is not financial advice and comes with no guarantee of profitability, availability or safety. Blockchain transactions are irreversible.

