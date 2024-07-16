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
// Solana gas fee
const SOLANA_GAS_FEE_PRICE = 0.000005 * LAMPORTS_PER_SOL;  //Solana accounts require a minimum amount of SOL in order to exist on the blockchain, this is called rent-exempt account.
let slipTarget = 5;

function sleep(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms); // ms
    });
}

const wallet = new Wallet(Keypair.fromSecretKey(bs58.decode(privateKey)));

async function buyTokenWithJupiter(tokenAddress, percentage) {
    const maxRetries = 3;
    let retryCount = 0;
    let success = false;

    while (retryCount < maxRetries && !success) {
        try {
            // Check SOL balance before transaction
            const balance = await connection.getBalance(wallet.publicKey);
            const solAmountToUse = balance * (percentage / 100);
            const amount = Math.floor(solAmountToUse);

            log(LOG_LEVELS.INFO, `Starting buy transaction for ${amount / LAMPORTS_PER_SOL} SOL worth of ${tokenAddress}`);

            if (balance < amount) {
                log(LOG_LEVELS.ERROR, `Insufficient balance. Required: ${amount / LAMPORTS_PER_SOL} SOL, Available: ${balance / LAMPORTS_PER_SOL} SOL`);
                return false;
            }

            const rAmount = amount - SOLANA_GAS_FEE_PRICE;
            if (rAmount < 0) {
                log(LOG_LEVELS.ERROR, "Amount is less than gas fee");
                return false;
            }

            log(LOG_LEVELS.INFO, `Swap amount: ${rAmount / LAMPORTS_PER_SOL} SOL`);
            log(LOG_LEVELS.INFO, `Swap type: buy`);
            log(LOG_LEVELS.INFO, `Swap wallet: ${wallet.publicKey.toString()}`);

            const fixedSwapValLamports = Math.floor(rAmount);
            const slipBPS = slipTarget * 100;

            let response = await fetch(`https://quote-api.jup.ag/v6/quote?inputMint=${solAddress}&outputMint=${tokenAddress}&amount=${fixedSwapValLamports}&onlyDirectRoutes=true`);

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const routes = await response.json();
            log(LOG_LEVELS.DEBUG, `Received routes: ${JSON.stringify(routes)}`);

            // Check if the quote is valid
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
                commitment: 'confirmed',
                timeout: 30000 // 30 seconds timeout
            });

            log(LOG_LEVELS.INFO, `buy Order:: https://solscan.io/tx/${txid}`);
            success = true;

            // Log transaction details
            const txInfo = await connection.getTransaction(txid, {
                maxSupportedTransactionVersion: 0
            });
            logTransaction(txInfo);

        } catch (error) {
            log(LOG_LEVELS.WARN, `Transaction failed, retrying (${retryCount + 1}/${maxRetries}). Error: ${error.message}`);
            retryCount++;
            await sleep(5000); // Wait 5 seconds before retrying
        }
    }

    if (!success) {
        log(LOG_LEVELS.ERROR, "Transaction failed after 3 attempts. Stopping program.");
        return false;
    }

    await sleep(1000); // 1 second delay to avoid 429 too many requests
    return success;
}

async function sellTokenWithJupiter(tokenAddress, percentage) {
    try {
        const tokenPublicKey = new PublicKey(tokenAddress);
        log(LOG_LEVELS.INFO, `Token Public Key: ${tokenPublicKey.toString()}`);

        const tokenAccount = await getAssociatedTokenAddress(
            tokenPublicKey,
            wallet.publicKey
        );
        log(LOG_LEVELS.INFO, `Associated Token Account: ${tokenAccount.toString()}`);
        
        let tokenBalance;
        try {
            tokenBalance = await connection.getTokenAccountBalance(tokenAccount);
            log(LOG_LEVELS.INFO, `Token Balance: ${JSON.stringify(tokenBalance)}`);
        } catch (error) {
            log(LOG_LEVELS.ERROR, `Error getting token balance: ${error.message}`);
            log(LOG_LEVELS.ERROR, `Full error: ${JSON.stringify(error)}`);
            return false;
        }

        // Use percentage of the token balance
        const tokenAmountToSell = tokenBalance.value.uiAmount * (percentage / 100);
        log(LOG_LEVELS.INFO, `Selling ${percentage}% of token balance: ${tokenAmountToSell} tokens`);

        // Convert tokenAmountToSell to the correct number of decimal places
        const decimals = tokenBalance.value.decimals;
        const rawTokenAmount = Math.floor(tokenAmountToSell * Math.pow(10, decimals));

        if (tokenBalance.value.amount < rawTokenAmount) {
            log(LOG_LEVELS.ERROR, `Insufficient token balance. Required: ${tokenAmountToSell}, Available: ${tokenBalance.value.uiAmount}`);
            return false;
        }

        return buyTokenWithJupiter(tokenAddress, rawTokenAmount, 'sell');
    } catch (error) {
        log(LOG_LEVELS.ERROR, `Error in sellTokenWithJupiter: ${error.message}`);
        logDetailedInfo({ error: error.toString(), stack: error.stack });
        return false;
    }
}

// Example usage
buyTokenWithJupiter("", 60);
// sellTokenWithJupiter("", 10);

export { buyTokenWithJupiter, sellTokenWithJupiter };
