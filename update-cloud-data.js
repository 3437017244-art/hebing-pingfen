const fs = require('fs');
const path = require('path');

async function main() {
  const root = __dirname;
  const configText = fs.readFileSync(path.join(root, 'site-config.js'), 'utf8');
  const match = configText.match(/defaultSyncCode:\s*'([^']*)'/);
  if (!match) {
    console.log('SKIP: site-config.js 中未找到 defaultSyncCode');
    return;
  }

  const syncCode = match[1].trim();
  const response = await fetch('https://jsonblob.com/api/jsonBlob/' + encodeURIComponent(syncCode), {
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    throw new Error('jsonblob 请求失败：' + response.status);
  }

  const data = await response.json();
  const payload = {
    products: data.products || [],
    shops: data.shops || [],
    syncedAt: data.syncedAt || new Date().toISOString(),
  };

  fs.writeFileSync(
    path.join(root, 'cloud-data.json'),
    JSON.stringify(payload, null, 2) + '\n',
    'utf8',
  );

  console.log(
    'OK cloud-data.json products=' + payload.products.length + ' shops=' + payload.shops.length,
  );
}

main().catch(function (err) {
  console.error(err.message || err);
  process.exit(1);
});
