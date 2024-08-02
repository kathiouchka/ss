import { startWebhookServer } from './services/webhookServer.js';
import { log, LOG_LEVELS } from './utils/logger.js';
import { tradeTokenWithJupiter } from './services/jupiterApi.js'

import dotenv from 'dotenv';

dotenv.config();

const requiredEnvVars = [
  'PRIVATE_KEY',
  'API_KEY',
  'SELLER',
  'DISTRIB',
  'DISCORD_WEBHOOK_URL',
  'DISCORD_WEBHOOK_URL_2',
  'DISCORD_WEBHOOK_URL_3',
  'BOT_WALLET',
  'PROFIT_WALLET',
  'MASTER_WALLET',
];

function checkEnvVariables() {
  const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
  if (missingVars.length > 0) {
    log(LOG_LEVELS.ERROR, `Missing required environment variables: ${missingVars.join(', ')}`, {
      isBot: true
    });
    process.exit(1);
  }
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}


async function main() {
  try {
    checkEnvVariables();
    await startWebhookServer();
    log(LOG_LEVELS.INFO, "THIS IS A TEST BUY", {
      isBot: true,
    });
    await tradeTokenWithJupiter("", 20, true, 5);
    log(LOG_LEVELS.INFO, "WE WAIT 30 SECONDS", {
      isBot: true,
    });

    await delay(30000);
    await tradeTokenWithJupiter("", 100, false, 5);
    log(LOG_LEVELS.INFO, "WE SOLD FAKE TEST", {
      isBot: true,
    });
    log(LOG_LEVELS.INFO, 'BOT RESTARTED', {
      isBot: true,
    });
  } catch (error) {
    log(LOG_LEVELS.ERROR, `Error starting webhook server: ${error.message}`, {
      isBot: true
    });
  }
}

function handleGlobalErrors(error) {
  log(LOG_LEVELS.ERROR, `Unhandled error: ${error.message}`, {
    isBot: true,
  });
  log(LOG_LEVELS.ERROR, `Stack trace: ${error.stack}`, {
    isBot: true,
  });

  // Optionally, you can add more specific error handling here
  if (error.message.includes("503 Service Unavailable")) {
    log(LOG_LEVELS.WARN, "RPC service is currently unavailable. The program will continue running, but some operations may fail.", {
      isBot: true,
    });
  }

  // Instead of crashing, we'll keep the program running
  setTimeout(() => {
    log(LOG_LEVELS.INFO, "Attempting to recover from error...", {
      isBot: true,
    });
    main().catch(handleGlobalErrors);
  }, 10000); // Wait 10 seconds before attempting to recover
}

main().catch(handleGlobalErrors);

// Add these global error handlers
process.on('uncaughtException', handleGlobalErrors);
process.on('unhandledRejection', handleGlobalErrors);