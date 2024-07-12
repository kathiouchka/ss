const axios = require('axios');

async function buyTokenWithJupiter(mintAddress) {
    const jupiterApiUrl = 'https://quote-api.jup.ag/v6/quote';
    const inputToken = 'So11111111111111111111111111111111111111112'; // SOL
    const amount = 1000000000; // 1 SOL in lamports
    
    try {
        const response = await axios.get(jupiterApiUrl, {
            params: {
                inputMint: inputToken,
                outputMint: mintAddress,
                amount: amount,
                slippageBps: 50
            }
        });

        if (response.data && response.data.data) {
            console.log('Quote received:', response.data);
            // Here you would typically send this quote to be executed
            // This part depends on how you want to interact with Jupiter's swap API
        } else {
            console.log('No quote data received');
        }
    } catch (error) {
        console.error('Error fetching Jupiter quote:', error);
    }
}

module.exports = {
    buyTokenWithJupiter
};