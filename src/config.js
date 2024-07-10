const WebSocketScheme = 'wss';
const WebSocketHost = 'mainnet.helius-rpc.com';
const APIKeyEnvVar = 'API_KEY';

let walletPool = {
    // "RADYIUM WALLET": "",
    "MAIN WALLET": "",
    // Add more named wallets here
};

module.exports = {
    WebSocketScheme,
    WebSocketHost,
    APIKeyEnvVar,
    walletPool
};