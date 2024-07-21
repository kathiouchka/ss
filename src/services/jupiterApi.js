import fetch from "node-fetch";
import { Connection, Keypair, VersionedTransaction, PublicKey, sendAndConfirmRawTransaction, LAMPORTS_PER_SOL } from '@solana/web3.js';
import bs58 from 'bs58';
import dotenv from 'dotenv';
import { Wallet } from '@project-serum/anchor';
import { getAssociatedTokenAddress } from "@solana/spl-token";
import { log, LOG_LEVELS, logTransaction, logDetailedInfo } from '../utils/logger.js';

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
let transactions = [];

function recordTransaction(type, tokenAddress, amount, price) {
    const amountInSOL = type === 'buy' ? amount / LAMPORTS_PER_SOL : amount * price / LAMPORTS_PER_SOL;
    transactions.push({ type, tokenAddress, amount: amountInSOL, price, timestamp: Date.now() });
}

function calculatePnL(tokenAddress) {
    let buyTotalSOL = 0;
    let sellTotalSOL = 0;

    transactions.filter(t => t.tokenAddress === tokenAddress).forEach(t => {
        if (t.type === 'buy') {
            buyTotalSOL += t.amount / LAMPORTS_PER_SOL; // Convert lamports to SOL
        } else if (t.type === 'sell') {
            sellTotalSOL += t.amount * t.price / LAMPORTS_PER_SOL; // Convert token amount to SOL
        }
    });

    const pnl = sellTotalSOL - buyTotalSOL;
    const pnlPercentage = ((sellTotalSOL / buyTotalSOL) - 1) * 100;
    log(LOG_LEVELS.INFO, `PnL for ${tokenAddress}: ${pnl.toFixed(4)} SOL (${pnlPercentage.toFixed(2)}%)`, true, true);
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
                    log(LOG_LEVELS.ERROR, "Amount is less than gas fee");
                    return false;
                }

                log(LOG_LEVELS.INFO, `Starting buy transaction for ${amount / LAMPORTS_PER_SOL} SOL worth of ${tokenAddress}`);
            } else {
                const tokenPublicKey = new PublicKey(tokenAddress);
                const tokenAccount = await getAssociatedTokenAddress(tokenPublicKey, wallet.publicKey);
                const tokenBalance = await connection.getTokenAccountBalance(tokenAccount);
                amount = Math.floor(tokenBalance.value.uiAmount * (percentage / 100) * Math.pow(10, tokenBalance.value.decimals));
                inputMint = tokenAddress;
                outputMint = solAddress;

                log(LOG_LEVELS.INFO, `Starting sell transaction for ${percentage}% of ${tokenAddress}`);
            }

            const response = await fetch(`https://quote-api.jup.ag/v6/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&onlyDirectRoutes=true&slippageBps=${slippage * 100}`);

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const routes = await response.json();
            log(LOG_LEVELS.DEBUG, `Received routes: ${JSON.stringify(routes)}`);

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

            log(LOG_LEVELS.INFO, `${isBuy ? 'Buy' : 'Sell'} Order:: https://solscan.io/tx/${txid}`, true, true);
            success = true;

            const txInfo = await connection.getTransaction(txid, {
                maxSupportedTransactionVersion: 0
            });
            logTransaction(txInfo);

            // For buy transactions
            if (isBuy) {
                recordTransaction('buy', tokenAddress, amount, 1); // price is 1 because amount is already in SOL
            }

            // For sell transactions
            if (!isBuy) {
                const price = routes.outAmount / routes.inAmount;
                recordTransaction('sell', tokenAddress, amount, price);
            }

            // Calculate PnL after selling
            if (!isBuy) {
                calculatePnL(tokenAddress);
            }

        } catch (error) {
            log(LOG_LEVELS.WARN, `Transaction failed, retrying (${retryCount + 1}/${maxRetries}). Error: ${error.message}`);
            retryCount++;
            await sleep(5000);
        }
    }

    if (!success) {
        log(LOG_LEVELS.ERROR, `${isBuy ? 'Buy' : 'Sell'} transaction failed after ${maxRetries} attempts. Stopping program.`);
        return false;
    }

    await sleep(1000);
    return success;
}

export { tradeTokenWithJupiter };