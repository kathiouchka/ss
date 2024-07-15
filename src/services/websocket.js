import WebSocket from 'ws';
import Queue from 'better-queue';
import { log, LOG_LEVELS, logTransaction, logDetailedInfo } from '../utils/logger.js';
import { simplifyTransaction } from '../utils/transaction.js';
import { extractDetailedInformation } from '../utils/api.js';
import { buyTokenWithJupiter } from './jupiterApi.js';
import { RateLimit } from 'async-sema';
import { WebSocketScheme, WebSocketHost, APIKeyEnvVar, walletPool } from '../config.js';

const processedSignatures = new Set();


// Rate limiters
const rpcLimiter = RateLimit(10); // 10 RPC requests per second
const apiLimiter = RateLimit(2);  // 2 API requests per second

const SELLER = walletPool.SELLER;
const DISTRIB = walletPool.DISTRIB;
let NEW_TOKEN_ADDRESS = null;
let transferCount = 0;

// Transaction queue
const transactionQueue = new Queue(async (task, cb) => {
    try {
        await processTransaction(task.signature, task.walletPool, task.connections);
        cb(null, true);
    } catch (error) {
        log(LOG_LEVELS.ERROR, `Error processing transaction: ${error.message}`);
        cb(error);
    }
}, { concurrent: 5 }); // Process 5 transactions concurrently

function logRed(message) {
    log(LOG_LEVELS.INFO, message);
}

async function addWallet(address, connections) {
    const name = `Wallet_${Object.keys(walletPool).length + 1}`;
    walletPool[name] = address;
    await setupConnection(name, address, connections);
    logRed(`Added new wallet: ${name} - ${address}`);
}

async function connectAndSubscribe(walletAddress) {
    return new Promise((resolve, reject) => {
        const apiKey = process.env[APIKeyEnvVar];
        if (!apiKey) {
            reject(new Error('API key not provided'));
            return;
        }

        const url = `${WebSocketScheme}://${WebSocketHost}?api-key=${apiKey}`;
        log(LOG_LEVELS.INFO, `Connecting to ${url} for wallet ${walletAddress}`);

        const ws = new WebSocket(url);

        ws.on('open', () => {
            const subscribe = {
                jsonrpc: '2.0',
                id: 1,
                method: 'logsSubscribe',
                params: [
                    { mentions: [walletAddress] },
                    { commitment: 'finalized' }
                ]
            };

            ws.send(JSON.stringify(subscribe));
            resolve(ws);
        });

        ws.on('error', (error) => {
            reject(error);
        });
    });
}

async function setupConnection(name, address, connections, retryCount = 0) {
    try {
        const ws = await connectAndSubscribe(address);
        const pingTimer = setInterval(() => {
            ws.ping();
        }, 25000); // 25 seconds

        console.log("Distrib adress = " + DISTRIB)
        console.log("SELLER adress = " + SELLER)
        
        const recentMessages = new Set();
        ws.on('message', async (message) => {
            await rpcLimiter(); // Rate limit RPC requests
            log(LOG_LEVELS.DEBUG, 'Received message: ' + message.toString('utf8'));

            const messageData = JSON.parse(message);
            const params = messageData.params;
            if (!params || !params.result || !params.result.value) return;

            const value = params.result.value;
            const signature = value.signature;

            const messageId = `${signature}-${JSON.stringify(value)}`;

            if (recentMessages.has(messageId)) {
                log(LOG_LEVELS.DEBUG, 'Duplicate message received, skipping processing');
                return;
            }
            recentMessages.add(messageId);

            setTimeout(() => {
                recentMessages.delete(messageId);
            }, 5000); // Adjust this timeout as needed

            if (signature && !processedSignatures.has(signature)) {
                processedSignatures.add(signature);
                transactionQueue.push({ signature, walletPool, connections });

                setTimeout(() => {
                    processedSignatures.delete(signature);
                }, 60000); // Remove after 1 minute
            }
        });

        ws.on('close', () => {
            clearInterval(pingTimer);
            log(LOG_LEVELS.ERROR, `Connection closed for ${name}, reconnecting...`);
            delete connections[name];
            const backoffTime = Math.min(1000 * Math.pow(2, retryCount), 60000); // Max 1 minute
            setTimeout(() => setupConnection(name, address, connections, retryCount + 1), backoffTime);
        });

        connections[name] = { ws, pingTimer };
        retryCount = 0; // Reset retry count on successful connection
    } catch (error) {
        log(LOG_LEVELS.ERROR, `Failed to connect for ${name}:`, error);
        const backoffTime = Math.min(1000 * Math.pow(2, retryCount), 60000); // Max 1 minute
        setTimeout(() => setupConnection(name, address, connections, retryCount + 1), backoffTime);
    }
}

