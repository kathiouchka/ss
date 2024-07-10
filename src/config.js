const WebSocketScheme = 'wss';
const WebSocketHost = 'mainnet.helius-rpc.com';
const APIKeyEnvVar = 'API_KEY';

let walletPool = {
    // "RADYIUM WALLET": "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1",
    "MAIN WALLET": "F3zkxsMwSRrF42kcH2qQAf2NSorBQhEGukLGyMAdz85b",
    // Add more named wallets here
};

module.exports = {
    WebSocketScheme,
    WebSocketHost,
    APIKeyEnvVar,
    walletPool
};