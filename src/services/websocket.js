const WebSocket = require('ws');
const { log, LOG_LEVELS, logTransaction, logDetailedInfo } = require('../utils/logger');
const { simplifyTransaction } = require('../utils/transaction');
const { extractDetailedInformation } = require('../utils/api');
const { buyTokenWithJupiter } = require('./jupiterApi');
const { WebSocketScheme, WebSocketHost, APIKeyEnvVar, walletPool } = require('../config'); // Import walletPool
const processedSignatures = new Set();


function logRed(message) {
    log(LOG_LEVELS.INFO, message);
}

// Add this function to add a new wallet to the pool and set up a connection
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

async function setupConnection(name, address, connections) {
    try {
        const ws = await connectAndSubscribe(address);
        const pingTimer = setInterval(() => {
            ws.ping();
        }, 25000); // 25 seconds
        ws.on('message', async (message) => {
            log(LOG_LEVELS.DEBUG, 'Received message: ' + message.toString('utf8'));

            const messageData = JSON.parse(message);
            const params = messageData.params;
            if (!params || !params.result || !params.result.value) return;

            const value = params.result.value;
            const signature = value.signature;
            const newTokenMintAddress = null;
            const sellerSwapFlag = 0;

            if (signature && !processedSignatures.has(signature)) {
                processedSignatures.add(signature);
                const detailedInfo = await extractDetailedInformation(signature);
                logDetailedInfo(detailedInfo);
                if (detailedInfo) {
                    logTransaction(detailedInfo);
                    const simplifiedTx = await simplifyTransaction(detailedInfo, walletPool);
                    log(LOG_LEVELS.INFO, `${simplifiedTx.walletName} - ${simplifiedTx.signature} - ${simplifiedTx.time} - ${simplifiedTx.action} - ${simplifiedTx.from} - ${simplifiedTx.to} - Input: ${simplifiedTx.inputAmount} ${simplifiedTx.inputToken} - Output: ${simplifiedTx.outputAmount} ${simplifiedTx.outputToken}`);

                    // DETECTION HERE
                    if (simplifiedTx.action === 'TRANSFER' &&
                        !Object.values(walletPool).includes(simplifiedTx.to) &&
                        simplifiedTx.inputToken === 'SOL' &&
                        simplifiedTx.inputAmount === 105) {
                        await addWallet(simplifiedTx.to, connections);
                    }

                    if (simplifiedTx.action === 'TOKEN_MINT') {

                        log(LOG_LEVELS.INFO, "TOKEN MINTED");
                        log(LOG_LEVELS.INFO, "MINT ADDRESS:", simplifiedTx.to);
                        newTokenMintAddress = simplifiedTx.to;
                    }

                    if (simplifiedTx.action === 'SWAP' && simplifiedTx.walletName === 'SELLER' && simplifiedTx.inputToken === newTokenMintAddress) {
                        log(LOG_LEVELS.INFO, "SELLER swapped the new token");
                        sellerSwapFlag = true;
                    }

                    if (simplifiedTx.action === 'TRANSFER' &&
                        simplifiedTx.walletName === 'SELLER' &&
                        simplifiedTx.to === walletPool['DISTRIB'] &&
                        simplifiedTx.inputToken === newTokenMintAddress &&
                        sellerSwapFlag) {

                        log(LOG_LEVELS.INFO, "SELLER transferred all new tokens to DISTRIB");
                        // Call function to buy token
                        await buyTokenWithJupiter(newTokenMintAddress);
                    }
                }

                setTimeout(() => {
                    processedSignatures.delete(signature);
                }, 60000); // Remove after 1 minute
            }
        });

        ws.on('close', () => {
            clearInterval(pingTimer);
            log(LOG_LEVELS.ERROR, `Connection closed for ${name}, reconnecting...`);
            delete connections[name];
            setupConnection(name, address, connections);
        });


        connections[name] = { ws, pingTimer };
    } catch (error) {

        log(LOG_LEVELS.ERROR, `Failed to connect for ${name}:`, error);
        setTimeout(() => setupConnection(name, address, connections), 3000);
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