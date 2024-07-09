require('dotenv').config();
const { Connection, PublicKey } = require('@solana/web3.js');
const WebSocket = require('ws');
const fs = require('fs');

const WebSocketScheme = 'wss';
const WebSocketHost = 'mainnet.helius-rpc.com';
const APIKeyEnvVar = 'API_KEY';

function logTransaction(tx) {
  const jsonData = JSON.stringify(tx);
  fs.appendFileSync('transactions.log', jsonData + '\n');
}

function extractInstructions(logs) {
  const instructions = {};
  for (const log of logs) {
    if (typeof log === 'string' && log.includes('Instruction:')) {
      if (log.includes('Transfer') || log.includes('TransferChecked')) {
        instructions['Transfer'] = true;
      } else if (log.includes('Swap')) {
        instructions['Swap'] = true;
      } else if (log.includes('MintTo')) {
        instructions['MintTo'] = true;
      } else if (log.includes('Burn')) {
        instructions['Burn'] = true;
      }
    }
  }
  return instructions;
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
  const walletPubKey = '';
  const pingInterval = 25000; // 25 seconds

  while (true) {
    try {
      const ws = await connectAndSubscribe([walletPubKey]);

      const pingTimer = setInterval(() => {
        ws.ping();
      }, pingInterval);

      ws.on('message', (message) => {
        const messageData = JSON.parse(message);
        const params = messageData.params;
        if (!params) return;

        const result = params.result;
        if (!result) return;

        const value = result.value;
        if (!value) return;

        const signature = value.signature;
        const logs = value.logs;

        if (!signature || !logs) return;

        const tx = {
          timestamp: new Date(),
          signature,
          logs,
          value
        };

        logTransaction(tx);

        const instructions = extractInstructions(logs);

        if (Object.keys(instructions).length > 0) {
          console.log(`Transaction Signature: ${signature}`);
          console.log('Instructions:');
          for (const instruction in instructions) {
            console.log(`- ${instruction}`);
          }
          console.log('------------------------');
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