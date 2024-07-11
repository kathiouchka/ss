const WebSocketScheme = 'wss';
// const WebSocketHost = 'mainnet.helius-rpc.com';
const WebSocketHost = 'devnet.helius-rpc.com';
const APIKeyEnvVar = 'API_KEY';

let walletPool = {
    "RADYIUM WALLET": "",
};

module.exports = {
    WebSocketScheme,
    WebSocketHost,
    APIKeyEnvVar,
    walletPool
};