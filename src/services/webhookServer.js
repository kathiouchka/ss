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
            const isBuy = event[0].events.swap.nativeInput !== null;
            const inputToken = isBuy ? 'SOL' : event[0].events.swap.tokenInputs[0].symbol;
            const outputToken = isBuy ? event[0].events.swap.tokenOutputs[0].symbol : 'SOL';
            const inputAmount = isBuy ? event[0].events.swap.nativeInput.amount / 1e9 : event[0].events.swap.tokenInputs[0].amount;
            const outputAmount = isBuy ? event[0].events.swap.tokenOutputs[0].amount : event[0].events.swap.nativeOutput.amount / 1e9;
            const inputMint = isBuy ? 'So11111111111111111111111111111111111111112' : event[0].events.swap.tokenInputs[0].mint;
            const outputMint = isBuy ? event[0].events.swap.tokenOutputs[0].mint : 'So11111111111111111111111111111111111111112';

            const description = `${event[0].accountData[0].account} swapped ${inputAmount} [${inputToken}](https://solscan.io/token/${inputMint}) for ${outputAmount} [${outputToken}](https://solscan.io/token/${outputMint})`;
            log(LOG_LEVELS.INFO, `Description: ${description}`, true, true);

            // Check for new token detection (SOL amount between 149.5 and 150.5)
            const solAmount = isBuy ? event[0].events.swap.nativeInput.amount : event[0].events.swap.nativeOutput.amount;
            if (solAmount >= 149.5 * 1e9 && solAmount <= 150.5 * 1e9) {
                NEW_TOKEN_ADDRESS = isBuy ? event[0].events.swap.tokenOutputs[0].mint : event[0].events.swap.tokenInputs[0].mint;
                log(LOG_LEVELS.INFO, `New token detected: ${NEW_TOKEN_ADDRESS}`, true, true);
                
                const tokenInfo = await getTokenInfo(NEW_TOKEN_ADDRESS);
                if (tokenInfo && tokenInfo.isFreezable) {
                    log(LOG_LEVELS.WARN, `Token ${NEW_TOKEN_ADDRESS} is freezable. Aborting buy`, true, true);
                    NEW_TOKEN_ADDRESS = null;
                    return;
                }
                buyWaitAndSell(NEW_TOKEN_ADDRESS);
            }
        } else {
            log(LOG_LEVELS.INFO, `Description: ${event[0].description}`, true, true);
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
            log(LOG_LEVELS.INFO, `Webhook server listening on port ${PORT}`, true, true);
            resolve();
        }).on('error', (error) => {
            reject(error);
        });
    });
}

export { startWebhookServer };