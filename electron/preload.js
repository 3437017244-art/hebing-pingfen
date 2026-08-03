(function () {
  'use strict';

  function markDesktop() {
    if (document.documentElement) {
      document.documentElement.classList.add('desktop-app');
    }
    window.__IS_DESKTOP_APP__ = true;
  }

  // 尽早打标，避免首屏闪出系统滚动条
  markDesktop();
  window.addEventListener('DOMContentLoaded', markDesktop);
})();
