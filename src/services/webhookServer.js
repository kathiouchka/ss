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

let NEW_TOKEN_ADDRESS = null;
let SELLER_TRANSFERED = false;
let TOKEN_BOUGHT = false;

async function buyWaitAndSell(tokenAddress) {
    try {
        // Buy
        log(LOG_LEVELS.INFO, `Initiating buy for ${tokenAddress}`, true, true);
        const buySuccess = await tradeTokenWithJupiter(tokenAddress, 20, true);
        if (!buySuccess) {
            log(LOG_LEVELS.ERROR, `Buy transaction failed for ${tokenAddress}`, true, true);
            return;
        }
        log(LOG_LEVELS.INFO, `Buy successful for ${tokenAddress}`, true, true);

        // Wait
        log(LOG_LEVELS.INFO, `Waiting 20 seconds before selling ${tokenAddress}`, true, true);
        await setTimeout(20000);

        // Sell
        log(LOG_LEVELS.INFO, `Initiating sell for ${tokenAddress}`, true, true);
        const sellSuccess = await tradeTokenWithJupiter(tokenAddress, 100, false);
        if (!sellSuccess) {
            log(LOG_LEVELS.ERROR, `Sell transaction failed for ${tokenAddress}`, true, true);
            return;
        }
        log(LOG_LEVELS.INFO, `Sell successful for ${tokenAddress}`, true, true);
    } catch (error) {
        log(LOG_LEVELS.ERROR, `Error in buyWaitAndSell: ${error.message}`, true, true);
    }
}


app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

app.post('/webhook', async (req, res) => {
    const event = req.body;

    try {
        log(LOG_LEVELS.INFO, `Received webhook event: ${JSON.stringify(event)}`);
        if (event[0].type === 'SWAP') {
            const swapEvent = event[0].events.swap;
            const isBuy = swapEvent.nativeInput !== null;
            const inputMint = isBuy ? 'So11111111111111111111111111111111111111112' : swapEvent.tokenInputs[0].mint;
            const outputMint = isBuy ? swapEvent.tokenOutputs[0].mint : 'So11111111111111111111111111111111111111112';
    
            log(LOG_LEVELS.INFO, `${event[0].description}`, true, true, inputMint, outputMint);
    
            // Check for new token detection (SOL amount between 149.5 and 150.5)
            const solAmount = isBuy ? swapEvent.nativeInput.amount : swapEvent.nativeOutput.amount;
            if (solAmount >= 149.5 * 1e9 && solAmount <= 150.5 * 1e9) {
                NEW_TOKEN_ADDRESS = isBuy ? swapEvent.tokenOutputs[0].mint : swapEvent.tokenInputs[0].mint;
                log(LOG_LEVELS.INFO, `New token detected: ${NEW_TOKEN_ADDRESS}`, true, true);
    
                const tokenInfo = await getTokenInfo(NEW_TOKEN_ADDRESS);
                if (tokenInfo && tokenInfo.isFreezable) {
                    log(LOG_LEVELS.WARN, `Token ${NEW_TOKEN_ADDRESS} is freezable. Aborting buy`, true, true);
                    NEW_TOKEN_ADDRESS = null;
                    return res.status(200).send('Token is freezable. Aborting buy');
                }
                buyWaitAndSell(NEW_TOKEN_ADDRESS);
            }
        } else if (event[0].type === 'TRANSFER') {
            log(LOG_LEVELS.INFO, `Description: ${event[0].description}`, true, true, event[0].tokenTransfers[0].mint);
        } else {
            log(LOG_LEVELS.INFO, `Description: ${event[0].description}`, true, true);
        }

        // Detect transfer of NEW_TOKEN_ADDRESS from SELLER to DISTRIB
        if (NEW_TOKEN_ADDRESS &&
            event[0].type === 'TRANSFER' &&
            event[0].tokenTransfers[0].fromUserAccount === SELLER &&
            event[0].tokenTransfers[0].toUserAccount === DISTRIB &&
            event[0].tokenTransfers[0].mint === NEW_TOKEN_ADDRESS) {

            log(LOG_LEVELS.INFO, 'SELLER transferred the new token to DISTRIB');
            SELLER_TRANSFERED = true;
        }

        // Detect transfer of NEW_TOKEN_ADDRESS from DISTRIB
        if (NEW_TOKEN_ADDRESS && SELLER_TRANSFERED &&
            event[0].type === 'TRANSFER' &&
            event[0].tokenTransfers[0].fromUserAccount === DISTRIB &&
            event[0].tokenTransfers[0].mint === NEW_TOKEN_ADDRESS) {

            log(LOG_LEVELS.INFO, 'DISTRIB distributed. Initiating buy.', true, true);
            await tradeTokenWithJupiter(NEW_TOKEN_ADDRESS, 70, true);
            TOKEN_BOUGHT = true;
        }

        // Detect transfer of NEW_TOKEN_ADDRESS to SELLER
        if (NEW_TOKEN_ADDRESS && TOKEN_BOUGHT &&
            event[0].type === 'TRANSFER' &&
            event[0].tokenTransfers[0].toUserAccount === SELLER &&
            event[0].tokenTransfers[0].mint === NEW_TOKEN_ADDRESS) {
            log(LOG_LEVELS.INFO, `SELLER received the new token. Initiating sell`, true, true);
            await tradeTokenWithJupiter(NEW_TOKEN_ADDRESS, 100, false);
        }

        res.status(200).send('Event processed successfully');
    } catch (error) {
        log(LOG_LEVELS.ERROR, `Error processing event: ${error.message}`, true, true);
        res.status(500).send('Error processing event');
    }
});



const PORT = 3000;

function startWebhookServer() {
    return new Promise((resolve, reject) => {
        app.listen(PORT, () => {
            log(LOG_LEVELS.INFO, `Webhook server listening on port ${PORT}`, true, true);
            resolve();
        }).on('error', (error) => {
            reject(error);
        });
    });
}

export { startWebhookServer };