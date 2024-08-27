import axios from 'axios';
import { Connection, PublicKey } from '@solana/web3.js';
import { log, LOG_LEVELS } from '../utils/logger.js';

const connection = new Connection('https://api.mainnet-beta.solana.com');

async function getTokenInfo(mint, fetchJup) {
    try {
        const mintAccountInfo = await connection.getParsedAccountInfo(new PublicKey(mint));
        const freezeAuthority = mintAccountInfo.value?.data?.parsed?.info?.freezeAuthority || null;

        let tokenInfo = {
            price: null,
            isFreezable: freezeAuthority !== null,
        };

        if (fetchJup) {
            const jupiterApiUrl = `https://price.jup.ag/v6/price?ids=${mint}&vsToken=SOL`;

            // Fetch price from Jupiter API
            const fetchFromJupiter = async () => {
                const response = await axios.get(jupiterApiUrl);
                if (response.data && response.data.data && response.data.data[mint]) {
                    return {
                        price: response.data.data[mint].price,
                    };
                }
                throw new Error("Jupiter API failed to return a valid price.");
            };

            try {
                const jupiterResult = await fetchFromJupiter();
                tokenInfo.price = jupiterResult.price;
            } catch (error) {
                log(LOG_LEVELS.ERROR, 'Error fetching price from Jupiter API', { error });
            }
        }

        return tokenInfo;
    } catch (error) {
        log(LOG_LEVELS.ERROR, 'Error fetching token info', { error });
        return null;
    }
}

export {
    getTokenInfo,
};
