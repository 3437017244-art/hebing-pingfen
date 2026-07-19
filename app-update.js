(function (global) {
  'use strict';

  const CHECK_INTERVAL_MS = 5 * 60 * 1000;
  const RELOAD_GUARD_KEY = 'hebing-update-reload-attempt';
  const INITIAL_CHECK_DELAY_MS = 1500;

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

  async function checkForUpdate() {
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
      return {
        local: localInfo,
        remote: remoteInfo,
        hasUpdate: isRemoteNewer(localInfo, remoteInfo),
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

  function formatVersionLine(info) {
    if (!info) return '';
    const parts = [];
    if (info.version) parts.push('v' + info.version);
    if (info.updatedAt) parts.push(info.updatedAt);
    return parts.join(' · ');
  }

  let autoCheckTimer = null;
  let checkInFlight = null;

  async function applyUpdateIfNeeded(result) {
    if (!result || result.error || !result.hasUpdate || !result.remote) {
      try {
        sessionStorage.removeItem(RELOAD_GUARD_KEY);
      } catch (_err) {
        /* ignore */
      }
      return result;
    }

    const remoteKey = versionKey(result.remote);
    try {
      if (sessionStorage.getItem(RELOAD_GUARD_KEY) === remoteKey) {
        return result;
      }
      sessionStorage.setItem(RELOAD_GUARD_KEY, remoteKey);
    } catch (_err) {
      /* ignore */
    }

    reloadForUpdate();
    return result;
  }

  async function runAutoCheck() {
    if (checkInFlight) return checkInFlight;
    checkInFlight = checkForUpdate()
      .then(applyUpdateIfNeeded)
      .finally(function () {
        checkInFlight = null;
      });
    return checkInFlight;
  }

  function startAutoCheck() {
    if (!isRemoteCheckAvailable()) return;

    setTimeout(runAutoCheck, INITIAL_CHECK_DELAY_MS);

    if (autoCheckTimer) clearInterval(autoCheckTimer);
    autoCheckTimer = setInterval(runAutoCheck, CHECK_INTERVAL_MS);

    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') {
        runAutoCheck();
      }
    });
  }

  async function checkUpdateForUser(options) {
    const opts = options || {};
    const result = await checkForUpdate();
    const localLine = formatVersionLine(result.local) || '未知版本';
    const remoteLine = formatVersionLine(result.remote) || '';

    if (result.error) {
      return {
        ...result,
        message: '检查失败：' + result.error,
        willReload: false,
      };
    }

    if (result.hasUpdate && result.remote) {
      if (opts.autoReload !== false) {
        try {
          sessionStorage.removeItem(RELOAD_GUARD_KEY);
        } catch (_err) {
          /* ignore */
        }
        // 稍等一帧，方便调用方先提示用户
        setTimeout(function () {
          reloadForUpdate();
        }, opts.reloadDelayMs == null ? 400 : opts.reloadDelayMs);
      }
      return {
        ...result,
        message:
          '发现新版本 ' +
          remoteLine +
          '（当前 ' +
          localLine +
          '），正在更新…',
        willReload: opts.autoReload !== false,
      };
    }

    return {
      ...result,
      message: '已是最新网页版 ' + localLine,
      willReload: false,
    };
  }

  global.AppUpdate = {
    checkForUpdate: checkForUpdate,
    checkUpdateForUser: checkUpdateForUser,
    runAutoCheck: runAutoCheck,
    startAutoCheck: startAutoCheck,
    reloadForUpdate: reloadForUpdate,
    formatVersionLine: formatVersionLine,
    getLocalSiteInfo: getLocalSiteInfo,
    isRemoteCheckAvailable: isRemoteCheckAvailable,
  };

  document.addEventListener('DOMContentLoaded', startAutoCheck);
})(window);