async function processTransaction(signature, walletPool, connections) {
    await apiLimiter();
    const detailedInfo = await extractDetailedInformation(signature);
    if (detailedInfo) {
        logDetailedInfo(detailedInfo);
        logTransaction(detailedInfo);
        const simplifiedTx = await simplifyTransaction(detailedInfo, walletPool);
        log(LOG_LEVELS.INFO, `${simplifiedTx.walletName} - ${simplifiedTx.signature} - ${simplifiedTx.time} - ${simplifiedTx.action} - ${simplifiedTx.from} - ${simplifiedTx.to} - Input: ${simplifiedTx.inputAmount} ${simplifiedTx.inputToken} - Output: ${simplifiedTx.outputAmount} ${simplifiedTx.outputToken}`);

        // Permanent tracking of SELLER + DISTRIB
        if (!walletPool['SELLER']) {
            await addWallet(SELLER, connections);
        }
        if (!walletPool['DISTRIB']) {
            await addWallet(DISTRIB, connections);
        }

        // Detect SWAP between 149.5 and 150.5 SOL
        if (simplifiedTx.action === 'SWAP' &&
            simplifiedTx.from === SELLER &&
            simplifiedTx.inputToken === 'SOL' &&
            simplifiedTx.inputAmount >= 149.5 &&
            simplifiedTx.inputAmount <= 150.5) {
            
            NEW_TOKEN_ADDRESS = simplifiedTx.outputToken;
            log(LOG_LEVELS.INFO, `New token detected: ${NEW_TOKEN_ADDRESS}`);
        }

        // Detect transfer of NEW_TOKEN_ADDRESS from SELLER to DISTRIB
        if (NEW_TOKEN_ADDRESS &&
            simplifiedTx.action === 'TRANSFER' &&
            simplifiedTx.from === SELLER &&
            simplifiedTx.to === DISTRIB &&
            simplifiedTx.inputToken === NEW_TOKEN_ADDRESS) {
            
            log(LOG_LEVELS.INFO, 'SELLER transferred the new token to DISTRIB. Initiating buy.');
            const bought = await buyTokenWithJupiter(NEW_TOKEN_ADDRESS, 10000000, "buy");
            log(LOG_LEVELS.INFO, bought);
        }

        // Detect transfer of NEW_TOKEN_ADDRESS to SELLER
        if (NEW_TOKEN_ADDRESS &&
            simplifiedTx.action === 'TRANSFER' &&
            simplifiedTx.to === SELLER &&
            simplifiedTx.inputToken === NEW_TOKEN_ADDRESS) {
            
            transferCount++;
            log(LOG_LEVELS.INFO, `SELLER received the new token. Transfer count: ${transferCount}`);
            if (transferCount >= 2) {
                log(LOG_LEVELS.INFO, 'Two transfers confirmed. Initiating sell.');
                // Implement sell logic here
                transferCount = 0; // Reset transfer count after initiating sell
            }
        }
    }
}

async function setupConnections(walletPool) {
    let connections = {};

    process.on('SIGINT', () => {
        console.log('Interrupt received, shutting down...');
        Object.values(connections).forEach(conn => conn.ws.close());
        process.exit(0);
    });

    for (const [name, address] of Object.entries(walletPool)) {
        await setupConnection(name, address, connections);
    }

    // Keep the main process running
    await new Promise(() => { });
}

export  {
    setupConnections
};