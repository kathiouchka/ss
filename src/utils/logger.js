const fs = require('fs');
const path = require('path');

const LOG_LEVELS = {
    ERROR: 'ERROR',
    WARN: 'WARN',
    INFO: 'INFO',
    DEBUG: 'DEBUG'
};

function formatLogMessage(level, message) {
    const timestamp = new Date().toISOString();
    return `[${timestamp}] [${level}] ${message}\n`;
}

function logToFile(fileName, message) {
    const logDir = path.join(__dirname, '..', '..', 'logs');
    if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir);
    }
    fs.appendFileSync(path.join(logDir, fileName), message);
}

function log(level, message, consoleOutput = true) {
    const formattedMessage = formatLogMessage(level, message);
    logToFile('application.log', formattedMessage);
    
    if (consoleOutput) {
        switch(level) {
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
}

function logTransaction(tx) {
    const jsonData = JSON.stringify(tx, null, 2);
    logToFile('transactions.log', jsonData + '\n\n');
}

function logDetailedInfo(info) {
    const jsonData = JSON.stringify(info, null, 2);
    logToFile('detailed_info.log', jsonData + '\n\n');
}

module.exports = {
    LOG_LEVELS,
    log,
    logTransaction,
    logDetailedInfo
};