require('dotenv').config();
const { Connection, PublicKey } = require('@solana/web3.js');
const WebSocket = require('ws');
const fs = require('fs');
const axios = require('axios');

const WebSocketScheme = 'wss';
const WebSocketHost = 'mainnet.helius-rpc.com';
const APIKeyEnvVar = 'API_KEY';

let walletPool = {
    "RADYIUM WALLET": "",
    "MAIN WALLET": "",
    // Add more named wallets here
};

let ws;

function logTransaction(tx) {
    const jsonData = JSON.stringify(tx, null, 2);
    fs.appendFileSync('transactions.log', jsonData + '\n\n');
}

function simplifyTransaction(tx, walletPool) {
    let simplifiedTx = {
        signature: tx.signature,
        time: tx.timestamp,
        action: tx.type,
        from: '',
        to: '',
        inputAmount: '',
        inputToken: '',
        outputAmount: '',
        outputToken: '',
        walletName: ''
    };

    if (tx.type === 'SWAP') {
        const swap = tx.events.swap;
        if (swap && swap.innerSwaps && swap.innerSwaps.length > 0) {
            const innerSwap = swap.innerSwaps[0];

            if (innerSwap.tokenInputs && innerSwap.tokenInputs.length > 0) {
                const input = innerSwap.tokenInputs[0];
                simplifiedTx.from = input.fromUserAccount;
                simplifiedTx.inputAmount = input.tokenAmount;
                simplifiedTx.inputToken = input.mint;
            } else if (swap.nativeInput) {
                simplifiedTx.from = swap.nativeInput.account;
                simplifiedTx.inputAmount = swap.nativeInput.amount / 1e9;
                simplifiedTx.inputToken = 'So11111111111111111111111111111111111111112'; // Native SOL mint address
            }

            if (innerSwap.tokenOutputs && innerSwap.tokenOutputs.length > 0) {
                const output = innerSwap.tokenOutputs[0];
                simplifiedTx.to = output.toUserAccount;
                simplifiedTx.outputAmount = output.tokenAmount;
                simplifiedTx.outputToken = output.mint;
            } else if (swap.nativeOutput) {
                simplifiedTx.to = swap.nativeOutput.account;
                simplifiedTx.outputAmount = swap.nativeOutput.amount / 1e9;
                simplifiedTx.outputToken = 'So11111111111111111111111111111111111111112'; // Native SOL mint address
            }
        }
    } else if (tx.tokenTransfers && tx.tokenTransfers.length > 0) {
        const transfer = tx.tokenTransfers[0];
        simplifiedTx.from = transfer.fromUserAccount;
        simplifiedTx.to = transfer.toUserAccount;
        simplifiedTx.inputAmount = transfer.tokenAmount;
        simplifiedTx.inputToken = transfer.mint;
    } else if (tx.nativeTransfers && tx.nativeTransfers.length > 0) {
        const transfer = tx.nativeTransfers[0];
        simplifiedTx.from = transfer.fromUserAccount;
        simplifiedTx.to = transfer.toUserAccount;
        simplifiedTx.inputAmount = transfer.amount / 1e9; // Convert lamports to SOL
        simplifiedTx.inputToken = 'So11111111111111111111111111111111111111112'; // Native SOL mint address
    }

    // Find the wallet name
    for (const [name, pubkey] of Object.entries(walletPool)) {
        if (simplifiedTx.from === pubkey || simplifiedTx.to === pubkey) {
            simplifiedTx.walletName = name;
            break;
        }
    }

    return simplifiedTx;
}

async function extractDetailedInformation(signature) {
    const apiKey = process.env[APIKeyEnvVar];
    const url = `https://api.helius.xyz/v0/transactions/?api-key=${apiKey}`;

    try {
        const response = await axios.post(url, {
            transactions: [signature]
        });

        if (response.data && response.data.length > 0) {
            const txInfo = response.data[0];
            return {
                timestamp: new Date(txInfo.timestamp * 1000).toISOString(),
                signature: txInfo.signature,
                type: txInfo.type,
                fee: txInfo.fee,
                slot: txInfo.slot,
                accountKeys: txInfo.accountKeys,
                instructions: txInfo.instructions.map(inst => ({
                    programId: inst.programId,
                    data: inst.data,
                    accounts: inst.accounts
                })),
                tokenTransfers: txInfo.tokenTransfers,
                nativeTransfers: txInfo.nativeTransfers,
                events: txInfo.events
            };
        }
    } catch (error) {
        console.error('Error fetching transaction details:', error);
        console.error('Full error object:', JSON.stringify(error, null, 2));
    }

    return null;
}

function connectAndSubscribe(walletAddress) {
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

function addWallet(name, publicKey) {
    if (!walletPool[name]) {
        walletPool[name] = publicKey;
        console.log(`Added wallet: ${name} (${publicKey})`);
        setupConnection(name, publicKey);
    }
}

function removeWallet(name) {
    if (walletPool[name]) {
        delete walletPool[name];
        console.log(`Removed wallet: ${name}`);
        if (connections[name]) {
            connections[name].ws.close();
            clearInterval(connections[name].pingTimer);
            delete connections[name];
        }
    }
}

async function main() {
    const pingInterval = 25000; // 25 seconds
    let connections = {};

    process.on('SIGINT', () => {
        console.log('Interrupt received, shutting down...');
        Object.values(connections).forEach(conn => conn.ws.close());
        process.exit(0);
    });

    async function setupConnection(name, address) {
        try {
            const ws = await connectAndSubscribe(address);
            const pingTimer = setInterval(() => {
                ws.ping();
            }, pingInterval);

            ws.on('message', async (message) => {
                console.log('Received message:', message.toString('utf8'));
                const messageData = JSON.parse(message);
                const params = messageData.params;
                if (!params || !params.result || !params.result.value) return;

                const value = params.result.value;
                const signature = value.signature;

                if (signature) {
                    const detailedInfo = await extractDetailedInformation(signature);

                    if (detailedInfo) {
                        logTransaction(detailedInfo);
                        const simplifiedTx = simplifyTransaction(detailedInfo, walletPool);
                        console.log(`${simplifiedTx.walletName} - ${simplifiedTx.signature} - ${simplifiedTx.time} - ${simplifiedTx.action} - ${simplifiedTx.from} - ${simplifiedTx.to} - Input: ${simplifiedTx.inputAmount} ${simplifiedTx.inputToken} - Output: ${simplifiedTx.outputAmount} ${simplifiedTx.outputToken}`);
                    }
                }
            });

            ws.on('close', () => {
                clearInterval(pingTimer);
                console.log(`Connection closed for ${name}, reconnecting...`);
                delete connections[name];
                setupConnection(name, address);
            });

            connections[name] = { ws, pingTimer };
        } catch (error) {
            console.error(`Failed to connect for ${name}:`, error);
            setTimeout(() => setupConnection(name, address), 3000);
        }
    }

    for (const [name, address] of Object.entries(walletPool)) {
        await setupConnection(name, address);
    }

    // Keep the main process running
    await new Promise(() => {});
}

main().catch(console.error);