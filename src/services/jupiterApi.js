import fetch from "node-fetch";
import { Connection, Keypair, VersionedTransaction, PublicKey, sendAndConfirmRawTransaction, LAMPORTS_PER_SOL } from '@solana/web3.js';
import bs58 from 'bs58';
import dotenv from 'dotenv';
import { Wallet } from '@project-serum/anchor';
import { getAssociatedTokenAddress } from "@solana/spl-token";
import { log, LOG_LEVELS, logTransaction } from '../utils/logger.js';

dotenv.config();

const privateKey = process.env.PRIVATE_KEY;
if (!privateKey) {
    throw new Error('PRIVATE_KEY environment variable is not set.');
}

const RPC_ENDPOINT = `https://mainnet.helius-rpc.com/?api-key=${process.env.API_KEY}`;

const connection = new Connection(RPC_ENDPOINT, 'confirmed', {
    commitment: 'confirmed',
    timeout: 10000
});

const solAddress = "So11111111111111111111111111111111111111112";
const SOLANA_GAS_FEE_PRICE = 0.000005 * LAMPORTS_PER_SOL;

function sleep(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

const wallet = new Wallet(Keypair.fromSecretKey(bs58.decode(privateKey)));

// PnL tracking
let transactions = {};

function recordTransaction(type, tokenAddress, amount) {
    if (!transactions[tokenAddress]) {
        transactions[tokenAddress] = [];
    }
    transactions[tokenAddress].push({ type, amount, timestamp: Date.now() });
}

function calculatePnL(tokenAddress) {
    if (!transactions[tokenAddress] || transactions[tokenAddress].length === 0) {
        log(LOG_LEVELS.INFO, `No transactions found for ${tokenAddress}`, { isBot: true });
        return;
    }

    let totalBuySOL = 0;
    let totalSellSOL = 0;
    let totalBuyTokens = 0;
    let totalSellTokens = 0;

    transactions[tokenAddress].forEach(t => {
        if (t.type === 'buy') {
            totalBuySOL += t.amount;
            totalBuyTokens += t.amount;
        } else if (t.type === 'sell') {
            totalSellSOL += t.amount;
            totalSellTokens += t.amount;
        }
    });

    const pnlSOL = totalSellSOL - totalBuySOL;
    const pnlPercentage = ((totalSellSOL / totalBuySOL) - 1) * 100;

    const pnlMessage = `PnL for ${tokenAddress}:\n` +
        `Total bought: ${totalBuyTokens} tokens for ${totalBuySOL} SOL\n` +
        `Total sold: ${totalSellTokens} tokens for ${totalSellSOL} SOL\n` +
        `PnL: ${pnlSOL} SOL (${pnlPercentage.toFixed(2)}%)`;
    const color = pnlSOL > 0 ? 'GREEN' : pnlSOL < 0 ? 'RED' : 'CYAN';
    log(LOG_LEVELS.INFO, pnlMessage, { isBot: true, color: color });
}

async function tradeTokenWithJupiter(tokenAddress, percentage, isBuy = true, slippage = 10) {
    const maxRetries = 3;
    let retryCount = 0;
    let success = false;

    while (retryCount < maxRetries && !success) {
        try {
            let amount, inputMint, outputMint;

            if (isBuy) {
                const balance = await connection.getBalance(wallet.publicKey);
                amount = Math.floor(balance * (percentage / 100)) - SOLANA_GAS_FEE_PRICE;
                inputMint = solAddress;
                outputMint = tokenAddress;

                if (amount < 0) {
                    log(LOG_LEVELS.ERROR, "Amount is less than gas fee", {
                        isBot: true,
                    });
                    return false;
                }

                log(LOG_LEVELS.INFO, `Starting buy transaction for ${amount / LAMPORTS_PER_SOL} SOL worth of ${tokenAddress}`, {
                    isBot: true,
                });
            } else {
                const tokenPublicKey = new PublicKey(tokenAddress);
                const tokenAccount = await getAssociatedTokenAddress(tokenPublicKey, wallet.publicKey);
                const tokenBalance = await connection.getTokenAccountBalance(tokenAccount);
                amount = Math.floor(tokenBalance.value.uiAmount * (percentage / 100) * Math.pow(10, tokenBalance.value.decimals));
                inputMint = tokenAddress;
                outputMint = solAddress;

                log(LOG_LEVELS.INFO, `Starting sell transaction for ${percentage}% of ${tokenAddress}`, {
                    isBot: true,
                });
            }

            const response = await fetch(`https://quote-api.jup.ag/v6/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=${slippage * 100}`);

            if (!response.ok) {
                throw new Error(`HTTP quote error! status: ${response.statusText}`);
            }

            const routes = await response.json();
            log(LOG_LEVELS.DEBUG, `Received routes: ${JSON.stringify(routes)}, {}`, {
                sendToDiscord: false,
                isBot: true,
            });

            if (!routes || !routes.routePlan || routes.routePlan.length === 0) {
                throw new Error("Invalid quote received");
            }

            const transaction_response = await fetch('https://quote-api.jup.ag/v6/swap', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    quoteResponse: routes,
                    userPublicKey: wallet.publicKey.toString(),
                    wrapUnwrapSOL: true,
                    prioritizationFeeLamports: "auto",
                    dynamicComputeUnitLimit: true,
                })
            });

            if (!transaction_response.ok) {
                throw new Error(`HTTP error! status: ${transaction_response.status}`);
            }

            const transactions = await transaction_response.json();
            const { swapTransaction } = transactions;

            const swapTransactionBuf = Buffer.from(swapTransaction, 'base64');
            var transaction = VersionedTransaction.deserialize(swapTransactionBuf);
            transaction.sign([wallet.payer]);

            const rawTransaction = transaction.serialize();

            const txid = await sendAndConfirmRawTransaction(connection, rawTransaction, {
                skipPreflight: true,
                maxRetries: 5,
                commitment: 'processed',
                timeout: 40000
            });

            log(LOG_LEVELS.INFO, `${isBuy ? 'Buy' : 'Sell'} Order:: https://solscan.io/tx/${txid}`, {
                isBot: true,
            });
            success = true;

            const txInfo = await connection.getTransaction(txid, {
                maxSupportedTransactionVersion: 0
            });
            logTransaction(txInfo);

            // For buy transactions
            if (isBuy) {
                recordTransaction('buy', tokenAddress, amount / LAMPORTS_PER_SOL);
            }

            // For sell transactions
            if (!isBuy) {
                recordTransaction('sell', tokenAddress, amount / LAMPORTS_PER_SOL);
            }

            // Calculate PnL after selling
            if (!isBuy) {
                calculatePnL(tokenAddress);
            }

        } catch (error) {
            log(LOG_LEVELS.WARN, `Transaction failed, retrying (${retryCount + 1}/${maxRetries}). Error: ${error.message}`, {
                isBot: true,
            });
            retryCount++;
            await sleep(5000);
        }
    }

    if (!success) {
        log(LOG_LEVELS.ERROR, `${isBuy ? 'Buy' : 'Sell'} transaction failed after ${maxRetries} attempts. Stopping program.`, {
            isBot: true,
        });
        return false;
    }

    await sleep(1000);
    return success;
}

export { tradeTokenWithJupiter };