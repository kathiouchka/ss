import express from 'express';
import bodyParser from 'body-parser';
import { log, LOG_LEVELS } from '../utils/logger.js';
import { getTokenInfo } from '../utils/tokenInfo.js';
import { tradeTokenWithJupiter } from './jupiterApi.js';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(bodyParser.json());

const SELLER = process.env.SELLER;
const DISTRIB = process.env.DISTRIB;

let NEW_TOKEN_ADDRESS = null;
let SELLER_TRANSFERED = false;
let TOKEN_BOUGHT = false;

app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

app.post('/webhook', async (req, res) => {
    const event = req.body;

    try {
        log(LOG_LEVELS.INFO, `Received webhook event: ${JSON.stringify(event)}`);
        log(LOG_LEVELS.INFO, `Description: ${event[0].description}`);

        // Detect SWAP between 149.5 and 150.5 SOL
        if (event[0].type === 'SWAP' &&
            event[0].events.swap.nativeInput &&
            event[0].events.swap.nativeInput.account === SELLER &&
            event[0].events.swap.nativeInput.amount >= 149.5 * 1e9 &&
            event[0].events.swap.nativeInput.amount <= 150.5 * 1e9) {

            NEW_TOKEN_ADDRESS = event[0].events.swap.tokenOutputs[0].mint;
            log(LOG_LEVELS.INFO, `New token detected: ${NEW_TOKEN_ADDRESS}`);
        }

        // Detect transfer of NEW_TOKEN_ADDRESS from SELLER to DISTRIB
        if (NEW_TOKEN_ADDRESS &&
            event[0].type === 'TRANSFER' &&
            event[0].tokenTransfers[0].fromUserAccount === SELLER &&
            event[0].tokenTransfers[0].toUserAccount === DISTRIB &&
            event[0].tokenTransfers[0].mint === NEW_TOKEN_ADDRESS) {

            log(LOG_LEVELS.INFO, 'SELLER transferred the new token to DISTRIB - checking FREEZABLE');
            // Check if the token is freezable
            const tokenInfo = await getTokenInfo(NEW_TOKEN_ADDRESS);
            if (tokenInfo && tokenInfo.isFreezable) {
                log(LOG_LEVELS.WARN, `Token ${NEW_TOKEN_ADDRESS} is freezable. Aborting buy.`);
                return;
            }
            SELLER_TRANSFERED = true;
        }

        if (NEW_TOKEN_ADDRESS && SELLER_TRANSFERED &&
            event[0].type === 'TRANSFER' &&
            event[0].tokenTransfers[0].fromUserAccount === DISTRIB &&
            event[0].tokenTransfers[0].mint === NEW_TOKEN_ADDRESS) {

            log(LOG_LEVELS.INFO, 'DISTRIB distributed. Initiating buy.');
            await tradeTokenWithJupiter(NEW_TOKEN_ADDRESS, 70, true);
            TOKEN_BOUGHT = true;
        }

        // Detect transfer of NEW_TOKEN_ADDRESS to SELLER
        if (NEW_TOKEN_ADDRESS && TOKEN_BOUGHT &&
            event[0].type === 'TRANSFER' &&
            event[0].tokenTransfers[0].toUserAccount === SELLER &&
            event[0].tokenTransfers[0].mint === NEW_TOKEN_ADDRESS) {
            log(LOG_LEVELS.INFO, `SELLER received the new token. Initiating sell`);
            await tradeTokenWithJupiter(NEW_TOKEN_ADDRESS, 100, false);
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
            log(LOG_LEVELS.INFO, `Webhook server listening on port ${PORT}`);
            resolve();
        }).on('error', (error) => {
            reject(error);
        });
    });
}

export { startWebhookServer };