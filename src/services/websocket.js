const WebSocket = require('ws');
const Queue = require('better-queue');
const { log, LOG_LEVELS, logTransaction, logDetailedInfo } = require('../utils/logger');
const { simplifyTransaction } = require('../utils/transaction');
const { extractDetailedInformation } = require('../utils/api');
const { buyTokenWithJupiter } = require('./jupiterApi');
const { RateLimit } = require('async-sema');
const { WebSocketScheme, WebSocketHost, APIKeyEnvVar, walletPool } = require('../config');
const processedSignatures = new Set();

const DISTRIB_ADDRESS = '';
const BIG_WALLET_ADDRESS = '';
const SELLER_ADDRESS = '';

let newTokenMintAddress = null;
let mintedWallets = new Set();

// Rate limiters
const rpcLimiter = RateLimit(10); // 10 RPC requests per second
const apiLimiter = RateLimit(2);  // 2 API requests per second

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

        // Check for incoming transfer to DISTRIB between 149.5 and 150.5 SOL
        if (simplifiedTx.to === DISTRIB_ADDRESS && 
            simplifiedTx.inputToken === 'SOL' && 
            simplifiedTx.inputAmount >= 149.5 && 
            simplifiedTx.inputAmount <= 150.5) {
            log(LOG_LEVELS.INFO, "Detected incoming transfer to DISTRIB. Starting to track BIG_WALLET.");
            if (!walletPool['BIG_WALLET']) {
                await addWallet(BIG_WALLET_ADDRESS, connections);
            }
        }

        // Check for BIG_WALLET transfer between 104.5 and 105.5 SOL
        if (simplifiedTx.from === BIG_WALLET_ADDRESS && 
            simplifiedTx.inputToken === 'SOL' && 
            simplifiedTx.inputAmount >= 104.5 && 
            simplifiedTx.inputAmount <= 105.5 &&
            !mintedWallets.has(simplifiedTx.to)) {
            log(LOG_LEVELS.INFO, "Detected BIG_WALLET transfer. Adding new MINTED_WALLET.");
            await addWallet(simplifiedTx.to, connections);
            mintedWallets.add(simplifiedTx.to);
        }

        // Check for token mint from MINTED_WALLET
        if (mintedWallets.has(simplifiedTx.from) && simplifiedTx.action === 'TOKEN_MINT') {
            log(LOG_LEVELS.INFO, "Detected new token mint from MINTED_WALLET.");
            newTokenMintAddress = simplifiedTx.to;
        }

        // Check for SELLER sending newTokenMintAddress to DISTRIB
        if (simplifiedTx.from === SELLER_ADDRESS && 
            simplifiedTx.to === DISTRIB_ADDRESS && 
            simplifiedTx.inputToken === newTokenMintAddress) {
            log(LOG_LEVELS.INFO, "SELLER sent new token to DISTRIB. Initiating buy.");
            await buyTokenWithJupiter(newTokenMintAddress);
        }

        // Check for SELLER receiving newTokenMintAddress from untracked wallet
        if (simplifiedTx.to === SELLER_ADDRESS && 
            simplifiedTx.inputToken === newTokenMintAddress && 
            !Object.values(walletPool).includes(simplifiedTx.from)) {
            log(LOG_LEVELS.INFO, "SELLER received new token from untracked wallet. Initiating sell.");
            // Implement sell logic here
        }

        // Check for MINTED_WALLET sending back > 100 SOL to BIG_WALLET
        if (mintedWallets.has(simplifiedTx.from) && 
            simplifiedTx.to === BIG_WALLET_ADDRESS && 
            simplifiedTx.inputToken === 'SOL' && 
            simplifiedTx.inputAmount > 100) {
            log(LOG_LEVELS.INFO, "MINTED_WALLET sent back > 100 SOL to BIG_WALLET. Removing from tracking.");
            mintedWallets.delete(simplifiedTx.from);
            // Implement logic to remove wallet from tracking
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

module.exports = {
    setupConnections
};