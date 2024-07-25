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
const botWebhookClient = new WebhookClient({ url: process.env.DISCORD_WEBHOOK_URL_2 });
const thirdWebhookClient = new WebhookClient({ url: process.env.DISCORD_WEBHOOK_URL_3 });


function logToFile(fileName, message) {
    const logDir = path.join(process.cwd(), 'logs');
    if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
    }
    fs.appendFileSync(path.join(logDir, fileName), message);
}

function log(level, message, options = {}) {
    const transferRegex = /^(\w+) transferred a total ([\d.]+) SOL to multiple accounts\.$/;
    const match = message.match(transferRegex);

    if (match) {
        const [, , amount] = match;
        const solAmount = parseFloat(amount);
        if (solAmount < 0.001) {
            options.sendToDiscord = false;
        }
    }
    const {
        sendToDiscord = true,
        sendToConsole = true,
        inputMint = '',
        outputMint = '',
        isBot = false,
        isThird = false,
        signature = ''
    } = options;


    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [${level}] ${message}`;

    if (sendToConsole) {
        console.log(logMessage);
    }

    if (sendToDiscord) {
        const embed = new EmbedBuilder()
            .setTimestamp();

        const SOL_MINT = 'So11111111111111111111111111111111111111112';
        let embedColor; // Default Cyan for other info

        if (options.color) {
            // Use the color provided in the options
            switch (options.color.toUpperCase()) {
                case 'GREEN':
                    embedColor = '#00FF00';
                    break;
                case 'RED':
                    embedColor = '#FF0000';
                    break;
                case 'PURPLE':
                    embedColor = '#800080';
                    break;
                case 'CYAN':
                    embedColor = '#00FFFF';
                    break;
                default:
                    embedColor = '#FFFFFF'; // Default to white if an unknown color is provided
            }
        } else {
            embedColor = '#A9A9A9'; // Cyan for other info
        }

        embed.setColor(embedColor);

        // Replace wallet addresses with clickable links
        const replaceWalletAddresses = (text) => {
            // Load environment variables into a dictionary
            const env = process.env;
            const addressMap = {};

            // Iterate through environment variables and map addresses to variable names
            for (const [key, value] of Object.entries(env)) {
                addressMap[value] = key;
            }

            return text.replace(/\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g, (address) => {
                if (addressMap[address]) {
                    return `[${addressMap[address]}](https://solscan.io/account/${address})`;
                } else {
                    return `[${address}](https://solscan.io/account/${address})`;
                }
            });
        };

        const replaceTokens = (text, inputMint, outputMint) => {
            const tokenRegex = /\b(\d+(?:\.\d+)?\s+)([A-Za-z]+)\b/g;

            // Determine which is the non-SOL mint
            const nonSolMint = inputMint === SOL_MINT ? outputMint : inputMint;

            return text.replace(tokenRegex, (match, amount, tokenName) => {
                let mint;
                if (tokenName === 'SOL') {
                    mint = SOL_MINT;
                } else {
                    mint = nonSolMint;
                }

                return `${amount}[${tokenName}](https://birdeye.so/token/${mint})`;
            });
        };
        let processedMessage = replaceWalletAddresses(message);
        processedMessage = replaceTokens(processedMessage, inputMint, outputMint);

        embed.setDescription(processedMessage);

        if (signature) {
            embed.addFields({ name: '\u200B', value: `[View on Solscan](https://solscan.io/tx/${signature})` });
        }

        if (isBot) {
            botWebhookClient.send({ embeds: [embed] });
        } else if (isThird) {
            const tokenAddress = message;
            const birdeyeLink = `https://birdeye.so/token/${tokenAddress}`;
            const dexscreenerLink = `https://dexscreener.com/solana/${tokenAddress}`;
            embed.setDescription(`New token detected: [${tokenAddress}](${birdeyeLink}) | [Dexscreener](${dexscreenerLink})`);
            thirdWebhookClient.send({ embeds: [embed] })
        } else {
            webhookClient.send({ embeds: [embed] });
        }
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