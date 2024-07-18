import express from 'express';
import bodyParser from 'body-parser';
import fs from 'fs';
import { processTransaction } from './services/transactionProcessor.js';
import { walletPool } from '../config.js';


const app = express();
const PORT = 3000;

app.use(bodyParser.json());

app.post('/webhook', async (req, res) => {
    const event = req.body;
    console.log('Received webhook event:', event);
    
    // Convert the event to a JSON string
    const eventStr = JSON.stringify(event, null, 2);
    
    // Write the event to a log file
    fs.appendFile('webhook_log.json', eventStr + '\n', (err) => {
        if (err) {
            console.error('Failed to write event to file:', err);
        } else {
            console.log('Event logged to file');
        }
    });
    
    // Process the transaction
    await processTransaction(event, walletPool);
    
    res.status(200).send('Event received and processed');
});

app.listen(PORT, () => {
    console.log(`Webhook server listening on port ${PORT}`);
});