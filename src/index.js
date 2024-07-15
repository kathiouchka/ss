import dotenv from 'dotenv';
import { setupConnections } from './services/websocket.js';
import { walletPool } from './config.js';

dotenv.config();

async function main() {
    await setupConnections(walletPool);
}

main().catch(console.error);
