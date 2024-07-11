const WebSocketScheme = 'wss';
// const WebSocketHost = 'mainnet.helius-rpc.com';
const WebSocketHost = 'devnet.helius-rpc.com';
const APIKeyEnvVar = 'API_KEY';

let walletPool = {
    "RADYIUM WALLET": "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1",
};

module.exports = {
    WebSocketScheme,
    WebSocketHost,
    APIKeyEnvVar,
    walletPool
};