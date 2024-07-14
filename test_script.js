import { Connection, Keypair, VersionedTransaction } from '@solana/web3.js';
import fetch from 'cross-fetch';
import { Wallet } from '@project-serum/anchor';
import dotenv from 'dotenv';
import bs58 from 'bs58';

dotenv.config();

const connection = new Connection('https://mainnet.helius-rpc.com/?api-key=');

const privateKey = process.env.PRIVATE_KEY;
if (!privateKey) {
    throw new Error('PRIVATE_KEY environment variable is not set.');
}

const wallet = new Wallet(Keypair.fromSecretKey(bs58.decode(privateKey)));

const quoteResponse = await (
  await fetch('https://quote-api.jup.ag/v6/quote?inputMint=So11111111111111111111111111111111111111112&outputMint=&amount=1000000&slippageBps=500'
  )
).json();
console.log({ quoteResponse })   

const recentBlockhash = (await connection.getLatestBlockhash('finalized')).blockhash;

const { swapTransaction } = await (
  await fetch('https://quote-api.jup.ag/v6/swap', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      quoteResponse,
      userPublicKey: wallet.publicKey.toString(),
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: 'auto',
      recentBlockhash
    })
  })
).json();

const swapTransactionBuf = Buffer.from(swapTransaction, 'base64');
var transaction = VersionedTransaction.deserialize(swapTransactionBuf);
console.log(transaction);

transaction.sign([wallet.payer]);

const rawTransaction = transaction.serialize()
const txid = await connection.sendRawTransaction(rawTransaction, {
  skipPreflight: true,
  maxRetries: 2
});

const confirmationStrategy = {
  commitment: 'finalized',
  preflightCommitment: 'processed',
  confirmationStatus: 'confirmed'
};

await connection.confirmTransaction(txid, confirmationStrategy, { timeout: 120000 });
console.log(`https://solscan.io/tx/${txid}`);
