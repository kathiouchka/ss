import fetch from "node-fetch";
import { Connection, Keypair, VersionedTransaction, PublicKey, sendAndConfirmRawTransaction, sendAndConfirmTransaction, LAMPORTS_PER_SOL } from '@solana/web3.js';
import bs58 from 'bs58';
import dotenv from 'dotenv';
import { Wallet } from '@project-serum/anchor';
import { getAssociatedTokenAddress, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { log, LOG_LEVELS, logTransaction, logDetailedInfo } from '../utils/logger.js';
import { getTokenInfo } from '../utils/api.js';

dotenv.config();
``
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

let tokensBought = 0;

async function buyTokenWithJupiter(tokenAddress, amount, type) {
    try {
        log(LOG_LEVELS.INFO, `Starting ${type} transaction for ${amount / LAMPORTS_PER_SOL} SOL worth of ${tokenAddress}`);

        // Check balance before transaction
        const balance = await connection.getBalance(wallet.publicKey);
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
        log(LOG_LEVELS.INFO, `Swap type: ${type}`);
        log(LOG_LEVELS.INFO, `Swap wallet: ${wallet.publicKey.toString()}`);

        const fixedSwapValLamports = Math.floor(rAmount);
        const slipBPS = slipTarget * 100;

        let response;
        if (type === "buy") {
            response = await fetch(`https://quote-api.jup.ag/v6/quote?inputMint=${solAddress}&outputMint=${tokenAddress}&amount=${fixedSwapValLamports}&onlyDirectRoutes=true`);
        } else {
            response = await fetch(`https://quote-api.jup.ag/v6/quote?inputMint=${tokenAddress}&outputMint=${solAddress}&amount=${fixedSwapValLamports}&onlyDirectRoutes=true`);
        }

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const routes = await response.json();
        log(LOG_LEVELS.DEBUG, `Received routes: ${JSON.stringify(routes)}`);

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

        let retryCount = 0;
        const maxRetries = 5;
        let success = false;

        while (retryCount < maxRetries && !success) {
            try {
                const txid = await sendAndConfirmRawTransaction(connection, rawTransaction, {
                    skipPreflight: true,
                    maxRetries: 3,
                    commitment: 'confirmed',
                    timeout: 60000 // 60 seconds timeout
                });
                log(LOG_LEVELS.INFO, `${type} Order:: https://solscan.io/tx/${txid}`);
                success = true;

                // Log transaction details
                const txInfo = await connection.getTransaction(txid, {
                    maxSupportedTransactionVersion: 0
                });
                logTransaction(txInfo);

                if (success && type === 'buy') {
                    const tokenInfo = await getTokenInfo(tokenAddress);
                    if (tokenInfo) {
                        const tokensBoughtThisTransaction = amount / tokenInfo.price;
                        tokensBought += tokensBoughtThisTransaction;
                        log(LOG_LEVELS.INFO, `Bought ${tokensBoughtThisTransaction} tokens. Total tokens: ${tokensBought}`);
                    }
                }
            } catch (error) {
                log(LOG_LEVELS.WARN, `Transaction failed, retrying (${retryCount + 1}/${maxRetries}). Error: ${error.message}`);
                retryCount++;
                await sleep(5000); // Wait 5 seconds before retrying
            }
        }

        if (!success) {
            log(LOG_LEVELS.ERROR, "Transaction failed after 5 attempts. Stopping program.");
            return false;
        }

        await sleep(1000); // 1 second delay to avoid 429 too many requests
        return success;
    } catch (error) {
        log(LOG_LEVELS.ERROR, `Error in buyTokenWithJupiter: ${error.message}`);
        logDetailedInfo({ error: error.toString(), stack: error.stack });
        return false;
    }
}

async function sellTokenWithJupiter(tokenAddress, tokenAmount) {
    try {
        // Check token balance before selling
        const tokenPublicKey = new PublicKey(tokenAddress);
        console.log(tokenPublicKey)
        const tokenAccount = await getAssociatedTokenAddress(
            TOKEN_PROGRAM_ID,
            tokenPublicKey,
            wallet.publicKey
        );
        console.log(tokenAccount)
        const tokenBalance = await connection.getTokenAccountBalance(tokenAccount);

        if (tokenBalance.value.uiAmount < tokenAmount) {
            log(LOG_LEVELS.ERROR, `Insufficient token balance. Required: ${tokenAmount}, Available: ${tokenBalance.value.uiAmount}`);
            return false;
        }

        return buyTokenWithJupiter(tokenAddress, tokenAmount, 'sell');
    } catch (error) {
        log(LOG_LEVELS.ERROR, `Error in sellTokenWithJupiter: ${error.message}`);
        logDetailedInfo({ error: error.toString(), stack: error.stack });
        return false;
    }
}

// buyTokenWithJupiter("", 10000000, "buy");
sellTokenWithJupiter("", 1565844948.1917965);

export { buyTokenWithJupiter, sellTokenWithJupiter };
