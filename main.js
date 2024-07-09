require('dotenv').config();
const { Connection, PublicKey } = require('@solana/web3.js');
const WebSocket = require('ws');
const fs = require('fs');
const axios = require('axios'); // You'll need to install this package

const WebSocketScheme = 'wss';
const WebSocketHost = 'mainnet.helius-rpc.com';
const APIKeyEnvVar = 'API_KEY';

function logTransaction(tx) {
  const jsonData = JSON.stringify(tx, null, 2);
  fs.appendFileSync('transactions.log', jsonData + '\n\n');
}

async function extractDetailedInformation(signature) {
  const apiKey = process.env[APIKeyEnvVar];
  const url = `https://${WebSocketHost}/v0/transactions/?api-key=${apiKey}`;
  
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
  }

  return null;
}

function connectAndSubscribe(mentions) {
    return new Promise((resolve, reject) => {
      const apiKey = process.env[APIKeyEnvVar];
      if (!apiKey) {
        reject(new Error('API key not provided'));
        return;
      }
  
      const url = `${WebSocketScheme}://${WebSocketHost}?api-key=${apiKey}`;
      console.log(`connecting to ${url}`);
  
      const ws = new WebSocket(url);
  
      ws.on('open', () => {
        const subscribe = {
          jsonrpc: '2.0',
          id: 1,
          method: 'logsSubscribe',
          params: [
            { mentions },
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

async function main() {
  const walletPubKey = process.env[WALLET_PUB_KEY];
  const pingInterval = 25000; // 25 seconds

  while (true) {
    try {
      const ws = await connectAndSubscribe([walletPubKey]);

      const pingTimer = setInterval(() => {
        ws.ping();
      }, pingInterval);

      ws.on('message', async (message) => {
        const messageData = JSON.parse(message);
        const params = messageData.params;
        if (!params || !params.result || !params.result.value) return;

        const value = params.result.value;
        const signature = value.signature;

        if (signature) {
          const detailedInfo = await extractDetailedInformation(signature);

          if (detailedInfo) {
            // Log the transaction
            logTransaction(detailedInfo);

            // Display the detailed information
            console.log('Transaction Details:');
            console.log(JSON.stringify(detailedInfo, null, 2));
            console.log('------------------------');
          }
        }
      });

      ws.on('close', () => {
        clearInterval(pingTimer);
        console.log('Connection closed, reconnecting...');
      });

      await new Promise((resolve) => {
        process.on('SIGINT', () => {
          console.log('Interrupt received, shutting down...');
          ws.close();
          resolve();
        });
      });

    } catch (error) {
      console.error('Failed to connect:', error);
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }
}

main().catch(console.error);