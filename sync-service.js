(function (global) {
  'use strict';

  const PRODUCT_KEY = 'shopping-ratings';
  const SHOP_KEY = 'nearbyShops';
  const SYNC_CODE_KEY = 'hebing-sync-code';
  const SYNC_AUTO_KEY = 'hebing-sync-auto';
  const SYNC_API = 'https://jsonblob.com/api/jsonBlob';
  const BUNDLED_CLOUD_FILE = 'cloud-data.json';
  const SYNC_DEBOUNCE_MS = 2000;
  let syncTimer = null;
  let syncInFlight = null;
  let lastPullSource = '';

  function normalizeShops(list) {
    return (list || []).map(function (shop) {
      if (shop.product && !shop.products) {
        shop.products = [shop.product];
        delete shop.product;
      }
      return shop;
    });
  }

  function itemTimestamp(item) {
    return item && (item.updatedAt || item.createdAt || '');
  }

  function mergeByIdNewer(existing, incoming) {
    const map = new Map();

    function addItem(item) {
      if (!item || item.id == null) return;
      const id = String(item.id);
      const prev = map.get(id);
      if (!prev) {
        map.set(id, item);
        return;
      }
      map.set(id, itemTimestamp(item) >= itemTimestamp(prev) ? item : prev);
    }

    (existing || []).forEach(addItem);
    (incoming || []).forEach(addItem);
    return Array.from(map.values());
  }

  function getLocalPayload() {
    return {
      products: JSON.parse(localStorage.getItem(PRODUCT_KEY) || '[]'),
      shops: normalizeShops(JSON.parse(localStorage.getItem(SHOP_KEY) || '[]')),
      syncedAt: new Date().toISOString(),
    };
  }

  function saveLocalPayload(payload) {
    try {
      localStorage.setItem(PRODUCT_KEY, JSON.stringify(payload.products || []));
      localStorage.setItem(SHOP_KEY, JSON.stringify(normalizeShops(payload.shops || [])));
    } catch (err) {
      throw new Error('无法写入本机存储：' + (err && err.message ? err.message : err));
    }
  }

  function getBundledCloudUrl() {
    const site = global.HEBING_SITE;
    const base = site?.getSiteUrl ? site.getSiteUrl() : (site?.siteUrl || '');
    if (base) {
      return new URL(BUNDLED_CLOUD_FILE, base).href;
    }
    return new URL(BUNDLED_CLOUD_FILE, global.location.href).href;
  }

  async function pullBundledCloudData() {
    const result = await requestJson(getBundledCloudUrl() + '?_=' + Date.now(), {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    if (result.notFound) return null;
    return result.data;
  }

  function countPayload(payload) {
    return {
      products: (payload.products || []).length,
      shops: (payload.shops || []).length,
    };
  }

  async function requestJson(url, options) {
    const response = await fetch(url, options);
    if (response.status === 404) {
      return { notFound: true, response: response };
    }
    if (!response.ok) {
      const text = await response.text().catch(function () { return ''; });
      throw new Error('网络请求失败（' + response.status + '）' + (text ? '：' + text.slice(0, 120) : ''));
    }
    const data = await response.json();
    return { notFound: false, data: data, response: response };
  }

  function extractSyncCodeFromResponse(response) {
    const location = response.headers.get('Location') || '';
    const fromHeader = location.split('/').filter(Boolean).pop();
    return fromHeader || '';
  }

  async function createSyncCode() {
    const payload = getLocalPayload();
    const result = await requestJson(SYNC_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const syncCode = extractSyncCodeFromResponse(result.response);
    if (!syncCode) {
      throw new Error('无法生成同步码，请检查网络后重试');
    }

    localStorage.setItem(SYNC_CODE_KEY, syncCode);
    return syncCode;
  }

  async function pullRemote(syncCode) {
    let lastError = null;

    try {
      const result = await requestJson(SYNC_API + '/' + encodeURIComponent(syncCode), {
        headers: { Accept: 'application/json' },
      });
      if (!result.notFound && result.data) {
        lastPullSource = 'jsonblob';
        return result.data;
      }
    } catch (err) {
      lastError = err;
    }

    try {
      const bundled = await pullBundledCloudData();
      const stats = countPayload(bundled || {});
      if (bundled && (stats.products > 0 || stats.shops > 0)) {
        lastPullSource = 'bundled';
        return bundled;
      }
    } catch (err) {
      if (!lastError) lastError = err;
    }

    if (lastError) throw lastError;
    lastPullSource = '';
    return null;
  }

  async function pushRemote(syncCode, payload) {
    await requestJson(SYNC_API + '/' + encodeURIComponent(syncCode), {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
    });
  }

  async function syncNow(syncCode) {
    const code = (syncCode || getSyncCode() || '').trim();
    if (!code) {
      throw new Error('请先设置同步码');
    }

    const local = getLocalPayload();
    const remote = await pullRemote(code);

    if (!remote) {
      const localStats = countPayload(local);
      if (localStats.products === 0 && localStats.shops === 0) {
        throw new Error('无法获取云端数据，且本机也没有可上传的记录');
      }
      await pushRemote(code, local);
      localStorage.setItem(SYNC_CODE_KEY, code);
      return {
        action: 'uploaded',
        syncCode: code,
        products: localStats.products,
        shops: localStats.shops,
        syncedAt: local.syncedAt,
        source: 'jsonblob',
      };
    }

    const merged = {
      products: mergeByIdNewer(local.products, remote.products),
      shops: normalizeShops(mergeByIdNewer(local.shops, remote.shops)),
      syncedAt: new Date().toISOString(),
    };

    saveLocalPayload(merged);
    await pushRemote(code, merged);
    localStorage.setItem(SYNC_CODE_KEY, code);

    const stats = countPayload(merged);
    return {
      action: 'merged',
      syncCode: code,
      products: stats.products,
      shops: stats.shops,
      syncedAt: merged.syncedAt,
      source: lastPullSource || 'jsonblob',
    };
  }

  async function peekRemote(syncCode) {
    const code = (syncCode || getSyncCode() || '').trim();
    if (!code) {
      return { error: '未配置同步码', products: 0, shops: 0, source: 'none' };
    }
    try {
      const remote = await pullRemote(code);
      if (!remote) {
        return { products: 0, shops: 0, source: 'none' };
      }
      const stats = countPayload(remote);
      return {
        products: stats.products,
        shops: stats.shops,
        source: lastPullSource || 'cloud',
        syncedAt: remote.syncedAt || '',
      };
    } catch (err) {
      return {
        error: String(err && err.message ? err.message : err),
        products: 0,
        shops: 0,
        source: 'error',
      };
    }
  }

  function getConfiguredSyncCode() {
    const site = global.HEBING_SITE;
    if (!site || !site.defaultSyncCode) return '';
    return String(site.defaultSyncCode).trim();
  }

  function isSiteAutoSyncConfigured() {
    return Boolean(getConfiguredSyncCode()) && global.HEBING_SITE?.autoSync !== false;
  }

  function ensureSyncSetup() {
    const configured = getConfiguredSyncCode();
    if (!configured) return false;
    localStorage.setItem(SYNC_CODE_KEY, configured);
    if (global.HEBING_SITE?.autoSync !== false) {
      localStorage.setItem(SYNC_AUTO_KEY, '1');
    }
    return true;
  }

  function getSyncCode() {
    const configured = getConfiguredSyncCode();
    if (configured) return configured;
    return localStorage.getItem(SYNC_CODE_KEY) || '';
  }

  function setSyncCode(code) {
    const value = (code || '').trim();
    if (!value) {
      if (!getConfiguredSyncCode()) {
        localStorage.removeItem(SYNC_CODE_KEY);
      }
      return getSyncCode();
    }
    localStorage.setItem(SYNC_CODE_KEY, value);
    return value;
  }

  function isAutoSyncEnabled() {
    if (isSiteAutoSyncConfigured()) return true;
    return localStorage.getItem(SYNC_AUTO_KEY) === '1';
  }

  function setAutoSyncEnabled(enabled) {
    if (isSiteAutoSyncConfigured() && !enabled) return;
    localStorage.setItem(SYNC_AUTO_KEY, enabled ? '1' : '0');
  }

  async function tryAutoSync() {
    ensureSyncSetup();
    if (!isAutoSyncEnabled() || !getSyncCode()) {
      return null;
    }
    try {
      return await syncNow();
    } catch (err) {
      return { error: String(err && err.message ? err.message : err) };
    }
  }

  function scheduleCloudSync(delayMs) {
    if (!isAutoSyncEnabled() || !getSyncCode()) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(function () {
      syncNow().catch(function () {
        /* 后台同步失败时不打断使用 */
      });
    }, delayMs == null ? SYNC_DEBOUNCE_MS : delayMs);
  }

  async function bootstrap() {
    ensureSyncSetup();
    if (!isAutoSyncEnabled() || !getSyncCode()) return null;
    if (syncInFlight) return syncInFlight;
    syncInFlight = tryAutoSync().finally(function () {
      syncInFlight = null;
    });
    return syncInFlight;
  }

  global.HebingSync = {
    PRODUCT_KEY: PRODUCT_KEY,
    SHOP_KEY: SHOP_KEY,
    SYNC_CODE_KEY: SYNC_CODE_KEY,
    createSyncCode: createSyncCode,
    syncNow: syncNow,
    getSyncCode: getSyncCode,
    setSyncCode: setSyncCode,
    getConfiguredSyncCode: getConfiguredSyncCode,
    isSiteAutoSyncConfigured: isSiteAutoSyncConfigured,
    ensureSyncSetup: ensureSyncSetup,
    isAutoSyncEnabled: isAutoSyncEnabled,
    setAutoSyncEnabled: setAutoSyncEnabled,
    tryAutoSync: tryAutoSync,
    scheduleCloudSync: scheduleCloudSync,
    bootstrap: bootstrap,
    peekRemote: peekRemote,
    getLastPullSource: function () { return lastPullSource; },
    getLocalPayload: getLocalPayload,
    countPayload: countPayload,
  };
})(window);
