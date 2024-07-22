import express from 'express';
import bodyParser from 'body-parser';
import { log, LOG_LEVELS } from '../utils/logger.js';
import { getTokenInfo } from '../utils/tokenInfo.js';
import { tradeTokenWithJupiter } from './jupiterApi.js';
import dotenv from 'dotenv';
import { setTimeout } from 'timers/promises';

dotenv.config();

const app = express();
app.use(bodyParser.json());

const SELLER = process.env.SELLER;
const DISTRIB = process.env.DISTRIB;


let currentTokenState = {
    NEW_TOKEN_ADDRESS: null,
    SELLER_TRANSFERED: false,
    TOKEN_BOUGHT: false,
    SELLER_RECEIVE_COUNT: 0,
    SOLD: false,
    DISTRIBUTING: false
};

async function buyWaitAndSell(tokenAddress) {
    try {
        // Buy
        log(LOG_LEVELS.INFO, `Initiating buy for ${tokenAddress}`, {
            isBot: true,
        });
        const buySuccess = await tradeTokenWithJupiter(tokenAddress, 50, true, 25);
        if (!buySuccess) {
            log(LOG_LEVELS.ERROR, `Buy transaction failed for ${tokenAddress}`, {
            isBot: true,
            });
            return;
        }
        log(LOG_LEVELS.INFO, `Buy successful for ${tokenAddress}`, {
            isBot: true,
        });

        // Wait
        log(LOG_LEVELS.INFO, `Waiting 22 seconds before selling ${tokenAddress}`, {
            isBot: true,
        });
        await new Promise(resolve => setTimeout(resolve, 22000));

        // Sell
        log(LOG_LEVELS.INFO, `Initiating sell for ${tokenAddress}`, {
            isBot: true,
        });
        const sellSuccess = await tradeTokenWithJupiter(tokenAddress, 100, false, 20);
        if (!sellSuccess) {
            log(LOG_LEVELS.ERROR, `Sell transaction failed for ${tokenAddress}`, {
            isBot: true,
            });
            return;
        }
        log(LOG_LEVELS.INFO, `Sell successful for ${tokenAddress}`, {
            isBot: true,
        });
    } catch (error) {
        log(LOG_LEVELS.ERROR, `Error in buyWaitAndSell: ${error.message}`, {
            isBot: true,
        });
    }
}


app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

