const fs = require('fs');
const path = require('path');

async function main() {
  const backupPath = path.join(__dirname, 'extracted-backup.json');
  const payload = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
  const body = {
    products: payload.products,
    shops: payload.shops,
    syncedAt: new Date().toISOString(),
  };

  const response = await fetch('https://jsonblob.com/api/jsonBlob', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`Upload failed: ${response.status} ${await response.text()}`);
  }

  const location = response.headers.get('location') || '';
  const syncCode = location.split('/').filter(Boolean).pop();
  console.log('SYNC_CODE=' + syncCode);
  console.log('PRODUCTS=' + body.products.length);
  console.log('SHOPS=' + body.shops.length);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
