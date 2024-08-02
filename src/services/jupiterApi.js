import { searcher } from 'jito-ts';
const { searcherClient: createSearcherClient } = searcher;
import { Connection, Keypair, PublicKey, VersionedTransaction, LAMPORTS_PER_SOL, Transaction, SystemProgram } from '@solana/web3.js';
import { Bundle } from 'jito-ts/dist/sdk/block-engine/types.js';
import { isError } from 'jito-ts/dist/sdk/block-engine/utils.js';
import fetch from 'node-fetch';
import bs58 from 'bs58';
import dotenv from 'dotenv';
import { getAssociatedTokenAddress } from "@solana/spl-token";
import { log, LOG_LEVELS } from '../utils/logger.js';

dotenv.config();

const privateKey = process.env.PRIVATE_KEY;
if (!privateKey) {
    throw new Error('PRIVATE_KEY environment variable is not set.');
}

const RPC_ENDPOINT = `https://mainnet.helius-rpc.com/?api-key=${process.env.API_KEY}`;
const BLOCK_ENGINE_URL = 'frankfurt.mainnet.block-engine.jito.wtf';

const connection = new Connection(RPC_ENDPOINT, 'confirmed', {
    commitment: 'confirmed',
    timeout: 10000
});

const wallet = Keypair.fromSecretKey(bs58.decode(privateKey));
const searcherClient = createSearcherClient(BLOCK_ENGINE_URL);

const solAddress = "So11111111111111111111111111111111111111112";
const SOLANA_GAS_FEE_PRICE = 0.000005 * LAMPORTS_PER_SOL;

async function checkBalanceAndTransferSurplus() {
    try {
        const balance = await connection.getBalance(wallet.publicKey);
        const balanceInSOL = balance / LAMPORTS_PER_SOL;

        if (balanceInSOL > 0.22) {
            const surplusSOL = balanceInSOL - 0.22;
            const surplusLamports = Math.floor(surplusSOL * LAMPORTS_PER_SOL);

            const { blockhash } = await connection.getLatestBlockhash();

            const transaction = new Transaction().add(
                SystemProgram.transfer({
                    fromPubkey: wallet.publicKey,
                    toPubkey: new PublicKey(process.env.PROFIT_WALLET),
                    lamports: surplusLamports,
                })
            );

            transaction.recentBlockhash = blockhash;
            transaction.feePayer = wallet.publicKey;

            const signedTransaction = await wallet.signTransaction(transaction);

            const signature = await connection.sendRawTransaction(signedTransaction.serialize(), {
                skipPreflight: true,
                maxRetries: 5,
            });

            log(LOG_LEVELS.INFO, `Transferred ${surplusSOL.toFixed(6)} SOL to PROFIT_WALLET. Tx: https://solscan.io/tx/${signature}`, { isBot: true });
        } else {
            log(LOG_LEVELS.INFO, `Current wallet balance: ${balanceInSOL.toFixed(6)} SOL. No surplus to transfer.`, { isBot: true });
        }
    } catch (error) {
        log(LOG_LEVELS.ERROR, `Failed to check balance or transfer surplus: ${error.message}`, { isBot: true });
    }
}

async function tradeTokenWithJupiter(tokenAddress, percentage, isBuy = true, slippage = 15) {
    try {
        log(LOG_LEVELS.INFO, `Starting ${isBuy ? 'buy' : 'sell'} transaction for ${tokenAddress}`, { isBot: true });

        let amount, inputMint, outputMint;

        if (isBuy) {
            const balance = await connection.getBalance(wallet.publicKey);
            amount = Math.floor(balance * (percentage / 100)) - SOLANA_GAS_FEE_PRICE;
            inputMint = solAddress;
            outputMint = tokenAddress;

            if (amount < 0) {
                log(LOG_LEVELS.ERROR, "Amount is less than gas fee", { isBot: true });
                return false;
            }
        } else {
            const tokenPublicKey = new PublicKey(tokenAddress);
            const tokenAccount = await getAssociatedTokenAddress(tokenPublicKey, wallet.publicKey);
            const tokenBalance = await connection.getTokenAccountBalance(tokenAccount);
            amount = Math.floor(tokenBalance.value.uiAmount * (percentage / 100) * Math.pow(10, tokenBalance.value.decimals));
            inputMint = tokenAddress;
            outputMint = solAddress;
        }

        const response = await fetch(`https://quote-api.jup.ag/v6/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=${slippage * 100}`);
        if (!response.ok) {
            throw new Error(`HTTP quote error! status: ${response.statusText}`);
        }
        const routes = await response.json();

        const transaction_response = await fetch('https://quote-api.jup.ag/v6/swap', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                quoteResponse: routes,
                userPublicKey: wallet.publicKey.toString(),
                wrapUnwrapSOL: true,
            })
        });
        if (!transaction_response.ok) {
            throw new Error(`HTTP error! status: ${transaction_response.status}`);
        }
        const { swapTransaction } = await transaction_response.json();

        const swapTransactionBuf = Buffer.from(swapTransaction, 'base64');
        const transaction = VersionedTransaction.deserialize(swapTransactionBuf);
        transaction.sign([wallet]);

        const bundle = new Bundle([], 5);
        let maybeBundle = bundle.addTransactions(transaction);
        if (isError(maybeBundle)) {
            throw maybeBundle;
        }

        const tipAccounts = await searcherClient.getTipAccounts();
        const tipAccount = new PublicKey(tipAccounts[0]);
        const { blockhash } = await connection.getLatestBlockhash();
        maybeBundle = maybeBundle.addTipTx(wallet, 100_000, tipAccount, blockhash);
        if (isError(maybeBundle)) {
            throw maybeBundle;
        }

        log(LOG_LEVELS.INFO, 'Sending bundle...', { isBot: true });
        const bundleUuid = await searcherClient.sendBundle(maybeBundle);
        log(LOG_LEVELS.INFO, 'Bundle sent successfully', { bundleUuid, isBot: true });
        log(LOG_LEVELS.INFO, `${isBuy ? 'Buy' : 'Sell'} order completed successfully`, { isBot: true });
        return true;
    } catch (error) {
        log(LOG_LEVELS.ERROR, 'Error in tradeTokenWithJupiter', { error, isBot: true });
        return false;
    }
}

export { tradeTokenWithJupiter, checkBalanceAndTransferSurplus };