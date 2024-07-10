const { getTokenInfo } = require('./api');

async function simplifyTransaction(tx, walletPool) {
    let simplifiedTx = {
        signature: tx.signature,
        time: new Date(tx.timestamp).toLocaleString(), // Use the provided ISO 8601 timestamp
        action: tx.type,
        from: '',
        to: '',
        inputAmount: '',
        inputToken: '',
        outputAmount: '',
        outputToken: '',
        walletName: ''
    };

    async function getTokenName(mint) {
        if (mint === 'So11111111111111111111111111111111111111112') {
            return 'SOL';
        }
        const tokenInfo = await getTokenInfo(mint);
        return tokenInfo ? tokenInfo.mintSymbol : mint;
    }

    if (tx.type === 'SWAP') {
        const swap = tx.events.swap;
        if (swap && swap.innerSwaps && swap.innerSwaps.length > 0) {
            const innerSwap = swap.innerSwaps[0];
    
            if (innerSwap.tokenInputs && innerSwap.tokenInputs.length > 0) {
                const input = innerSwap.tokenInputs[0];
                simplifiedTx.from = input.fromUserAccount;
                simplifiedTx.inputAmount = input.tokenAmount;
                simplifiedTx.inputToken = await getTokenName(input.mint);
            } else if (swap.nativeInput) {
                simplifiedTx.from = swap.nativeInput.account;
                simplifiedTx.inputAmount = swap.nativeInput.amount / 1e9;
                simplifiedTx.inputToken = 'SOL';
            }
    
            if (innerSwap.tokenOutputs && innerSwap.tokenOutputs.length > 0) {
                const output = innerSwap.tokenOutputs[0];
                simplifiedTx.to = output.fromUserAccount;
                simplifiedTx.outputAmount = output.tokenAmount;
                simplifiedTx.outputToken = await getTokenName(output.mint);
            } else if (swap.nativeOutput) {
                simplifiedTx.to = swap.nativeOutput.account;
                simplifiedTx.outputAmount = swap.nativeOutput.amount / 1e9;
                simplifiedTx.outputToken = 'SOL';
            }
        }
    }else if (tx.tokenTransfers && tx.tokenTransfers.length > 0) {
        const transfer = tx.tokenTransfers[0];
        simplifiedTx.from = transfer.fromUserAccount;
        simplifiedTx.to = transfer.toUserAccount;
        simplifiedTx.inputAmount = transfer.tokenAmount;
        simplifiedTx.inputToken = await getTokenName(transfer.mint);
    } else if (tx.nativeTransfers && tx.nativeTransfers.length > 0) {
        const transfer = tx.nativeTransfers[0];
        simplifiedTx.from = transfer.fromUserAccount;
        simplifiedTx.to = transfer.toUserAccount;
        simplifiedTx.inputAmount = transfer.amount / 1e9; // Convert lamports to SOL
        simplifiedTx.inputToken = 'SOL'; // Native SOL mint address
    }

    // Find the wallet name
    for (const [name, pubkey] of Object.entries(walletPool)) {
        if (simplifiedTx.from === pubkey || simplifiedTx.to === pubkey) {
            simplifiedTx.walletName = name;
            break;
        }
    }

    return simplifiedTx;
}

module.exports = {
    simplifyTransaction
};