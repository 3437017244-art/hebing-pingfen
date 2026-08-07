(function (global) {
  'use strict';

  global.HEBING_SITE = {
    version: '1.0.61',
    repoName: 'hebing-pingfen',
    updatedAt: '2026-08-07',
    buildId: '20260807-160512',
    // 网页托管：GitHub Pages（Gitee Pages 已停）
    githubUser: '3437017244-art',
    // 登记数据同步：Gitee 仓库 cloud-data.json
    giteeUser: 'zsp950309',
    // 云端数据同步码（jsonblob，备用）。gitee-api 模式下以 Gitee 仓库文件为准。
    defaultSyncCode: '019f58bc-163f-7878-9ee6-4066a48180ee',
    autoSync: true,
    // gitee-api：手机与电脑通过 Gitee 私人令牌双向同步（各设备保存一次令牌）
    syncMode: 'gitee-api',
    syncBranch: 'main',
    siteUrl: 'https://3437017244-art.github.io/hebing-pingfen/',
    mirrors: {
      github: 'https://3437017244-art.github.io/hebing-pingfen/',
    },
    preferredMirror: 'github',
    // 高德地图 Web 端(JS API) Key。申请：https://console.amap.com/
    // Key 安全设置建议白名单：3437017244-art.github.io、localhost、127.0.0.1
    // 若控制台启用了「安全密钥」，把 securityJsCode 填到 amapSecurityJsCode。
    amapKey: '0305d86e98fb1555fd1d95c5410b33b4',
    amapSecurityJsCode: '91165ecd9025eda9eccec66351cba4e2',
  };

  global.HEBING_SITE.getSiteUrl = function (prefer) {
    if (global.HEBING_SITE.siteUrl) return global.HEBING_SITE.siteUrl;
    const key = prefer || global.HEBING_SITE.preferredMirror || 'github';
    return global.HEBING_SITE.mirrors[key] || global.HEBING_SITE.mirrors.github;
  };
})(window);
