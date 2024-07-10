let walletPool = require('../config').walletPool;

function addWallet(name, publicKey) {
    if (!walletPool[name]) {
        walletPool[name] = publicKey;
        console.log(`Added wallet: ${name} (${publicKey})`);
        setupConnection(name, publicKey);
    }
}

function removeWallet(name) {
    if (walletPool[name]) {
        delete walletPool[name];
        console.log(`Removed wallet: ${name}`);
        if (connections[name]) {
            connections[name].ws.close();
            clearInterval(connections[name].pingTimer);
            delete connections[name];
        }
    }
}

module.exports = {
    addWallet,
    removeWallet
};