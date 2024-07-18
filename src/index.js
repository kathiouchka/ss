import { startWebhookServer } from './services/webhookServer.js';
import { log, LOG_LEVELS } from './utils/logger.js';
import dotenv from 'dotenv';

dotenv.config();

const requiredEnvVars = [
  'PRIVATE_KEY',
  'API_KEY',
  'SELLER',
  'DISTRIB',
  'DISCORD_WEBHOOK_URL'
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

log(LOG_LEVELS.INFO, 'About to call main function');
main().catch(error => {
  log(LOG_LEVELS.ERROR, `Unhandled error in main: ${error.message}`);
});