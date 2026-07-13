(function (global) {
  'use strict';

  const PRODUCT_KEY = 'shopping-ratings';
  const SHOP_KEY = 'nearbyShops';
  const SYNC_CODE_KEY = 'hebing-sync-code';
  const SYNC_AUTO_KEY = 'hebing-sync-auto';
  const GITHUB_TOKEN_KEY = 'hebing-github-sync-token';
  const SYNC_API = 'https://jsonblob.com/api/jsonBlob';
  const BUNDLED_CLOUD_FILE = 'cloud-data.json';
  const SYNC_DEBOUNCE_MS = 2000;
  let syncTimer = null;
  let syncInFlight = null;
  let lastPullSource = '';
  let lastGithubSha = '';

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

  function utf8ToBase64(text) {
    return btoa(unescape(encodeURIComponent(text)));
  }

  function base64ToUtf8(base64) {
    return decodeURIComponent(escape(atob(base64.replace(/\s/g, ''))));
  }

  function getGithubRepoConfig() {
    const site = global.HEBING_SITE || {};
    return {
      owner: site.githubUser || '',
      repo: site.repoName || '',
      path: BUNDLED_CLOUD_FILE,
      token: (localStorage.getItem(GITHUB_TOKEN_KEY) || '').trim(),
    };
  }

  function isGithubApiMode() {
    return global.HEBING_SITE?.syncMode === 'github-api';
  }

  function canUseGithubApiSync() {
    const cfg = getGithubRepoConfig();
    return isGithubApiMode() && Boolean(cfg.token && cfg.owner && cfg.repo);
  }

  function getGithubToken() {
    return localStorage.getItem(GITHUB_TOKEN_KEY) || '';
  }

  function setGithubToken(token) {
    const value = (token || '').trim();
    if (!value) {
      localStorage.removeItem(GITHUB_TOKEN_KEY);
      return '';
    }
    localStorage.setItem(GITHUB_TOKEN_KEY, value);
    return value;
  }

  function hasGithubToken() {
    return Boolean(getGithubToken());
  }

  function githubContentsUrl(cfg) {
    return (
      'https://api.github.com/repos/' +
      encodeURIComponent(cfg.owner) +
      '/' +
      encodeURIComponent(cfg.repo) +
      '/contents/' +
      encodeURIComponent(cfg.path)
    );
  }

  async function pullFromGithubApi() {
    const cfg = getGithubRepoConfig();
    if (!cfg.token || !cfg.owner || !cfg.repo) {
      throw new Error('未配置 GitHub 令牌');
    }

    const result = await requestJson(
      githubContentsUrl(cfg) + '?_=' + Date.now(),
      {
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: 'Bearer ' + cfg.token,
        },
        cache: 'no-store',
      },
    );

    if (result.notFound) return null;

    const entry = result.data;
    if (!entry || !entry.content) return null;

    lastGithubSha = entry.sha || '';
    return JSON.parse(base64ToUtf8(entry.content));
  }

  async function pushToGithubApi(payload) {
    const cfg = getGithubRepoConfig();
    if (!cfg.token || !cfg.owner || !cfg.repo) {
      throw new Error('请先在「云端同步」保存 GitHub 令牌');
    }

    const body = {
      message: '网页自动同步 cloud-data.json',
      content: utf8ToBase64(JSON.stringify(payload, null, 2) + '\n'),
    };

    if (lastGithubSha) {
      body.sha = lastGithubSha;
    } else {
      try {
        const existing = await pullFromGithubApi();
        if (existing && lastGithubSha) {
          body.sha = lastGithubSha;
        }
      } catch (err) {
        /* 文件不存在时直接创建 */
      }
    }

    const response = await fetch(githubContentsUrl(cfg), {
      method: 'PUT',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: 'Bearer ' + cfg.token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text().catch(function () { return ''; });
      throw new Error('GitHub 上传失败（' + response.status + '）' + (text ? '：' + text.slice(0, 120) : ''));
    }

    const data = await response.json();
    lastGithubSha = data?.content?.sha || lastGithubSha;
    return data;
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

    if (canUseGithubApiSync()) {
      try {
        const githubData = await pullFromGithubApi();
        if (githubData) {
          lastPullSource = 'github-api';
          return githubData;
        }
      } catch (err) {
        lastError = err;
      }
    }

    if (!isGithubApiMode()) {
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

  function formatSyncSource(source) {
    if (source === 'github-api') return 'GitHub 云同步';
    if (source === 'bundled') return 'GitHub 网页备份';
    if (source === 'jsonblob') return 'jsonblob 云端';
    return '云端';
  }

  async function pushRemoteJsonblob(syncCode, payload) {
    await requestJson(SYNC_API + '/' + encodeURIComponent(syncCode), {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
    });
  }

  async function pushCloudPayload(syncCode, payload) {
    if (canUseGithubApiSync()) {
      await pushToGithubApi(payload);
      return { source: 'github-api' };
    }

    if (isGithubApiMode()) {
      throw new Error('请先在「云端同步」保存 GitHub 令牌，手机与电脑各保存一次即可双向同步');
    }

    const code = (syncCode || getSyncCode() || '').trim();
    if (!code) {
      throw new Error('请先设置同步码');
    }
    await pushRemoteJsonblob(code, payload);
    return { source: 'jsonblob' };
  }

  async function syncNow(syncCode) {
    if (!canUseGithubApiSync() && !isGithubApiMode() && !(syncCode || getSyncCode())) {
      throw new Error('请先设置同步码');
    }
    if (isGithubApiMode() && !canUseGithubApiSync()) {
      throw new Error('请先在「云端同步」保存 GitHub 令牌，手机与电脑各保存一次即可双向同步');
    }

    const code = (syncCode || getSyncCode() || '').trim();
    const local = getLocalPayload();
    const remote = await pullRemote(code);

    if (!remote) {
      const localStats = countPayload(local);
      if (localStats.products === 0 && localStats.shops === 0) {
        throw new Error('无法获取云端数据，且本机也没有可上传的记录');
      }
      const pushResult = await pushCloudPayload(code, local);
      if (code) localStorage.setItem(SYNC_CODE_KEY, code);
      return {
        action: 'uploaded',
        syncCode: code,
        products: localStats.products,
        shops: localStats.shops,
        syncedAt: local.syncedAt,
        source: pushResult.source,
      };
    }

    const merged = {
      products: mergeByIdNewer(local.products, remote.products),
      shops: normalizeShops(mergeByIdNewer(local.shops, remote.shops)),
      syncedAt: new Date().toISOString(),
    };

    saveLocalPayload(merged);
    const pushResult = await pushCloudPayload(code, merged);
    if (code) localStorage.setItem(SYNC_CODE_KEY, code);

    const stats = countPayload(merged);
    return {
      action: 'merged',
      syncCode: code,
      products: stats.products,
      shops: stats.shops,
      syncedAt: merged.syncedAt,
      source: lastPullSource || pushResult.source,
    };
  }

  async function peekRemote(syncCode) {
    if (isGithubApiMode() && !canUseGithubApiSync()) {
      return {
        error: '尚未保存 GitHub 令牌',
        products: 0,
        shops: 0,
        source: 'none',
      };
    }

    const code = (syncCode || getSyncCode() || '').trim();
    if (!isGithubApiMode() && !code) {
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
    if (isGithubApiMode()) return global.HEBING_SITE?.autoSync !== false;
    return Boolean(getConfiguredSyncCode()) && global.HEBING_SITE?.autoSync !== false;
  }

  function ensureSyncSetup() {
    const configured = getConfiguredSyncCode();
    if (configured) {
      localStorage.setItem(SYNC_CODE_KEY, configured);
    }
    if (global.HEBING_SITE?.autoSync !== false) {
      localStorage.setItem(SYNC_AUTO_KEY, '1');
    }
    return Boolean(configured || isGithubApiMode());
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
    if (!isAutoSyncEnabled()) return null;
    if (isGithubApiMode()) {
      if (!canUseGithubApiSync()) return null;
    } else if (!getSyncCode()) {
      return null;
    }
    try {
      return await syncNow();
    } catch (err) {
      return { error: String(err && err.message ? err.message : err) };
    }
  }

  function scheduleCloudSync(delayMs) {
    if (!isAutoSyncEnabled()) return;
    if (isGithubApiMode()) {
      if (!canUseGithubApiSync()) return;
    } else if (!getSyncCode()) {
      return;
    }
    clearTimeout(syncTimer);
    syncTimer = setTimeout(function () {
      syncNow().catch(function () {
        /* 后台同步失败时不打断使用 */
      });
    }, delayMs == null ? SYNC_DEBOUNCE_MS : delayMs);
  }

  async function bootstrap() {
    ensureSyncSetup();
    if (!isAutoSyncEnabled()) return null;
    if (isGithubApiMode()) {
      if (!canUseGithubApiSync()) return null;
    } else if (!getSyncCode()) {
      return null;
    }
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
    GITHUB_TOKEN_KEY: GITHUB_TOKEN_KEY,
    createSyncCode: createSyncCode,
    syncNow: syncNow,
    getSyncCode: getSyncCode,
    setSyncCode: setSyncCode,
    getGithubToken: getGithubToken,
    setGithubToken: setGithubToken,
    hasGithubToken: hasGithubToken,
    canUseGithubApiSync: canUseGithubApiSync,
    isGithubApiMode: isGithubApiMode,
    getConfiguredSyncCode: getConfiguredSyncCode,
    isSiteAutoSyncConfigured: isSiteAutoSyncConfigured,
    ensureSyncSetup: ensureSyncSetup,
    isAutoSyncEnabled: isAutoSyncEnabled,
    setAutoSyncEnabled: setAutoSyncEnabled,
    tryAutoSync: tryAutoSync,
    scheduleCloudSync: scheduleCloudSync,
    formatSyncSource: formatSyncSource,
    bootstrap: bootstrap,
    peekRemote: peekRemote,
    getLastPullSource: function () { return lastPullSource; },
    getLocalPayload: getLocalPayload,
    countPayload: countPayload,
  };
})(window);
