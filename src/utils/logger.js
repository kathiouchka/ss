const fs = require('fs');

function logTransaction(tx) {
    const jsonData = JSON.stringify(tx, null, 2);
    fs.appendFileSync('transactions.log', jsonData + '\n\n');
}

function logDetailedInfo(info) {
    const jsonData = JSON.stringify(info, null, 2);
    fs.appendFileSync('detailed_info.log', jsonData + '\n\n');
}


module.exports = {
    logTransaction,
    logDetailedInfo
};