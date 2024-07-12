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
        if (swap) {
            if (swap.tokenInputs && swap.tokenInputs.length > 0) {
                const input = swap.tokenInputs[0];
                simplifiedTx.from = input.userAccount;
                simplifiedTx.inputAmount = input.rawTokenAmount.tokenAmount / Math.pow(10, input.rawTokenAmount.decimals);
                simplifiedTx.inputToken = await getTokenName(input.mint);
            } else if (swap.nativeInput) {
                simplifiedTx.from = swap.nativeInput.account;
                simplifiedTx.inputAmount = swap.nativeInput.amount / 1e9;
                simplifiedTx.inputToken = 'SOL';
            }

            if (swap.tokenOutputs && swap.tokenOutputs.length > 0) {
                const output = swap.tokenOutputs[0];
                simplifiedTx.to = output.userAccount;
                simplifiedTx.outputAmount = output.rawTokenAmount.tokenAmount / Math.pow(10, output.rawTokenAmount.decimals);
                simplifiedTx.outputToken = await getTokenName(output.mint);
            } else if (swap.nativeOutput) {
                simplifiedTx.to = swap.nativeOutput.account;
                simplifiedTx.outputAmount = swap.nativeOutput.amount / 1e9;
                simplifiedTx.outputToken = 'SOL';
            }
        }
    } else if (tx.type === 'TRANSFER') {
        if (tx.tokenTransfers && tx.tokenTransfers.length > 0) {
            // Find the transfer involving our watched wallet
            const transfer = tx.tokenTransfers.find(t =>
                Object.values(walletPool).includes(t.fromUserAccount) ||
                Object.values(walletPool).includes(t.toUserAccount)
            ) || tx.tokenTransfers[0]; // Fallback to first transfer if none match

            simplifiedTx.from = transfer.fromUserAccount;
            simplifiedTx.to = transfer.toUserAccount;
            simplifiedTx.inputAmount = transfer.tokenAmount;
            simplifiedTx.inputToken = await getTokenName(transfer.mint);
        } else if (tx.nativeTransfers && tx.nativeTransfers.length > 0) {
            // Similar logic for native transfers
            const transfer = tx.nativeTransfers.find(t =>
                Object.values(walletPool).includes(t.fromUserAccount) ||
                Object.values(walletPool).includes(t.toUserAccount)
            ) || tx.nativeTransfers[0];

            simplifiedTx.from = transfer.fromUserAccount;
            simplifiedTx.to = transfer.toUserAccount;
            simplifiedTx.inputAmount = transfer.amount / 1e9; // Convert lamports to SOL
            simplifiedTx.inputToken = 'SOL';
        }
    } else if (tx.tokenTransfers && tx.tokenTransfers.length > 0) {
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