(function (global) {
  'use strict';

  global.HEBING_SITE = {
    version: '1.0.0',
    repoName: 'hebing-pingfen',
    updatedAt: '2026-07-13',
    githubUser: '3437017244-art',
    giteeUser: 'zsp950309',
    // 云端数据同步码（jsonblob）。部署后所有设备自动使用，无需手动复制。
    defaultSyncCode: '019f58bc-163f-7878-9ee6-4066a48180ee',
    autoSync: true,
    mirrors: {
      github: 'https://3437017244-art.github.io/hebing-pingfen/',
      gitee: 'https://zsp950309.gitee.io/hebing-pingfen/',
    },
    preferredMirror: 'gitee',
  };

  global.HEBING_SITE.getSiteUrl = function (prefer) {
    const key = prefer || global.HEBING_SITE.preferredMirror || 'github';
    return global.HEBING_SITE.mirrors[key] || global.HEBING_SITE.mirrors.github;
  };
})(window);
