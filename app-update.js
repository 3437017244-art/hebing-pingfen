(function (global) {
  'use strict';

  const STORAGE_KEY = 'hebing-app-version-seen';
  const CHECK_INTERVAL_MS = 5 * 60 * 1000;

  function getLocalSiteInfo() {
    const site = global.HEBING_SITE || {};
    return {
      version: String(site.version || ''),
      updatedAt: String(site.updatedAt || ''),
      buildId: String(site.buildId || ''),
    };
  }

  function parseSiteConfigText(text) {
    function pick(pattern) {
      const match = String(text || '').match(pattern);
      return match ? match[1] : '';
    }
    return {
      version: pick(/version:\s*'([^']+)'/),
      updatedAt: pick(/updatedAt:\s*'([^']+)'/),
      buildId: pick(/buildId:\s*'([^']+)'/),
    };
  }

  function getSiteBaseUrl() {
    const site = global.HEBING_SITE;
    if (!site) return '';
    if (site.getSiteUrl) return site.getSiteUrl();
    return site.siteUrl || (site.mirrors && site.mirrors.github) || '';
  }

  function isRemoteCheckAvailable() {
    const base = getSiteBaseUrl();
    if (!base) return false;
    if (global.location.protocol === 'file:') return false;
    return true;
  }

  function versionKey(info) {
    return [info.version, info.updatedAt, info.buildId].filter(Boolean).join('|');
  }

  function isRemoteNewer(localInfo, remoteInfo) {
    if (remoteInfo.buildId && localInfo.buildId) {
      return remoteInfo.buildId !== localInfo.buildId;
    }
    if (remoteInfo.updatedAt && localInfo.updatedAt) {
      return remoteInfo.updatedAt !== localInfo.updatedAt;
    }
    if (remoteInfo.version && localInfo.version) {
      return remoteInfo.version !== localInfo.version;
    }
    return false;
  }

  function rememberSeen(info) {
    try {
      localStorage.setItem(STORAGE_KEY, versionKey(info));
    } catch (_err) {
      /* ignore */
    }
  }

  function hasDismissed(info) {
    try {
      return localStorage.getItem(STORAGE_KEY) === versionKey(info);
    } catch (_err) {
      return false;
    }
  }

  async function fetchRemoteSiteInfo() {
    if (!isRemoteCheckAvailable()) {
      return { error: '当前环境无法检查在线版本' };
    }

    const base = getSiteBaseUrl();
    const url = new URL('site-config.js', base.endsWith('/') ? base : base + '/');
    url.searchParams.set('t', String(Date.now()));

    const response = await fetch(url.href, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error('无法读取在线版本信息（HTTP ' + response.status + '）');
    }

    const text = await response.text();
    const remote = parseSiteConfigText(text);
    if (!remote.version && !remote.updatedAt && !remote.buildId) {
      throw new Error('在线版本信息格式无效');
    }
    return remote;
  }

  function reloadForUpdate() {
    const base = getSiteBaseUrl();
    if (base && global.location.href.indexOf(base) === 0) {
      const target = new URL(global.location.pathname + global.location.search, base);
      target.searchParams.set('_v', String(Date.now()));
      global.location.replace(target.href);
      return;
    }
    global.location.reload();
  }

  async function checkForUpdate(options) {
    const force = Boolean(options && options.force);
    const localInfo = getLocalSiteInfo();

    if (!isRemoteCheckAvailable()) {
      return {
        local: localInfo,
        remote: null,
        hasUpdate: false,
        error: '当前环境无法检查在线版本',
      };
    }

    try {
      const remoteInfo = await fetchRemoteSiteInfo();
      const hasUpdate = isRemoteNewer(localInfo, remoteInfo);
      const dismissed = !force && hasUpdate && hasDismissed(remoteInfo);

      return {
        local: localInfo,
        remote: remoteInfo,
        hasUpdate: hasUpdate,
        dismissed: dismissed,
      };
    } catch (err) {
      return {
        local: localInfo,
        remote: null,
        hasUpdate: false,
        error: String(err && err.message ? err.message : err),
      };
    }
  }

  function formatVersionLine(info, prefix) {
    if (!info) return '';
    const parts = [];
    if (info.version) parts.push('v' + info.version);
    if (info.updatedAt) parts.push(info.updatedAt);
    if (info.buildId) parts.push(info.buildId);
    return (prefix || '') + parts.join(' · ');
  }

  function ensureBannerElements() {
    let banner = document.getElementById('app-update-banner');
    if (banner) {
      return {
        banner: banner,
        text: document.getElementById('app-update-text'),
        reloadBtn: document.getElementById('app-update-reload-btn'),
        dismissBtn: document.getElementById('app-update-dismiss-btn'),
      };
    }

    banner = document.createElement('div');
    banner.id = 'app-update-banner';
    banner.className = 'app-update-banner';
    banner.hidden = true;
    banner.innerHTML =
      '<span id="app-update-text"></span>' +
      '<span class="app-update-actions">' +
      '<button type="button" class="btn btn-sm btn-primary" id="app-update-reload-btn">立即更新</button>' +
      '<button type="button" class="btn btn-sm btn-secondary" id="app-update-dismiss-btn">稍后</button>' +
      '</span>';

    const appRoot = document.querySelector('.app') || document.body;
    appRoot.insertBefore(banner, appRoot.firstChild);

    return {
      banner: banner,
      text: banner.querySelector('#app-update-text'),
      reloadBtn: banner.querySelector('#app-update-reload-btn'),
      dismissBtn: banner.querySelector('#app-update-dismiss-btn'),
    };
  }

  function bindBannerActions(elements) {
    if (!elements || elements.banner.dataset.bound) return;
    elements.banner.dataset.bound = '1';

    elements.reloadBtn.addEventListener('click', function () {
      reloadForUpdate();
    });

    elements.dismissBtn.addEventListener('click', function () {
      const remoteKey = elements.banner.dataset.remoteKey;
      if (remoteKey) {
        try {
          localStorage.setItem(STORAGE_KEY, remoteKey);
        } catch (_err) {
          /* ignore */
        }
      }
      elements.banner.hidden = true;
    });
  }

  function showUpdateBanner(result) {
    if (!result || !result.hasUpdate || result.dismissed) return;

    const elements = ensureBannerElements();
    bindBannerActions(elements);

    const remote = result.remote || {};
    elements.text.textContent =
      '发现新版本 ' +
      formatVersionLine(remote).trim() +
      '。电脑端已更新，点此刷新即可同步最新界面与功能。';
    elements.banner.dataset.remoteKey = versionKey(remote);
    elements.banner.hidden = false;
  }

  function hideUpdateBanner() {
    const banner = document.getElementById('app-update-banner');
    if (banner) banner.hidden = true;
  }

  let autoCheckTimer = null;

  async function runAutoCheck(options) {
    const result = await checkForUpdate(options);
    if (result.hasUpdate && !result.dismissed) {
      showUpdateBanner(result);
    } else if (!result.hasUpdate) {
      hideUpdateBanner();
    }
    return result;
  }

  function startAutoCheck() {
    if (!isRemoteCheckAvailable()) return;

    runAutoCheck();

    if (autoCheckTimer) clearInterval(autoCheckTimer);
    autoCheckTimer = setInterval(function () {
      runAutoCheck();
    }, CHECK_INTERVAL_MS);

    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') {
        runAutoCheck();
      }
    });
  }

  function markCurrentVersionSeen() {
    rememberSeen(getLocalSiteInfo());
  }

  global.AppUpdate = {
    checkForUpdate: checkForUpdate,
    runAutoCheck: runAutoCheck,
    startAutoCheck: startAutoCheck,
    reloadForUpdate: reloadForUpdate,
    showUpdateBanner: showUpdateBanner,
    hideUpdateBanner: hideUpdateBanner,
    markCurrentVersionSeen: markCurrentVersionSeen,
    formatVersionLine: formatVersionLine,
    getLocalSiteInfo: getLocalSiteInfo,
    isRemoteCheckAvailable: isRemoteCheckAvailable,
  };

  document.addEventListener('DOMContentLoaded', function () {
    bindBannerActions(ensureBannerElements());
    startAutoCheck();
  });
})(window);
