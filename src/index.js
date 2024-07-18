const { startWebhookServer } = require('./services/webhookServer');

async function main() {
  try {
    await startWebhookServer();
    console.log('Webhook server started successfully');
  } catch (error) {
    console.error('Error starting webhook server:', error);
  }
}

main();