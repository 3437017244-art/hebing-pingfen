const fs = require('fs');
const path = require('path');

async function main() {
  const root = __dirname;
  const configText = fs.readFileSync(path.join(root, 'site-config.js'), 'utf8');
  const modeMatch = configText.match(/syncMode:\s*'([^']*)'/);
  const syncMode = modeMatch ? modeMatch[1].trim() : '';

  // 仓库云同步模式下，cloud-data.json 是正式数据源，禁止被失效的 jsonblob 覆盖
  if (syncMode === 'gitee-api' || syncMode === 'github-api') {
    const localPath = path.join(root, 'cloud-data.json');
    if (fs.existsSync(localPath)) {
      const local = JSON.parse(fs.readFileSync(localPath, 'utf8'));
      console.log(
        'SKIP: 仓库云同步模式，保留 cloud-data.json products=' +
          (local.products || []).length +
          ' shops=' +
          (local.shops || []).length,
      );
    } else {
      console.log('SKIP: 仓库云同步模式，且本地尚无 cloud-data.json');
    }
    return;
  }

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

  // 防止空云端覆盖本地已有登记
  const localPath = path.join(root, 'cloud-data.json');
  if (fs.existsSync(localPath)) {
    const local = JSON.parse(fs.readFileSync(localPath, 'utf8'));
    const localCount = (local.products || []).length + (local.shops || []).length;
    const remoteCount = payload.products.length + payload.shops.length;
    if (localCount > 0 && remoteCount === 0) {
      console.log('SKIP: 云端为空，保留本地 cloud-data.json（products=' + (local.products || []).length + '）');
      return;
    }
  }

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
