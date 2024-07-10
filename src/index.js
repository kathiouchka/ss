require('dotenv').config();
const { setupConnections } = require('./services/websocket');
const { walletPool } = require('./config');

async function main() {
    await setupConnections(walletPool);
}

main().catch(console.error);