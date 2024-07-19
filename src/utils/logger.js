import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config();

const LOG_LEVELS = {
    ERROR: 'ERROR',
    WARN: 'WARN',
    INFO: 'INFO',
    DEBUG: 'DEBUG'
};

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

function formatLogMessage(level, message) {
    const timestamp = new Date().toISOString();
    return `[${timestamp}] [${level}] ${message}\n`;
}

function logToFile(fileName, message) {
    const logDir = path.join(process.cwd(), 'logs');
    if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
    }
    fs.appendFileSync(path.join(logDir, fileName), message);
}

async function sendToDiscord(message) {
    try {
      const response = await fetch(process.env.DISCORD_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: message }),
      });
  
      if (!response.ok) {
        console.error('Failed to send message to Discord');
      }
    } catch (error) {
      console.error('Error sending message to Discord:', error);
    }
  }

function formatDiscordMessage(message, mint) {
    const seller = process.env.SELLER || '';
    const distrib = process.env.DISTRIB || '';
  
    // Replace wallet addresses with names if available
    message = message.replace(seller, `[${process.env.SELLER_NAME || seller}](https://solscan.io/account/${seller})`);
    message = message.replace(distrib, `[${process.env.DISTRIB_NAME || distrib}](https://solscan.io/account/${distrib})`);
  
    // Add token mint information if available
    if (mint) {
      message += `\nToken Mint: \`${mint}\``;
      message += `\n[View on DEXScreener](https://dexscreener.com/solana/${mint})`;
    }
  
    return message;
  }

function log(level, message, consoleOutput = true, sendDiscord = false, mint = null) {
    const formattedMessage = formatLogMessage(level, message);
    logToFile('application.log', formattedMessage);

    if (consoleOutput) {
        switch (level) {
            case LOG_LEVELS.ERROR:
                console.error('\x1b[31m%s\x1b[0m', formattedMessage);
                break;
            case LOG_LEVELS.WARN:
                console.warn('\x1b[33m%s\x1b[0m', formattedMessage);
                break;
            case LOG_LEVELS.INFO:
                console.log('\x1b[36m%s\x1b[0m', formattedMessage);
                break;
            case LOG_LEVELS.DEBUG:
                console.log('\x1b[90m%s\x1b[0m', formattedMessage);
                break;
        }
    }

    if (sendDiscord) {
        sendToDiscord(formatDiscordMessage(message, mint));
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