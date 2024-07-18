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

function sendToDiscord(level, message) {
    if (!DISCORD_WEBHOOK_URL) {
        console.warn('Discord webhook URL not set. Skipping Discord logging.');
        return;
    }

    const formattedMessage = formatLogMessage(level, message);
    const color = getColorForLevel(level);

    fetch(DISCORD_WEBHOOK_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            embeds: [{
                description: `\`\`\`ansi\n${formattedMessage}\`\`\``,
                color: color
            }]
        }),
    }).catch(error => {
        console.error(`Error sending log to Discord: ${error.message}`);
    });
}

function getColorForLevel(level) {
    switch (level) {
        case LOG_LEVELS.ERROR:
            return 0xFF0000; // Red
        case LOG_LEVELS.WARN:
            return 0xFFFF00; // Yellow
        case LOG_LEVELS.INFO:
            return 0x00FFFF; // Cyan
        case LOG_LEVELS.DEBUG:
            return 0x808080; // Gray
        default:
            return 0xFFFFFF; // White
    }
}

function log(level, message, consoleOutput = true, sendDiscord = false) {
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
        sendToDiscord(level, message)
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