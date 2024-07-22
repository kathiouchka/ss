import { startWebhookServer } from './services/webhookServer.js';
import { log, LOG_LEVELS } from './utils/logger.js';
import dotenv from 'dotenv';

dotenv.config();

const requiredEnvVars = [
  'PRIVATE_KEY',
  'API_KEY',
  'SELLER',
  'DISTRIB',
  'DISCORD_WEBHOOK_URL',
  'DISCORD_WEBHOOK_URL_2'
];

function checkEnvVariables() {
  const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
  if (missingVars.length > 0) {
    log(LOG_LEVELS.ERROR, `Missing required environment variables: ${missingVars.join(', ')}`);
    process.exit(1);
  }
}

async function main() {
  try {
    checkEnvVariables();
    await startWebhookServer();
    log(LOG_LEVELS.INFO, 'Webhook server started successfully');
  } catch (error) {
    log(LOG_LEVELS.ERROR, `Error starting webhook server: ${error.message}`);
  }
}

function handleGlobalErrors(error) {
  log(LOG_LEVELS.ERROR, `Unhandled error: ${error.message}`);
  log(LOG_LEVELS.ERROR, `Stack trace: ${error.stack}`);
  
  // Optionally, you can add more specific error handling here
  if (error.message.includes("503 Service Unavailable")) {
    log(LOG_LEVELS.WARN, "RPC service is currently unavailable. The program will continue running, but some operations may fail.");
  }
  
  // Instead of crashing, we'll keep the program running
  setTimeout(() => {
    log(LOG_LEVELS.INFO, "Attempting to recover from error...");
    main().catch(handleGlobalErrors);
  }, 10000); // Wait 10 seconds before attempting to recover
}

log(LOG_LEVELS.INFO, 'About to call main function');
main().catch(handleGlobalErrors);

// Add these global error handlers
process.on('uncaughtException', handleGlobalErrors);
process.on('unhandledRejection', handleGlobalErrors);