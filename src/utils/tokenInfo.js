import axios from 'axios';
import { Connection, PublicKey } from '@solana/web3.js';
import { log, LOG_LEVELS } from '../utils/logger.js';

const connection = new Connection('https://api.mainnet-beta.solana.com');

async function getTokenInfo(mint, freezeFlag) {
    try {
        const jupiterApiUrl = `https://price.jup.ag/v6/price?ids=${mint}&vsToken=SOL`;

        // Fetch price from Jupiter API
        const fetchFromJupiter = async () => {
            const response = await axios.get(jupiterApiUrl);
            if (response.data && response.data.data && response.data.data[mint]) {
                return {
                    price: response.data.data[mint].price,
                    source: "jupiter",
                };
            }
            throw new Error("Jupiter API failed to return a valid price.");
        };

        // Use Promise.race to get the fastest response
        if (!freezeFlag) {
            fetchFromJupiter()
        }

        // Fetch mint account information to check if the token is freezable
        const mintAccountInfo = await connection.getParsedAccountInfo(new PublicKey(mint));
        const freezeAuthority = mintAccountInfo.value.data.parsed.info.freezeAuthority;

        return {
            price: tokenInfo.price,
            isFreezable: freezeAuthority !== null,
        };
    } catch (error) {
        log(LOG_LEVELS.ERROR, 'Error fetching token info', { error });
    }
    return null;
}

export {
    getTokenInfo,
};