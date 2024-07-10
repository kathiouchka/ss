const fs = require('fs');

function logTransaction(tx) {
    const jsonData = JSON.stringify(tx, null, 2);
    fs.appendFileSync('transactions.log', jsonData + '\n\n');
}

module.exports = {
    logTransaction
};