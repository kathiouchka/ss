const WebSocket = require('ws');
const { logTransaction } = require('../utils/logger');
const { simplifyTransaction } = require('../utils/transaction');
const { extractDetailedInformation } = require('../utils/api');
const { WebSocketScheme, WebSocketHost, APIKeyEnvVar, walletPool } = require('../config'); // Import walletPool
const processedSignatures = new Set();

async function connectAndSubscribe(walletAddress) {
    return new Promise((resolve, reject) => {
        const apiKey = process.env[APIKeyEnvVar];
        if (!apiKey) {
            reject(new Error('API key not provided'));
            return;
        }

        const url = `${WebSocketScheme}://${WebSocketHost}?api-key=${apiKey}`;
        console.log(`Connecting to ${url} for wallet ${walletAddress}`);

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
            console.log('Received message:', message.toString('utf8'));
            const messageData = JSON.parse(message);
            const params = messageData.params;
            if (!params || !params.result || !params.result.value) return;
        
            const value = params.result.value;
            const signature = value.signature;
        
            if (signature && !processedSignatures.has(signature)) {
                processedSignatures.add(signature);
                const detailedInfo = await extractDetailedInformation(signature);
                console.log('Detailed Info:', JSON.stringify(detailedInfo, null, 2));
        
                if (detailedInfo) {
                    logTransaction(detailedInfo);
                    const simplifiedTx = await simplifyTransaction(detailedInfo, walletPool);
                    console.log('Simplified Tx:', JSON.stringify(simplifiedTx, null, 2));
                    console.log(`${simplifiedTx.walletName} - ${simplifiedTx.signature} - ${simplifiedTx.time} - ${simplifiedTx.action} - ${simplifiedTx.from} - ${simplifiedTx.to} - Input: ${simplifiedTx.inputAmount} ${simplifiedTx.inputToken} - Output: ${simplifiedTx.outputAmount} ${simplifiedTx.outputToken}`);
                }
        
                // Remove the signature from the set after some time to prevent memory growth
                setTimeout(() => {
                    processedSignatures.delete(signature);
                }, 60000); // Remove after 1 minute
            }
        });

        ws.on('close', () => {
            clearInterval(pingTimer);
            console.log(`Connection closed for ${name}, reconnecting...`);
            delete connections[name];
            setupConnection(name, address, connections);
        });

        connections[name] = { ws, pingTimer };
    } catch (error) {
        console.error(`Failed to connect for ${name}:`, error);
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
    await new Promise(() => {});
}

module.exports = {
    setupConnections
};