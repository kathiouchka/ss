require('dotenv').config(); // Load environment variables

const reloadEnv = () => {
  // Delete the specific environment variables
  delete process.env.API_KEY;
  delete process.env.WALLET_PUB_KEY;

  // Reload .env file
  require('dotenv').config();
};

// Call this function before using the environment variables
reloadEnv();

  
const { Connection, PublicKey } = require('@solana/web3.js');
const WebSocket = require('ws');
const fs = require('fs');
const axios = require('axios'); // You'll need to install this package

const WebSocketScheme = 'wss';
const WebSocketHost = 'mainnet.helius-rpc.com';
const APIKeyEnvVar = 'API_KEY';
const walletPubKeysEnvVar = "WALLET_PUB_KEY"

function logTransaction(tx) {
  const jsonData = JSON.stringify(tx, null, 2);
  fs.appendFileSync('transactions.log', jsonData + '\n\n');
}

function simplifyTransaction(tx) {
    let simplifiedTx = {
      signature: tx.signature,
      time: tx.timestamp,
      action: tx.type,
      from: '',
      to: '',
      inputAmount: '',
      inputToken: '',
      outputAmount: '',
      outputToken: ''
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

function isSpecificTransaction(simplifiedTx) {
    return simplifiedTx.action === 'TRANSFER' && 
           simplifiedTx.outputAmount === 105 && 
           simplifiedTx.outputToken === 'So11111111111111111111111111111111111111112';
  }


  
  function isTokenMint(tx) {
  return tx.type === 'TOKEN_MINT';
}

function isPoolCreation(tx) {
  // This is a simplified check. You may need to adjust based on the specific DEX you're monitoring
  return tx.type === 'UNKNOWN' && tx.instructions.some(inst => inst.programId === 'YOUR_DEX_PROGRAM_ID');
}

async function buyToken(inputMint, outputMint, amount) {
  try {
    const response = await axios.get(`${JUP_API_BASE_URL}/quote`, {
      params: {
        inputMint,
        outputMint,
        amount,
        slippageBps: 50
      }
    });
    // Execute the transaction using Jupiter API
    // This is a placeholder. You'll need to implement the actual transaction execution
    console.log('Buying token:', response.data);
  } catch (error) {
    console.error('Error buying token:', error);
  }
}

async function sellToken(inputMint, outputMint, amount) {
  try {
    const response = await axios.get(`${JUP_API_BASE_URL}/quote`, {
      params: {
        inputMint,
        outputMint,
        amount,
        slippageBps: 50
      }
    });
    // Execute the transaction using Jupiter API
    // This is a placeholder. You'll need to implement the actual transaction execution
    console.log('Selling token:', response.data);
  } catch (error) {
    console.error('Error selling token:', error);
  }
}

async function main() {
  const walletPubKeys = process.env[walletPubKeysEnvVar].split(',').map(key => key.trim());
  let monitoredWallets = [walletPubKeys];
  let newTokens = new Map(); // Map to store new token mints
  let lastTransactions = new Map(); // Map to store last transaction for each token
  const pingInterval = 25000; // 25 seconds
  let ws;

  process.on('SIGINT', () => {
    console.log('Interrupt received, shutting down...');
    if (ws) {
      ws.close();
    }
    process.exit(0);
  });

  while (true) {
    try {
      ws = await connectAndSubscribe(monitoredWallets);

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
            logTransaction(detailedInfo);
            const simplifiedTx = simplifyTransaction(detailedInfo);
            
            console.log(`${simplifiedTx.signature} - ${simplifiedTx.time} - ${simplifiedTx.action} - ${simplifiedTx.from} - ${simplifiedTx.to} - Input: ${simplifiedTx.inputAmount} ${simplifiedTx.inputToken} - Output: ${simplifiedTx.outputAmount} ${simplifiedTx.outputToken}`);
            
            if (isTokenMint(detailedInfo)) {
              const tokenMint = detailedInfo.tokenTransfers[0].mint;
              newTokens.set(tokenMint, { createdAt: Date.now(), poolCreated: false });
              console.log(`New token minted: ${tokenMint}`);
            }

            if (isPoolCreation(detailedInfo)) {
              const tokenMint = detailedInfo.tokenTransfers[0].mint;
              if (newTokens.has(tokenMint)) {
                newTokens.get(tokenMint).poolCreated = true;
                console.log(`Pool created for token: ${tokenMint}`);
                await buyToken('SOL_MINT_ADDRESS', tokenMint, 'AMOUNT_TO_BUY');
                monitoredWallets.push(simplifiedTx.to);
              }
            }

            if (newTokens.has(simplifiedTx.inputToken) || newTokens.has(simplifiedTx.outputToken)) {
              const tokenMint = newTokens.has(simplifiedTx.inputToken) ? simplifiedTx.inputToken : simplifiedTx.outputToken;
              const currentAmount = simplifiedTx.inputToken === tokenMint ? simplifiedTx.inputAmount : simplifiedTx.outputAmount;

              if (lastTransactions.has(tokenMint) && lastTransactions.get(tokenMint).amount === currentAmount) {
                console.log(`Detected two consecutive transactions with same amount for token: ${tokenMint}`);
                await sellToken(tokenMint, 'SOL_MINT_ADDRESS', currentAmount);
              }

              lastTransactions.set(tokenMint, { amount: currentAmount, timestamp: Date.now() });
            }
          }
        }
      });

      ws.on('close', () => {
        clearInterval(pingTimer);
        console.log('Connection closed, reconnecting...');
      });

      await new Promise((resolve) => {
        ws.on('close', resolve);
      });

    } catch (error) {
      console.error('Failed to connect:', error);
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }
}

main().catch(console.error);