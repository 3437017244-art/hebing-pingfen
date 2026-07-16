(function (global) {
  'use strict';

  global.HEBING_SITE = {
    version: '1.0.13',
    repoName: 'hebing-pingfen',
    updatedAt: '2026-07-16',
    buildId: '20260716-162800',
    githubUser: '3437017244-art',
    // 云端数据同步码（jsonblob）。部署后所有设备自动使用，无需手动复制。
    defaultSyncCode: '019f58bc-163f-7878-9ee6-4066a48180ee',
    autoSync: true,
    // github-api：手机与电脑通过 GitHub 令牌双向同步（各设备保存一次令牌）
    syncMode: 'github-api',
    siteUrl: 'https://3437017244-art.github.io/hebing-pingfen/',
    mirrors: {
      github: 'https://3437017244-art.github.io/hebing-pingfen/',
    },
    preferredMirror: 'github',
  };

  global.HEBING_SITE.getSiteUrl = function (prefer) {
    if (global.HEBING_SITE.siteUrl) return global.HEBING_SITE.siteUrl;
    const key = prefer || global.HEBING_SITE.preferredMirror || 'github';
    return global.HEBING_SITE.mirrors[key] || global.HEBING_SITE.mirrors.github;
  };
})(window);
