import express from 'express';
import bodyParser from 'body-parser';
import { log, LOG_LEVELS } from '../utils/logger.js';
import { getTokenInfo } from '../utils/tokenInfo.js';
import { tradeTokenWithJupiter, checkBalanceAndTransferSurplus } from './jupiterApi.js';
import dotenv from 'dotenv';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';

dotenv.config();

const app = express();
app.use(bodyParser.json());

const SELLER = process.env.SELLER;
const DISTRIB = process.env.DISTRIB;
const MASTER = process.env.MASTER_WALLET;


let currentTokenState = {
    NEW_TOKEN_ADDRESS: null,
    SELLER_TRANSFERED: false,
    TOKEN_BOUGHT: false,
    SELLER_RECEIVE_COUNT: 0,
    SOLD: false,
    DISTRIBUTING: false
};

let transactions = {};

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
            totalBuySOL += t.solAmount;
            totalBuyTokens += t.tokenAmount;
        } else if (t.type === 'sell') {
            totalSellSOL += t.solAmount;
            totalSellTokens += t.tokenAmount;
        }
    });

    const pnlSOL = Number((totalSellSOL - totalBuySOL).toFixed(4));
    const pnlPercentage = Number(((totalSellSOL / totalBuySOL - 1) * 100).toFixed(2));

    const pnlMessage = `PnL for ${tokenAddress}:\n` +
        `Total bought: ${totalBuyTokens} ${tokenAddress} for ${totalBuySOL.toFixed(4)} SOL\n` +
        `Total sold: ${totalSellTokens} ${tokenAddress} for ${totalSellSOL.toFixed(4)} SOL\n` +
        `PnL: ${pnlSOL.toFixed(4)} SOL (${pnlPercentage.toFixed(2)}%)`;
    const color = pnlSOL > 0 ? 'GREEN' : pnlSOL < 0 ? 'RED' : 'CYAN';
    log(LOG_LEVELS.INFO, pnlMessage, { isBot: true, color: color });
}

function recordTransaction(type, tokenAddress, tokenAmount, solAmount) {
    if (!transactions[tokenAddress]) {
        transactions[tokenAddress] = [];
    }
    transactions[tokenAddress].push({ type, tokenAmount, solAmount, timestamp: Date.now() });
}

