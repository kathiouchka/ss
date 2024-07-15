const { Connection, Keypair, VersionedTransaction, PublicKey, Transaction, sendAndConfirmRawTransaction, sendAndConfirmTransaction, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const fetch = require('cross-fetch');
const { Wallet } = require('@project-serum/anchor');
const bs58 = require('bs58');
const dotenv = require('dotenv');

dotenv.config();

import fetch from "node-fetch";
import bs58 from 'bs58';
import dotenv from 'dotenv';
import { Wallet } from '@project-serum/anchor';

dotenv.config();
//For test, my wallet:        
//For test, use DLM token:    
const solAddress = "So11111111111111111111111111111111111111112";
// Solana gas fee
const SOLANA_GAS_FEE_PRICE = 0.000005 * LAMPORTS_PER_SOL;  //Solana accounts require a minimum amount of SOL in order to exists on the blockchain, this is called rent-exempt account.
let slipTarget = 5;

const privateKey = process.env.PRIVATE_KEY;
if (!privateKey) {
    throw new Error('PRIVATE_KEY environment variable is not set.');
}

const RPC_ENDPOINT = `https://mainnet.helius-rpc.com/?api-key=${process.env.API_KEY}`;


const connection = new Connection(RPC_ENDPOINT, 'confirmed', {
    commitment: 'confirmed',
    timeout: 10000
});

function sleep(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms * 1000); //s = ms*1000
    })
}

const wallet = new Wallet(Keypair.fromSecretKey(bs58.decode(privateKey)));

async function makeSwap(tokenAddress, amount, type) {
    const rAmount = amount - SOLANA_GAS_FEE_PRICE;
    if (rAmount < 0) {
        console.log("amount is less than gas Fee");
        return;
    }
    console.log("swap amount: ", rAmount/LAMPORTS_PER_SOL);
    console.log("swap type: ", type);
    console.log("swap wallet", wallet.publicKey.toString());

    const fixedSwapValLamports = Math.floor(rAmount);
    const slipBPS = slipTarget * 100;
    let response;
    if (type == "buy") {
        response = await fetch('https://quote-api.jup.ag/v6/quote?inputMint=' + solAddress + '&outputMint=' + tokenAddress + '&amount=' + fixedSwapValLamports + '&onlyDirectRoutes=true');
    } else {
        response = await fetch('https://quote-api.jup.ag/v6/quote?inputMint=' + tokenAddress + '&outputMint=' + solAddress + '&amount=' + fixedSwapValLamports + '&onlyDirectRoutes=true');
    }
    const routes = await response.json();
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
    const transactions = await transaction_response.json();
    const { swapTransaction } = transactions;
    // deserialize the transaction
    const swapTransactionBuf = Buffer.from(swapTransaction, 'base64');
    var transaction = VersionedTransaction.deserialize(swapTransactionBuf);
    // sign the transaction
    transaction.sign([wallet.payer]);
    // Execute the transaction
    const rawTransaction = transaction.serialize()
    const txid = await sendAndConfirmRawTransaction(connection, rawTransaction, null, {
        skipPreflight: true,
        maxRetries: 2
    });
    console.log(type + " Order::" + `https://solscan.io/tx/${txid}`);
    await sleep(1); // 1 second delay to avoid 429 too many requests

}

makeSwap("", 10000000, "buy")