import axios from 'axios';
import { Connection, PublicKey } from '@solana/web3.js';
import { logDetailedInfo } from '../utils/logger.js';

const connection = new Connection('https://api.mainnet-beta.solana.com');

async function getTokenInfo(mint) {
    try {
        // Fetch token price information
        const response = await axios.get(`https://price.jup.ag/v6/price?ids=${mint}&vsToken=SOL`);
        let tokenInfo = null;
        if (response.data && response.data.data && response.data.data[mint]) {
            tokenInfo = response.data.data[mint];
        }

        // Fetch mint account information to check if the token is freezable
        const mintAccountInfo = await connection.getParsedAccountInfo(new PublicKey(mint));
        const freezeAuthority = mintAccountInfo.value.data.parsed.info.freezeAuthority;

        return {
            ...tokenInfo,
            isFreezable: freezeAuthority !== null,
        };
    } catch (error) {
        console.error('Error fetching token info:', error);
    }
    return null;
}

async function extractDetailedInformation(signature) {
    const apiKey = process.env.API_KEY;
    const url = `https://api.helius.xyz/v0/transactions/?api-key=${apiKey}`;

    try {
        const response = await axios.post(url, {
            transactions: [signature]
        });

        logDetailedInfo({ fullResponseData: response.data });

        if (response.data && response.data.length > 0) {
            const txInfo = response.data[0];
            logDetailedInfo(txInfo);
            return {
                timestamp: new Date(txInfo.timestamp * 1000).toISOString(),
                signature: txInfo.signature,
                type: txInfo.type,
                fee: txInfo.fee,
                slot: txInfo.slot,
                accountKeys: txInfo.accountKeys,
                instructions: txInfo.instructions.map(inst => ({
                    programId: inst.programId,
                    data: inst.data,
                    accounts: inst.accounts
                })),
                tokenTransfers: txInfo.tokenTransfers,
                nativeTransfers: txInfo.nativeTransfers,
                events: txInfo.events
            };
        } else {
            console.log('No transaction data received');
        }
    } catch (error) {
        console.error('Error fetching transaction details:', error);
        console.error('Full error object:', JSON.stringify(error, null, 2));
    }

    return null;
}

export {
    getTokenInfo,
    extractDetailedInformation
};