app.post('/webhook', async (req, res) => {
    const event = req.body;

    try {
        log(LOG_LEVELS.INFO, `Received webhook event: ${JSON.stringify(event)}`, {
            sendToDiscord: false,
        });
        const rugPullRegex = new RegExp(`${process.env.MASTER_WALLET} transferred a total 450\\.\\d+ SOL to multiple accounts\\.`);
        if (event[0].type === 'SWAP') {
            const swapEvent = event[0].events.swap;
            const isBuy = swapEvent.nativeInput !== null;
            const inputMint = isBuy ? 'So11111111111111111111111111111111111111112' : swapEvent.tokenInputs[0].mint;
            const outputMint = isBuy ? swapEvent.tokenOutputs[0].mint : 'So11111111111111111111111111111111111111112';

            log(LOG_LEVELS.INFO, `${event[0].description}`, {
                inputMint: inputMint,
                outputMint: outputMint,
                signature: event[0].signature,
                color: isBuy ? 'GREEN' : 'RED'  // Color SWAP transactions GREEN for buys, RED for sells
            });

            // Check for new token detection (SOL amount between 149.5 and 150.5)
            const solAmount = isBuy ? swapEvent.nativeInput.amount : swapEvent.nativeOutput.amount;
            if (event[0].tokenTransfers[0].fromUserAccount === process.env.BOT_WALLET) {
                // Record the transaction for PnL calculation
                const amount = isBuy ? swapEvent.nativeInput.amount : swapEvent.nativeOutput.amount;
                const mint = isBuy ? swapEvent.tokenOutputs[0].mint : swapEvent.tokenInputs[0].mint;
                const type = isBuy ? 'buy' : 'sell';
                const tokenInfo = isBuy ? swapEvent.tokenOutputs[0].rawTokenAmount : swapEvent.tokenInputs[0].rawTokenAmount;
                const tokenAmount = parseFloat(tokenInfo.tokenAmount) / Math.pow(10, tokenInfo.decimals);
                    log(LOG_LEVELS.INFO, `TOKEN AMOUNT = ${tokenAmount}`, {
                        isBot: true
                    });
                recordTransaction(type, mint, tokenAmount, amount / LAMPORTS_PER_SOL);
                
                if (isBuy) {
                    currentTokenState.TOKEN_BOUGHT = true;
                    log(LOG_LEVELS.INFO, `Bot wallet bought the token. TOKEN_BOUGHT set to true.`, {
                        isBot: true
                    });
                } else {
                    currentTokenState.SOLD = true;
                    calculatePnL(mint);
                    await checkBalanceAndTransferSurplus();
                }
            }
            if (solAmount >= 149.5 * 1e9 && solAmount <= 150.5 * 1e9 && event[0].tokenTransfers[0].fromUserAccount === SELLER) {
                currentTokenState.NEW_TOKEN_ADDRESS = isBuy ? swapEvent.tokenOutputs[0].mint : swapEvent.tokenInputs[0].mint;
                log(LOG_LEVELS.INFO, `Reset of the variables : new token detected: ${currentTokenState.NEW_TOKEN_ADDRESS}`, {
                    isBot: true
                });
                log(LOG_LEVELS.INFO, `${currentTokenState.NEW_TOKEN_ADDRESS}`, {
                    isThird: true,
                });

                const tokenInfo = await getTokenInfo(currentTokenState.NEW_TOKEN_ADDRESS);
                if (tokenInfo && tokenInfo.isFreezable) {
                    log(LOG_LEVELS.WARN, `Token ${currentTokenState.NEW_TOKEN_ADDRESS} is freezable. Aborting buy`, {
                        isBot: true
                    });
                    currentTokenState.NEW_TOKEN_ADDRESS = null;
                    return res.status(200).send('Token is freezable. Aborting buy');
                }
                currentTokenState = {
                    NEW_TOKEN_ADDRESS: currentTokenState.NEW_TOKEN_ADDRESS,
                    SELLER_TRANSFERED: false,
                    TOKEN_BOUGHT: false,
                    SELLER_RECEIVE_COUNT: 0,
                    SOLD: false,
                    DISTRIBUTING: false
                };
            }
        } else if (event[0].type === 'TRANSFER' &&
            event[0].nativeTransfers &&
            event[0].nativeTransfers.length == 1 &&
            event[0].tokenTransfers.length == 0) {
            if (event[0].nativeTransfers[0].amount >= 1000000) {
                log(LOG_LEVELS.INFO, `${event[0].description}`, {
                    inputMint: "So11111111111111111111111111111111111111112",
                    signature: event[0].signature,
                    color: 'PURPLE'
                });
            } else {
                log(LOG_LEVELS.INFO, `${event[0].description}`, {
                    sendToDiscord: false,
                    inputMint: "So11111111111111111111111111111111111111112",
                    signature: event[0].signature
                });
            }
        } else if (event[0].type === 'TRANSFER') {
            if (event[0].tokenTransfers.length > 0 && event[0].tokenTransfers[0].mint != null) {
                log(LOG_LEVELS.INFO, `${event[0].description}`, {
                    inputMint: event[0].tokenTransfers[0].mint,
                    signature: event[0].signature,
                    color: 'PURPLE'
                });
            } else if (rugPullRegex.test(event[0].description)) {
                if (currentTokenState.NEW_TOKEN_ADDRESS !== null && currentTokenState.TOKEN_BOUGHT) {
                    // Record a transaction of 0 SOL
                    await recordTransaction(currentTokenState.NEW_TOKEN_ADDRESS, 0, 0);

                    log(LOG_LEVELS.WARN, `Potential rug pull detected for token ${currentTokenState.NEW_TOKEN_ADDRESS}. Recorded 0 SOL transaction for PnL calculation.`, { isBot: true });

                    // Attempt to sell any remaining tokens
                    const sellSuccess = await tradeTokenWithJupiter(currentTokenState.NEW_TOKEN_ADDRESS, 100, false);

                    if (sellSuccess) {
                        log(LOG_LEVELS.INFO, `Successfully sold remaining tokens for ${currentTokenState.NEW_TOKEN_ADDRESS}`, { isBot: true });
                    } else {
                        log(LOG_LEVELS.ERROR, `Failed to sell remaining tokens for ${currentTokenState.NEW_TOKEN_ADDRESS}`, { isBot: true });
                    }

                    // Reset the currentTokenState
                    currentTokenState.NEW_TOKEN_ADDRESS = null;
                    currentTokenState.TOKEN_BOUGHT = null;

                }
                log(LOG_LEVELS.INFO, `${event[0].description}`, {
                    signature: event[0].signature,
                    color: 'PURPLE'
                });
            } else {
                log(LOG_LEVELS.INFO, `${event[0].description}`, {
                    signature: event[0].signature,
                    color: 'PURPLE'
                });
            }
        } else {
            log(LOG_LEVELS.INFO, `Description: ${event[0].description}`, {
                signature: event[0].signature,
                color: 'CYAN'
            });
        }

        for (let key in currentTokenState) {
            if (currentTokenState.hasOwnProperty(key)) {
                log(LOG_LEVELS.INFO, `${key}: ${currentTokenState[key]}`, {
                    sendToDiscord: false,
                });
            }
        }
        // Detect transfer of NEW_TOKEN_ADDRESS from SELLER to MASTER
        if (currentTokenState.NEW_TOKEN_ADDRESS &&
            event[0].type === 'TRANSFER' &&
            event[0].tokenTransfers.length > 0 &&
            event[0].tokenTransfers[0].fromUserAccount === SELLER &&
            event[0].tokenTransfers[0].toUserAccount === MASTER &&
            event[0].tokenTransfers[0].mint === currentTokenState.NEW_TOKEN_ADDRESS) {

            log(LOG_LEVELS.INFO, 'SELLER transferred the new token to MASTER'), {
                isBot: true,
            };
            currentTokenState.SELLER_TRANSFERED = true;
        }

        // Detect transfer of NEW_TOKEN_ADDRESS from DISTRIB
        if (currentTokenState.NEW_TOKEN_ADDRESS && currentTokenState.SELLER_TRANSFERED &&
            event[0].type === 'TRANSFER') {
            // Loop through all tokenTransfers
            if (event[0].tokenTransfers.length > 0) {
                for (let transfer of event[0].tokenTransfers) {
                    if (transfer.fromUserAccount === MASTER &&
                        transfer.toUserAccount === DISTRIB &&
                        transfer.mint === currentTokenState.NEW_TOKEN_ADDRESS &&
                        !currentTokenState.DISTRIBUTING) {

                        log(LOG_LEVELS.INFO, 'DISTRIB distributed to SELLER. Waiting before initiating buy.', {
                            isBot: true,
                        });
                        currentTokenState.DISTRIBUTING = true;

                        // Generate a random delay between 5 and 15 seconds
                        const delay = Math.floor(Math.random() * (15 - 5 + 1) + 5) * 1000;

                        setTimeout(async () => {
                            log(LOG_LEVELS.INFO, `Waited ${delay / 1000} seconds. Initiating buy.`, {
                                isBot: true,
                            });
                            await tradeTokenWithJupiter(currentTokenState.NEW_TOKEN_ADDRESS, 45, true, 10);
                            currentTokenState.TOKEN_BOUGHT = true;
                        }, delay);

                        break; // Exit the loop once we've found the transfer we're looking for
                    }
                }
            }
        }

        // Detect transfer of current token to SELLER
        if (currentTokenState.NEW_TOKEN_ADDRESS && currentTokenState.TOKEN_BOUGHT && !currentTokenState.SOLD &&
            event[0].type === 'TRANSFER' &&
            event[0].tokenTransfers.length > 0 &&
            event[0].tokenTransfers[0].toUserAccount === SELLER &&
            event[0].tokenTransfers[0].mint === currentTokenState.NEW_TOKEN_ADDRESS) {

            currentTokenState.SELLER_RECEIVE_COUNT++;

            if (currentTokenState.SELLER_RECEIVE_COUNT <= 2) {
                log(LOG_LEVELS.INFO, `SELLER received the new token. Count: ${currentTokenState.SELLER_RECEIVE_COUNT}`, {
                    isBot: true,
                });
            }

            if (currentTokenState.SELLER_RECEIVE_COUNT === 2) {
                log(LOG_LEVELS.INFO, `SELLER received the new token twice. Initiating sell`, {
                    isBot: true,
                });
                await tradeTokenWithJupiter(currentTokenState.NEW_TOKEN_ADDRESS, 100, false, 20);

                currentTokenState.SOLD = true;
                // Reset the state for the next token
                currentTokenState = {
                    NEW_TOKEN_ADDRESS: null,
                    SELLER_TRANSFERED: false,
                    TOKEN_BOUGHT: false,
                    SELLER_RECEIVE_COUNT: 0,
                    SOLD: false,
                    DISTRIBUTING: false
                };

            }
        }

        res.status(200).send('Event processed successfully');
    } catch (error) {
        log(LOG_LEVELS.ERROR, `Error processing event: ${error.message}`);
        res.status(500).send('Error processing event');
    }
});



const PORT = 3000;

function startWebhookServer() {
    return new Promise((resolve, reject) => {
        app.listen(PORT, () => {
            resolve();
        }).on('error', (error) => {
            reject(error);
        });
    });
}

export { startWebhookServer };