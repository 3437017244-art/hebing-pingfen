(function () {
  'use strict';

  const isNativeApp = Boolean(window.Capacitor?.isNativePlatform?.());
  if (isNativeApp) {
    window.__IS_MOBILE_APP__ = true;
  }

  function isMapGestureTarget(target) {
    if (!target || !target.closest) return false;
    return Boolean(
      target.closest(
        '.amap-picker-map, .amap-container, .amap-browse-overlay, .amap-picker-overlay, #amap-browse-map, #amap-picker-map',
      ),
    );
  }

  function isMapUiOpen() {
    return Boolean(window.AmapPicker?.isOpen?.() || window.AmapPicker?.isBrowseMapOpen?.());
  }

  // 仅在非地图区域禁止双指，避免误触发页面缩放；地图上必须允许双指捏合
  document.addEventListener(
    'touchstart',
    function (event) {
      if (event.touches.length <= 1) return;
      if (isMapUiOpen() || isMapGestureTarget(event.target)) return;
      event.preventDefault();
    },
    { passive: false },
  );

  let lastTouchEnd = 0;
  document.addEventListener(
    'touchend',
    function (event) {
      if (isMapUiOpen() || isMapGestureTarget(event.target)) return;
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

  function isHomePage() {
    const path = String(location.pathname || '').replace(/\\/g, '/');
    const file = path.split('/').pop() || '';
    return file === '' || /^index\.html$/i.test(file);
  }

  function getTopOpenDialog() {
    const dialogs = document.querySelectorAll('dialog[open]');
    if (!dialogs.length) return null;
    return dialogs[dialogs.length - 1];
  }

  function performAppBack() {
    if (global.AmapPicker?.cancelIfOpen?.()) {
      return true;
    }
    const openDialog = getTopOpenDialog();
    if (openDialog) {
      openDialog.close();
      return true;
    }
    if (isHomePage()) {
      return false;
    }
    if (window.history.length > 1) {
      window.history.back();
      return true;
    }
    window.location.href = 'index.html';
    return true;
  }

  function setupEdgeSwipeBack() {
    if (!isNativeApp) return;

    const EDGE_ZONE = 28;
    const MIN_DISTANCE = 72;
    const MAX_VERTICAL = 56;

    let tracking = false;
    let fromLeft = false;
    let fromRight = false;
    let startX = 0;
    let startY = 0;
    let moved = false;
    let cancelledByMultiTouch = false;

    document.addEventListener(
      'touchstart',
      function (event) {
        if (event.touches.length !== 1) {
          tracking = false;
          cancelledByMultiTouch = true;
          return;
        }
        cancelledByMultiTouch = false;
        // 地图手势中不做边缘返回，避免双指缩放被当成返回
        if (isMapUiOpen() || isMapGestureTarget(event.target)) {
          tracking = false;
          return;
        }
        const touch = event.touches[0];
        const width = window.innerWidth || document.documentElement.clientWidth || 0;
        startX = touch.clientX;
        startY = touch.clientY;
        fromLeft = startX <= EDGE_ZONE;
        fromRight = startX >= width - EDGE_ZONE;
        tracking = fromLeft || fromRight;
        moved = false;
      },
      { passive: true },
    );

    document.addEventListener(
      'touchmove',
      function (event) {
        if (event.touches.length !== 1) {
          tracking = false;
          cancelledByMultiTouch = true;
          return;
        }
        if (!tracking) return;
        const touch = event.touches[0];
        const dx = touch.clientX - startX;
        const dy = touch.clientY - startY;
        if (Math.abs(dy) > MAX_VERTICAL && Math.abs(dy) > Math.abs(dx)) {
          tracking = false;
          return;
        }
        if ((fromLeft && dx > 24) || (fromRight && dx < -24)) {
          moved = true;
        }
      },
      { passive: true },
    );

    document.addEventListener(
      'touchend',
      function (event) {
        if (cancelledByMultiTouch) {
          cancelledByMultiTouch = false;
          tracking = false;
          moved = false;
          return;
        }
        if (!tracking) return;
        tracking = false;
        if (!moved) return;

        const touch = event.changedTouches[0];
        if (!touch) return;
        const dx = touch.clientX - startX;
        const dy = touch.clientY - startY;
        if (Math.abs(dy) > MAX_VERTICAL && Math.abs(dy) > Math.abs(dx)) return;

        const swipeFromLeft = fromLeft && dx >= MIN_DISTANCE;
        const swipeFromRight = fromRight && dx <= -MIN_DISTANCE;
        if (!swipeFromLeft && !swipeFromRight) return;

        performAppBack();
      },
      { passive: true },
    );

    document.addEventListener(
      'touchcancel',
      function () {
        tracking = false;
        moved = false;
        cancelledByMultiTouch = false;
      },
      { passive: true },
    );
  }

  function setupPullToRefresh() {
    if (!isNativeApp) return;

    let startY = 0;
    let pulling = false;
    let multiTouch = false;
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
        if (isMapUiOpen() || isMapGestureTarget(event.target)) {
          pulling = false;
          multiTouch = false;
          return;
        }
        if (window.scrollY > 8) return;
        if (event.touches.length !== 1) {
          multiTouch = true;
          pulling = false;
          return;
        }
        multiTouch = false;
        startY = event.touches[0].clientY;
        pulling = true;
      },
      { passive: true },
    );

    document.addEventListener(
      'touchmove',
      function (event) {
        if (event.touches.length !== 1) {
          multiTouch = true;
          pulling = false;
          indicator.classList.remove('visible', 'ready');
          return;
        }
        if (!pulling || multiTouch) return;
        if (isMapUiOpen()) {
          pulling = false;
          indicator.classList.remove('visible', 'ready');
          return;
        }
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
        if (multiTouch) {
          multiTouch = false;
          pulling = false;
          indicator.classList.remove('visible', 'ready');
          return;
        }
        if (!pulling) return;
        pulling = false;
        if (isMapUiOpen()) {
          indicator.classList.remove('visible', 'ready');
          return;
        }
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
    performAppBack: performAppBack,
  };

  document.addEventListener('DOMContentLoaded', function () {
    setupEdgeSwipeBack();
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
