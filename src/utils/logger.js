import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { WebhookClient, EmbedBuilder } from 'discord.js';

dotenv.config();

const LOG_LEVELS = {
    ERROR: 'ERROR',
    WARN: 'WARN',
    INFO: 'INFO',
    DEBUG: 'DEBUG'
};

const webhookClient = new WebhookClient({ url: process.env.DISCORD_WEBHOOK_URL });


function logToFile(fileName, message) {
    const logDir = path.join(process.cwd(), 'logs');
    if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
    }
    fs.appendFileSync(path.join(logDir, fileName), message);
}

function log(level, message, sendToDiscord = false, sendToConsole = true, inputMint = '', outputMint = '') {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [${level}] ${message}`;

    if (sendToConsole) {
        console.log(logMessage);
    }

    if (sendToDiscord) {
        const embed = new EmbedBuilder()
            .setTimestamp();

        embed.setColor('#00FFFF'); // Cyan for other info

        // Replace wallet addresses with clickable links
        const replaceWalletAddresses = (text) => {
            return text.replace(/\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g, (address) => {
                return `[${address}](https://solscan.io/account/${address})`;
            });
        };

        const replaceTokens = (text, inputMint, outputMint) => {
            const tokenRegex = /\b(\d+(?:\.\d+)?\s+)([A-Za-z]+)\b/g;
            const SOL_MINT = 'So11111111111111111111111111111111111111112';

            // Determine which is the non-SOL mint
            const nonSolMint = inputMint === SOL_MINT ? outputMint : inputMint;

            return text.replace(tokenRegex, (match, amount, tokenName) => {
                let mint;
                if (tokenName === 'SOL') {
                    mint = SOL_MINT;
                } else {
                    mint = nonSolMint;
                }

                return `${amount}[${tokenName}](https://dexscreener.com/solana/${mint})`;
            });
        };
        let processedMessage = replaceWalletAddresses(message);
        processedMessage = replaceTokens(processedMessage, inputMint, outputMint);

        embed.setDescription(processedMessage);

        webhookClient.send({ embeds: [embed] });
    }
}

function logTransaction(tx) {
    const jsonData = JSON.stringify(tx, null, 2);
    logToFile('transactions.log', jsonData + '\n\n');
}

function logDetailedInfo(info) {
    const jsonData = JSON.stringify(info, null, 2);
    logToFile('detailed_info.log', jsonData + '\n\n');
}

export {
    LOG_LEVELS,
    log,
    logTransaction,
    logDetailedInfo
};