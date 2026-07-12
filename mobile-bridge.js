(function () {
  'use strict';

  window.__IS_MOBILE_APP__ = true;

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

  window.MobileAppBridge = {
    saveJsonFile,
    isNativeApp: function () {
      return Boolean(window.Capacitor?.isNativePlatform?.());
    },
  };

  document.addEventListener('DOMContentLoaded', function () {
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