app.post('/webhook', async (req, res) => {
    const event = req.body;

    try {
        log(LOG_LEVELS.INFO, `Received webhook event: ${JSON.stringify(event)}`, {
            sendToDiscord: false,
        });
        if (event[0].type === 'SWAP') {
            const swapEvent = event[0].events.swap;
            const isBuy = swapEvent.nativeInput !== null;
            const inputMint = isBuy ? 'So11111111111111111111111111111111111111112' : swapEvent.tokenInputs[0].mint;
            const outputMint = isBuy ? swapEvent.tokenOutputs[0].mint : 'So11111111111111111111111111111111111111112';

            log(LOG_LEVELS.INFO, `${event[0].description}`, {
                inputMint: inputMint,
                outputMint: outputMint,
                signature: event[0].signature
            });

            // Check for new token detection (SOL amount between 149.5 and 150.5)
            const solAmount = isBuy ? swapEvent.nativeInput.amount : swapEvent.nativeOutput.amount;
            if (solAmount >= 149.5 * 1e9 && solAmount <= 150.5 * 1e9 && event[0].tokenTransfers[0].fromUserAccount === SELLER) {
                currentTokenState.NEW_TOKEN_ADDRESS = isBuy ? swapEvent.tokenOutputs[0].mint : swapEvent.tokenInputs[0].mint;
                log(LOG_LEVELS.INFO, `New token detected: ${currentTokenState.NEW_TOKEN_ADDRESS}`, {
                    isBot: true
                });

                const tokenInfo = await getTokenInfo(currentTokenState.NEW_TOKEN_ADDRESS);
                if (tokenInfo && tokenInfo.isFreezable) {
                    log(LOG_LEVELS.WARN, `Token ${currentTokenState.NEW_TOKEN_ADDRESS} is freezable. Aborting buy`, {
                        isBot: true
                    });
                    currentTokenState.NEW_TOKEN_ADDRESS = null;
                    return res.status(200).send('Token is freezable. Aborting buy');
                }
                buyWaitAndSell(currentTokenState.NEW_TOKEN_ADDRESS);
            }
        } else if (event[0].type === 'TRANSFER' &&
            event[0].nativeTransfers &&
            event[0].nativeTransfers.length == 1 &&
            event[0].tokenTransfers.length == 0) {
            if (event[0].nativeTransfers[0].amount >= 1000000) {
                log(LOG_LEVELS.INFO, `${event[0].description}`, {
                    inputMint: "So11111111111111111111111111111111111111112",
                    signature: event[0].signature
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
                    signature: event[0].signature
                });
            } else {
                log(LOG_LEVELS.INFO, `${event[0].description}`, {
                    signature: event[0].signature
                });
            }
        } else {
            log(LOG_LEVELS.INFO, `Description: ${event[0].description}`, {
                    signature: event[0].signature
            });
        }

        for (let key in currentTokenState) {
            if (currentTokenState.hasOwnProperty(key)) {
                log(LOG_LEVELS.INFO, `${key}: ${currentTokenState[key]}`, {
                    sendToDiscord: false,
                });
            }
        }
        // Detect transfer of NEW_TOKEN_ADDRESS from SELLER to DISTRIB
        if (currentTokenState.NEW_TOKEN_ADDRESS &&
            event[0].type === 'TRANSFER' &&
            event[0].tokenTransfers.length > 0 &&
            event[0].tokenTransfers[0].fromUserAccount === SELLER &&
            event[0].tokenTransfers[0].toUserAccount === DISTRIB &&
            event[0].tokenTransfers[0].mint === currentTokenState.NEW_TOKEN_ADDRESS) {

            log(LOG_LEVELS.INFO, 'SELLER transferred the new token to DISTRIB'), {
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
                    if (transfer.fromUserAccount === DISTRIB &&
                        transfer.toUserAccount === SELLER &&
                        transfer.mint === currentTokenState.NEW_TOKEN_ADDRESS &&
                        !currentTokenState.DISTRIBUTING) {

                        log(LOG_LEVELS.INFO, 'DISTRIB distributed to SELLER. Initiating buy.', {
                            isBot: true,
                        });
                        currentTokenState.DISTRIBUTING = true;
                        const buySuccess = await tradeTokenWithJupiter(currentTokenState.NEW_TOKEN_ADDRESS, 80, true, 10);
                        if (buySuccess) {
                            currentTokenState.TOKEN_BOUGHT = true;
                        }
                        break; // Exit the loop once we've found the transfer we're looking for
                    }
                }
            }
        }

        // Detect transfer of current token to SELLER
        if (currentTokenState.NEW_TOKEN_ADDRESS && currentTokenState.TOKEN_BOUGHT && !currentTokenState.SOLD &&
            event[0].type === 'TRANSFER' &&
            event[0].tokenTransfers[0].toUserAccount === SELLER &&
            event[0].tokenTransfers[0].mint === currentTokenState.NEW_TOKEN_ADDRESS) {

            currentTokenState.SELLER_RECEIVE_COUNT++;
            log(LOG_LEVELS.INFO, `SELLER received the new token. Count: ${currentTokenState.SELLER_RECEIVE_COUNT}`, {
                isBot: true,
            });

            if (currentTokenState.SELLER_RECEIVE_COUNT === 2) {
                log(LOG_LEVELS.INFO, `SELLER received the new token twice. Initiating sell`, {
                    isBot: true,
                });
                const sellSuccess = await tradeTokenWithJupiter(currentTokenState.NEW_TOKEN_ADDRESS, 100, false, 20);
                if (sellSuccess) {
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