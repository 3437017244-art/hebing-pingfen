(function () {
  'use strict';

  const isNativeApp = Boolean(window.Capacitor?.isNativePlatform?.());
  const isAppPreview = new URLSearchParams(window.location.search).get('app-preview') === '1';
  if (isNativeApp || isAppPreview) {
    document.documentElement.classList.add('native-app');
  }
  if (isAppPreview) {
    document.documentElement.classList.add('app-preview');
  }
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

  function requestDialogClose(dialog) {
    if (!dialog?.open) return false;
    if (typeof dialog.requestClose === 'function') {
      dialog.requestClose();
      return true;
    }
    const cancelEvent = new Event('cancel', { cancelable: true });
    const shouldClose = dialog.dispatchEvent(cancelEvent);
    if (shouldClose && dialog.open) dialog.close();
    return true;
  }

  function closeCurrentLayer() {
    if (window.AmapPicker?.cancelIfOpen?.()) {
      return true;
    }
    const top = getTopOpenDialog();
    if (!top) return false;
    // 详情弹窗按「编辑 → 详情 → 首页」逐级返回，避免从编辑界面直接掉回首页
    if (top.id === 'detail-dialog' && typeof window.HebingNavigation?.handleBack === 'function') {
      return Boolean(window.HebingNavigation.handleBack());
    }
    return requestDialogClose(top);
  }

  function performAppBack() {
    if (closeCurrentLayer()) {
      return true;
    }
    if (!isHomePage()) {
      window.location.href = 'index.html';
      return true;
    }
    // 首页已是最上一级：消费返回事件，绝不交给系统退出 APP。
    return true;
  }

  function setupNativeBackNavigation() {
    if (!isNativeApp) return;

    const guardKey = '__hebingAppBackGuard';
    const pushHistoryGuard = function () {
      if (window.history.state?.[guardKey]) return;
      window.history.pushState(
        { ...(window.history.state || {}), [guardKey]: true },
        '',
        window.location.href,
      );
    };

    // 即使旧版 APP 尚未安装 @capacitor/app，WebView 返回也会先落到此保护层，
    // 从而关闭当前弹层或回首页，而不是直接结束 Activity。
    pushHistoryGuard();
    window.addEventListener('popstate', function () {
      if (closeCurrentLayer() || isHomePage()) {
        pushHistoryGuard();
        return;
      }
      window.location.replace('index.html');
    });

    // 新版 APP 安装 App 插件后，统一接管 Android 实体/手势返回键。
    const App = window.Capacitor?.Plugins?.App;
    if (App?.addListener) {
      App.addListener('backButton', function () {
        performAppBack();
      });
    }
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

  window.MobileAppBridge = {
    saveJsonFile,
    isNativeApp: function () {
      return isNativeApp;
    },
    performAppBack: performAppBack,
  };

  document.addEventListener('DOMContentLoaded', function () {
    setupNativeBackNavigation();
    setupEdgeSwipeBack();

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
