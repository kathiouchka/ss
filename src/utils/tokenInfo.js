import axios from 'axios';
import { Connection, PublicKey } from '@solana/web3.js';

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

export {
    getTokenInfo,
};