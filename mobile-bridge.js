(function () {
  'use strict';

  const isNativeApp = Boolean(window.Capacitor?.isNativePlatform?.());
  if (isNativeApp) {
    window.__IS_MOBILE_APP__ = true;
  }

  document.addEventListener(
    'touchstart',
    function (event) {
      if (event.touches.length > 1) event.preventDefault();
    },
    { passive: false },
  );

  let lastTouchEnd = 0;
  document.addEventListener(
    'touchend',
    function (event) {
      const now = Date.now();
      if (now - lastTouchEnd <= 300) {
        event.preventDefault();
      }
      lastTouchEnd = now;
    },
    { passive: false },
  );

  async function saveJsonFile(filename, jsonText) {
    const capacitor = window.Capacitor;
    if (capacitor?.isNativePlatform?.() && capacitor.Plugins) {
      const Filesystem = capacitor.Plugins.Filesystem;
      const Share = capacitor.Plugins.Share;
      if (Filesystem && Share) {
        try {
          await Filesystem.writeFile({
            path: filename,
            data: jsonText,
            directory: 'CACHE',
            encoding: 'utf8',
          });
          const uriResult = await Filesystem.getUri({
            path: filename,
            directory: 'CACHE',
          });
          await Share.share({
            title: '导出备份',
            text: '购物与商店评分数据备份',
            url: uriResult.uri,
            dialogTitle: '保存或分享备份文件',
          });
          return true;
        } catch (err) {
          const message = String(err?.message || err || '');
          if (message.includes('cancel') || message.includes('Cancel')) {
            return true;
          }
        }
      }
    }

    const blob = new Blob([jsonText], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
    return true;
  }

  function setupPullToRefresh() {
    if (!isNativeApp) return;

    let startY = 0;
    let pulling = false;
    let indicator = document.getElementById('app-pull-indicator');
    if (!indicator) {
      indicator = document.createElement('div');
      indicator.id = 'app-pull-indicator';
      indicator.className = 'app-pull-indicator';
      indicator.textContent = '下拉刷新';
      document.body.appendChild(indicator);
    }

    document.addEventListener(
      'touchstart',
      function (event) {
        if (window.scrollY > 8) return;
        if (event.touches.length !== 1) return;
        startY = event.touches[0].clientY;
        pulling = true;
      },
      { passive: true },
    );

    document.addEventListener(
      'touchmove',
      function (event) {
        if (!pulling) return;
        const delta = event.touches[0].clientY - startY;
        if (delta <= 0 || window.scrollY > 8) {
          indicator.classList.remove('visible', 'ready');
          return;
        }
        indicator.classList.add('visible');
        if (delta > 72) {
          indicator.classList.add('ready');
          indicator.textContent = '松开刷新';
        } else {
          indicator.classList.remove('ready');
          indicator.textContent = '下拉刷新';
        }
      },
      { passive: true },
    );

    document.addEventListener(
      'touchend',
      function (event) {
        if (!pulling) return;
        pulling = false;
        const delta = (event.changedTouches[0]?.clientY || 0) - startY;
        indicator.classList.remove('visible', 'ready');
        if (delta > 72 && window.scrollY <= 8) {
          indicator.textContent = '正在刷新…';
          indicator.classList.add('visible');
          if (window.AppUpdate?.reloadForUpdate) {
            window.AppUpdate.reloadForUpdate();
          } else {
            window.location.reload();
          }
        }
      },
      { passive: true },
    );
  }

  window.MobileAppBridge = {
    saveJsonFile,
    isNativeApp: function () {
      return isNativeApp;
    },
  };

  document.addEventListener('DOMContentLoaded', function () {
    setupPullToRefresh();

    const exportBtn = document.getElementById('export-btn');
    if (!exportBtn || exportBtn.dataset.mobileBridgeBound) return;
    exportBtn.dataset.mobileBridgeBound = '1';

    exportBtn.addEventListener('click', async function (event) {
      if (!window.MobileAppBridge.isNativeApp()) return;

      event.preventDefault();
      event.stopImmediatePropagation();

      const payload = {
        products: JSON.parse(localStorage.getItem('shopping-ratings') || '[]'),
        shops: JSON.parse(localStorage.getItem('nearbyShops') || '[]'),
        exportedAt: new Date().toISOString(),
      };
      const filename = '购物与商店评分-备份-' + new Date().toISOString().slice(0, 10) + '.json';
      await saveJsonFile(filename, JSON.stringify(payload, null, 2));
    });
  });
})();
