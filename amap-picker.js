(function (global) {
  'use strict';

  const DEFAULT_CENTER = [116.397428, 39.90923];
  const SDK_PLUGINS = 'AMap.PlaceSearch,AMap.Geocoder,AMap.AutoComplete,AMap.Geolocation';
  // 精度差于该值（米）时提示用户，避免把城市级网络定位当成精确位置
  const LOW_ACCURACY_METERS = 800;

  let loadPromise = null;
  let overlayEl = null;
  let map = null;
  let marker = null;
  let placeSearch = null;
  let autoComplete = null;
  let geocoder = null;
  let amapGeolocation = null;
  let selected = null;
  let resolvePick = null;
  let searchTimer = null;
  let searchSeq = 0;

  function getConfig() {
    const site = global.HEBING_SITE || {};
    return {
      key: String(site.amapKey || '').trim(),
      securityJsCode: String(site.amapSecurityJsCode || '').trim(),
    };
  }

  function hasKey() {
    return Boolean(getConfig().key);
  }

  function loadAmapSdk() {
    if (global.AMap) return Promise.resolve(global.AMap);
    if (loadPromise) return loadPromise;

    const { key, securityJsCode } = getConfig();
    if (!key) {
      return Promise.reject(new Error('尚未配置高德 Key'));
    }

    if (securityJsCode) {
      global._AMapSecurityConfig = {
        securityJsCode: securityJsCode,
      };
    }

    loadPromise = new Promise(function (resolve, reject) {
      const script = document.createElement('script');
      script.src =
        'https://webapi.amap.com/maps?v=2.0&key=' +
        encodeURIComponent(key) +
        '&plugin=' +
        encodeURIComponent(SDK_PLUGINS);
      script.async = true;
      script.onload = function () {
        if (global.AMap) resolve(global.AMap);
        else reject(new Error('高德地图加载失败'));
      };
      script.onerror = function () {
        loadPromise = null;
        reject(new Error('高德地图脚本加载失败，请检查网络或 Key'));
      };
      document.head.appendChild(script);
    });

    return loadPromise;
  }

  function ensureOverlay() {
    if (overlayEl) return overlayEl;

    // 用原生 dialog.showModal，才能盖在编辑弹窗（也是 dialog）之上
    overlayEl = document.createElement('dialog');
    overlayEl.className = 'amap-picker-overlay';
    overlayEl.setAttribute('aria-label', '地图选点');
    overlayEl.innerHTML =
      '<div class="amap-picker">' +
      '<div class="amap-picker-map-wrap">' +
      '<div class="amap-picker-map" id="amap-picker-map"></div>' +
      '<div class="amap-picker-header">' +
      '<div class="amap-picker-search-row">' +
      '<input type="search" class="amap-picker-search" id="amap-picker-search" placeholder="输入地名搜索…" autocomplete="off">' +
      '<button type="button" class="btn btn-secondary btn-sm amap-picker-search-btn" id="amap-picker-search-btn">搜索</button>' +
      '</div>' +
      '<p class="amap-picker-selected" id="amap-picker-selected">点地图选点，或搜索地名</p>' +
      '<ul class="amap-picker-results" id="amap-picker-results" hidden></ul>' +
      '</div>' +
      '<div class="amap-picker-zoom">' +
      '<button type="button" class="amap-picker-fab amap-picker-zoom-out" id="amap-picker-zoom-out" aria-label="缩小">−</button>' +
      '<button type="button" class="amap-picker-fab amap-picker-zoom-in" id="amap-picker-zoom-in" aria-label="放大">+</button>' +
      '</div>' +
      '<div class="amap-picker-actions">' +
      '<button type="button" class="amap-picker-locate-btn" id="amap-picker-locate-btn" aria-label="我的位置" title="我的位置">' +
      '<svg class="amap-picker-locate-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
      '<circle cx="12" cy="12" r="3" fill="currentColor"></circle>' +
      '<path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"></path>' +
      '<circle cx="12" cy="12" r="7.2" stroke="currentColor" stroke-width="1.8" fill="none"></circle>' +
      '</svg>' +
      '</button>' +
      '<div class="amap-picker-actions-right">' +
      '<button type="button" class="btn btn-secondary amap-picker-action-btn" id="amap-picker-cancel">取消</button>' +
      '<button type="button" class="btn btn-primary amap-picker-action-btn" id="amap-picker-confirm">确认位置</button>' +
      '</div>' +
      '</div>' +
      '</div>' +
      '</div>';

    document.body.appendChild(overlayEl);

    overlayEl.querySelector('#amap-picker-cancel').addEventListener('click', function () {
      closePicker(null);
    });
    overlayEl.querySelector('#amap-picker-confirm').addEventListener('click', function () {
      if (!selected || selected.lng == null || selected.lat == null) {
        setStatus('请先在地图上选点或搜索地点');
        return;
      }
      closePicker({
        address: selected.address || '',
        lng: selected.lng,
        lat: selected.lat,
      });
    });
    overlayEl.querySelector('#amap-picker-search-btn').addEventListener('click', function () {
      runSearch(true);
    });
    overlayEl.querySelector('#amap-picker-locate-btn').addEventListener('click', function () {
      locateMyPosition();
    });
    overlayEl.querySelector('#amap-picker-zoom-out').addEventListener('click', function () {
      if (map) map.zoomOut();
    });
    overlayEl.querySelector('#amap-picker-zoom-in').addEventListener('click', function () {
      if (map) map.zoomIn();
    });
    const searchInput = overlayEl.querySelector('#amap-picker-search');
    searchInput.addEventListener('input', function () {
      scheduleLiveSearch();
    });
    searchInput.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') {
        event.preventDefault();
        runSearch(true);
      }
    });
    // 禁止点遮罩/选中文字松手误触导致关闭；只保留「取消」按钮和 Esc
    overlayEl.addEventListener('cancel', function (event) {
      event.preventDefault();
    });
    overlayEl.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closePicker(null);
      }
    });
    // 避免点击落到下层编辑 dialog，被当成点外部关闭
    overlayEl.addEventListener('click', function (event) {
      event.stopPropagation();
    });
    overlayEl.addEventListener('pointerdown', function (event) {
      event.stopPropagation();
    });

    return overlayEl;
  }

  function setLocateBusy(busy) {
    const btn = overlayEl && overlayEl.querySelector('#amap-picker-locate-btn');
    if (!btn) return;
    btn.disabled = Boolean(busy);
    btn.classList.toggle('is-busy', Boolean(busy));
    btn.title = busy ? '定位中…' : '我的位置';
    btn.setAttribute('aria-label', busy ? '定位中' : '我的位置');
  }

  function locateErrorMessage(error) {
    if (!error) return '定位失败，请重试或手动选点';
    if (error.code === 1 || error.code === error.PERMISSION_DENIED) {
      return '未获得定位权限。请在浏览器/系统设置里允许本站访问位置，然后重试。';
    }
    if (error.code === 2 || error.code === error.POSITION_UNAVAILABLE) {
      return '暂时无法获取位置，请检查定位开关或换网络后重试。';
    }
    if (error.code === 3 || error.code === error.TIMEOUT) {
      return '定位超时，请到开阔处重试，或手动在地图上选点。';
    }
    return '定位失败：' + (error.message || '请重试或手动选点');
  }

  function formatAccuracyText(accuracy) {
    if (accuracy == null || !Number.isFinite(accuracy) || accuracy <= 0) return '';
    if (accuracy >= 1000) return '约 ' + (accuracy / 1000).toFixed(1) + ' 公里';
    return '约 ' + Math.round(accuracy) + ' 米';
  }

  function applyCurrentPosition(lng, lat, accuracy) {
    clearResults();
    reverseGeocode(lng, lat);
    const accText = formatAccuracyText(accuracy);
    if (accuracy != null && accuracy > LOW_ACCURACY_METERS) {
      setStatus(
        '已定位，但精度较差（' +
          accText +
          '）。电脑/Wi‑Fi 定位常会偏到市区。请搜索「沙河」或拖动地图微调后再确认。',
      );
      return;
    }
    setStatus(
      accText
        ? '已定位到当前位置（精度 ' + accText + '），可微调后点「确认位置」'
        : '已定位到当前位置，可微调地图后点「确认位置」',
    );
  }

  function convertAndApplyPosition(lng, lat, accuracy) {
    const AMap = global.AMap;
    if (!AMap || typeof AMap.convertFrom !== 'function') {
      applyCurrentPosition(lng, lat, accuracy);
      return;
    }
    // 浏览器定位一般是 WGS84，高德地图用 GCJ-02
    AMap.convertFrom([lng, lat], 'gps', function (status, result) {
      if (status === 'complete' && result?.locations?.length) {
        const loc = result.locations[0];
        applyCurrentPosition(loc.lng, loc.lat, accuracy);
      } else {
        applyCurrentPosition(lng, lat, accuracy);
      }
    });
  }

  function locateWithBrowserGeolocation() {
    if (!global.navigator?.geolocation) {
      setLocateBusy(false);
      setStatus('当前环境不支持定位，请手动搜索或点地图选点');
      return;
    }

    setStatus('正在用浏览器高精度定位（请允许权限，室外更准）…');
    global.navigator.geolocation.getCurrentPosition(
      function (position) {
        setLocateBusy(false);
        const lng = position.coords.longitude;
        const lat = position.coords.latitude;
        const accuracy = Number(position.coords.accuracy);
        if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
          setStatus('获取到的坐标无效，请手动选点');
          return;
        }
        convertAndApplyPosition(lng, lat, accuracy);
      },
      function (error) {
        setLocateBusy(false);
        setStatus(locateErrorMessage(error));
      },
      {
        enableHighAccuracy: true,
        timeout: 20000,
        maximumAge: 0, // 不用缓存的大致位置，避免偏到市区
      },
    );
  }

  function locateWithAmapGeolocation() {
    const AMap = global.AMap;
    if (!AMap || !map) {
      locateWithBrowserGeolocation();
      return;
    }

    const run = function () {
      if (!amapGeolocation) {
        amapGeolocation = new AMap.Geolocation({
          enableHighAccuracy: true,
          timeout: 20000,
          maximumAge: 0,
          convert: true,
          showButton: false,
          showMarker: false,
          showCircle: false,
          panToLocation: false,
          zoomToAccuracy: false,
          needAddress: false,
        });
      }

      setStatus('正在用高德定位获取当前位置（请允许权限）…');
      amapGeolocation.getCurrentPosition(function (status, result) {
        if (status === 'complete' && result?.position) {
          setLocateBusy(false);
          const lng = result.position.lng;
          const lat = result.position.lat;
          const accuracy = Number(result.accuracy);
          if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
            locateWithBrowserGeolocation();
            return;
          }
          // 高德定位已是 GCJ-02，无需再 convertFrom
          applyCurrentPosition(lng, lat, accuracy);
          return;
        }

        // 高德失败时再退回浏览器定位
        locateWithBrowserGeolocation();
      });
    };

    if (typeof AMap.Geolocation === 'function') {
      run();
      return;
    }

    AMap.plugin('AMap.Geolocation', function () {
      if (typeof AMap.Geolocation !== 'function') {
        locateWithBrowserGeolocation();
        return;
      }
      run();
    });
  }

  function locateMyPosition() {
    if (!map) {
      setStatus('地图尚未就绪，请稍后再试');
      return;
    }

    setLocateBusy(true);
    // 优先高德定位（国内基站/Wi‑Fi 库更准），失败再退浏览器
    locateWithAmapGeolocation();
  }

  function setStatus(text) {
    const el = overlayEl && overlayEl.querySelector('#amap-picker-selected');
    if (el) el.textContent = text || '';
  }

  function clearResults() {
    const list = overlayEl && overlayEl.querySelector('#amap-picker-results');
    if (!list) return;
    list.innerHTML = '';
    list.hidden = true;
  }

  function parseLocation(loc) {
    if (!loc) return null;
    if (typeof loc === 'string') {
      const parts = loc.split(',');
      if (parts.length >= 2) {
        const lng = Number(parts[0]);
        const lat = Number(parts[1]);
        if (Number.isFinite(lng) && Number.isFinite(lat)) return { lng: lng, lat: lat };
      }
      return null;
    }
    const lng = typeof loc.lng === 'number' ? loc.lng : Number(loc.getLng?.() ?? loc[0]);
    const lat = typeof loc.lat === 'number' ? loc.lat : Number(loc.getLat?.() ?? loc[1]);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
    return { lng: lng, lat: lat };
  }

  function pickResultItem(item) {
    const name = item.name || '';
    const address = item.address || item.district || '';
    const fullAddress = [item.pname, item.cityname, item.adname, item.district, address, name]
      .filter(Boolean)
      .filter(function (part, index, arr) {
        return arr.indexOf(part) === index;
      })
      .join('');
    const parsed = parseLocation(item.location);
    if (parsed) {
      applySelection({
        address: fullAddress || name || address,
        lng: parsed.lng,
        lat: parsed.lat,
      });
      clearResults();
      return;
    }
    // 联想结果没有坐标时，再用关键词精确搜一次
    if (!placeSearch || !name) {
      setStatus('该结果暂无坐标，请换一项或直接点地图');
      return;
    }
    setStatus('正在定位「' + name + '」…');
    placeSearch.search(name, function (status, result) {
      const pois = result?.poiList?.pois || [];
      if (status === 'complete' && pois.length) {
        const first = pois[0];
        const loc = parseLocation(first.location);
        if (!loc) {
          setStatus('未能定位该地点，请换一项或直接点地图');
          return;
        }
        applySelection({
          address:
            [first.pname, first.cityname, first.adname, first.address, first.name]
              .filter(Boolean)
              .join('') || name,
          lng: loc.lng,
          lat: loc.lat,
        });
        clearResults();
      } else {
        setStatus('未能定位该地点，请换一项或直接点地图');
      }
    });
  }

  function showResults(items) {
    const list = overlayEl.querySelector('#amap-picker-results');
    if (!list) return;
    list.innerHTML = '';
    if (!items || !items.length) {
      list.hidden = true;
      return;
    }
    items.slice(0, 8).forEach(function (item) {
      const li = document.createElement('li');
      li.className = 'amap-picker-result-item';
      const name = item.name || '';
      const address = item.address || item.district || '';
      li.textContent = address ? name + ' · ' + address : name;
      li.addEventListener('click', function () {
        pickResultItem(item);
      });
      list.appendChild(li);
    });
    list.hidden = false;
  }

  function scheduleLiveSearch() {
    clearTimeout(searchTimer);
    const input = overlayEl && overlayEl.querySelector('#amap-picker-search');
    const keyword = (input?.value || '').trim();
    if (!keyword) {
      clearResults();
      return;
    }
    if (keyword.length < 2) {
      clearResults();
      setStatus('再输入一个字，开始联想地点…');
      return;
    }
    searchTimer = setTimeout(function () {
      runSearch(false);
    }, 280);
  }

  function createCenterPinContent() {
    return (
      '<div class="amap-picker-pin" aria-hidden="true">' +
      '<div class="amap-picker-pin-pulse"></div>' +
      '<div class="amap-picker-pin-head"></div>' +
      '<div class="amap-picker-pin-point"></div>' +
      '<div class="amap-picker-pin-shadow"></div>' +
      '</div>'
    );
  }

  function createPickerMarker(AMap, position) {
    return new AMap.Marker({
      position: position,
      draggable: true,
      cursor: 'move',
      zIndex: 120,
      offset: new AMap.Pixel(-22, -56),
      content: createCenterPinContent(),
      title: '当前选中位置（可拖动）',
    });
  }

  function applySelection(next) {
    selected = {
      address: next.address || '',
      lng: next.lng,
      lat: next.lat,
    };
    setStatus(selected.address || selected.lng + ', ' + selected.lat);
    if (map && marker && selected.lng != null && selected.lat != null) {
      const pos = [selected.lng, selected.lat];
      marker.setPosition(pos);
      marker.show();
      map.setZoom(Math.max(map.getZoom() || 16, 16));
      map.setCenter(pos);
    }
  }

  function geocodeAddressAndSelect(address) {
    if (!geocoder || !address) return;
    setStatus('正在定位已填地址…');
    geocoder.getLocation(address, function (status, result) {
      const geocode = result?.geocodes && result.geocodes[0];
      const loc = geocode && parseLocation(geocode.location);
      if (status === 'complete' && loc) {
        applySelection({
          address: geocode.formattedAddress || address,
          lng: loc.lng,
          lat: loc.lat,
        });
        setStatus('已定位到原先填写的位置，可拖动中心点微调');
        return;
      }
      setStatus('未能自动定位该地址，请搜索或直接点地图选点');
    });
  }

  function reverseGeocode(lng, lat) {
    if (!geocoder) {
      applySelection({ address: lng + ', ' + lat, lng: lng, lat: lat });
      return;
    }
    geocoder.getAddress([lng, lat], function (status, result) {
      if (status === 'complete' && result?.regeocode) {
        const address =
          result.regeocode.formattedAddress ||
          (result.regeocode.addressComponent
            ? [
                result.regeocode.addressComponent.province,
                result.regeocode.addressComponent.city,
                result.regeocode.addressComponent.district,
                result.regeocode.addressComponent.township,
                result.regeocode.addressComponent.street,
                result.regeocode.addressComponent.streetNumber,
              ]
                .filter(Boolean)
                .join('')
            : '');
        applySelection({ address: address || lng + ', ' + lat, lng: lng, lat: lat });
      } else {
        applySelection({ address: lng + ', ' + lat, lng: lng, lat: lat });
      }
    });
  }

  function runSearch(force) {
    const input = overlayEl.querySelector('#amap-picker-search');
    const keyword = (input?.value || '').trim();
    if (!keyword) {
      clearResults();
      if (force) setStatus('请输入要搜索的地点');
      return;
    }
    if (!force && keyword.length < 2) return;

    const seq = ++searchSeq;
    setStatus(force ? '搜索中…' : '正在联想…');

    // 优先输入提示（边打边出）；没有结果再退回 POI 搜索
    if (autoComplete) {
      autoComplete.search(keyword, function (status, result) {
        if (seq !== searchSeq) return;
        const tips = ((result && result.tips) || []).filter(function (tip) {
          return tip && tip.name;
        });
        if (status === 'complete' && tips.length) {
          showResults(tips);
          setStatus('找到 ' + tips.length + ' 条联想，点选一项即可');
          return;
        }
        searchByPlace(keyword, seq, force);
      });
      return;
    }

    searchByPlace(keyword, seq, force);
  }

  function searchByPlace(keyword, seq, force) {
    if (!placeSearch) {
      if (force) setStatus('地图搜索尚未就绪');
      return;
    }
    placeSearch.search(keyword, function (status, result) {
      if (seq != null && seq !== searchSeq) return;
      if (status === 'complete' && result?.poiList?.pois?.length) {
        showResults(result.poiList.pois);
        setStatus('找到 ' + result.poiList.pois.length + ' 个结果，点选一项或继续点地图');
      } else {
        clearResults();
        setStatus('未找到相关地点，可换个关键词或直接点地图');
      }
    });
  }

  function destroyMap() {
    clearTimeout(searchTimer);
    searchTimer = null;
    if (map) {
      map.destroy();
      map = null;
    }
    marker = null;
    placeSearch = null;
    autoComplete = null;
    geocoder = null;
    amapGeolocation = null;
  }

  function initMap(initial) {
    const AMap = global.AMap;
    const container = overlayEl.querySelector('#amap-picker-map');
    destroyMap();

    const hasCoord = initial.lng != null && initial.lat != null && !Number.isNaN(initial.lng) && !Number.isNaN(initial.lat);
    const center = hasCoord ? [initial.lng, initial.lat] : DEFAULT_CENTER;

    map = new AMap.Map(container, {
      zoom: hasCoord ? 16 : 12,
      center: center,
      viewMode: '2D',
    });

    marker = createPickerMarker(AMap, center);
    map.add(marker);
    if (!hasCoord) {
      marker.hide();
    }

    marker.on('dragend', function () {
      const pos = marker.getPosition();
      reverseGeocode(pos.lng, pos.lat);
    });

    map.on('click', function (event) {
      const lng = event.lnglat.getLng();
      const lat = event.lnglat.getLat();
      reverseGeocode(lng, lat);
    });

    AMap.plugin(['AMap.PlaceSearch', 'AMap.AutoComplete', 'AMap.Geocoder'], function () {
      placeSearch = new AMap.PlaceSearch({
        pageSize: 8,
        pageIndex: 1,
        city: '全国',
      });
      autoComplete = new AMap.AutoComplete({
        city: '全国',
        citylimit: false,
      });
      geocoder = new AMap.Geocoder({
        city: '全国',
        radius: 1000,
      });

      if (hasCoord) {
        if (initial.address) {
          applySelection({ address: initial.address, lng: initial.lng, lat: initial.lat });
          setStatus('已定位到原先填写的位置，可拖动中心点微调');
        } else {
          reverseGeocode(initial.lng, initial.lat);
        }
      } else if (initial.address) {
        const searchInput = overlayEl.querySelector('#amap-picker-search');
        if (searchInput && !searchInput.value) {
          searchInput.value = initial.address;
        }
        geocodeAddressAndSelect(initial.address);
      } else {
        setStatus('输入地名会自动联想，也可直接点地图选点');
      }
    });
  }

  function closePicker(result) {
    clearTimeout(searchTimer);
    searchTimer = null;
    searchSeq += 1;
    if (overlayEl && overlayEl.open) {
      overlayEl.close();
    }
    clearResults();
    destroyMap();
    document.body.classList.remove('amap-picker-open');
    const resolver = resolvePick;
    resolvePick = null;
    if (resolver) resolver(result);
  }

  function openAmapPicker(options) {
    const opts = options || {};
    const address = String(opts.address || '').trim();
    const lng = opts.lng != null && opts.lng !== '' ? Number(opts.lng) : null;
    const lat = opts.lat != null && opts.lat !== '' ? Number(opts.lat) : null;

    if (!hasKey()) {
      global.alert(
        '尚未配置高德 Key。\n请在高德开放平台申请 Web端(JS API) Key，填入 site-config.js 的 amapKey 后刷新。',
      );
      return Promise.resolve(null);
    }

    ensureOverlay();
    selected =
      lng != null && lat != null && !Number.isNaN(lng) && !Number.isNaN(lat)
        ? { address: address, lng: lng, lat: lat }
        : null;

    const searchInput = overlayEl.querySelector('#amap-picker-search');
    if (searchInput) searchInput.value = address || '';
    setStatus(selected ? selected.address || '已有定位，可重新选点' : '在地图上点选，或搜索后确认');
    clearResults();
    document.body.classList.add('amap-picker-open');
    if (!overlayEl.open) {
      overlayEl.showModal();
    }

    return loadAmapSdk()
      .then(function () {
        return new Promise(function (resolve) {
          resolvePick = resolve;
          // 等弹层显示后再初始化，避免地图尺寸为 0
          requestAnimationFrame(function () {
            requestAnimationFrame(function () {
              initMap({
                address: address,
                lng: lng != null && !Number.isNaN(lng) ? lng : null,
                lat: lat != null && !Number.isNaN(lat) ? lat : null,
              });
            });
          });
        });
      })
      .catch(function (error) {
        closePicker(null);
        global.alert(error.message || '高德地图加载失败');
        return null;
      });
  }

  function isOpen() {
    return Boolean(overlayEl && overlayEl.open && resolvePick);
  }

  function cancelIfOpen() {
    if (isOpen()) {
      closePicker(null);
      return true;
    }
    if (isBrowseMapOpen()) {
      closeBrowseMap();
      return true;
    }
    return false;
  }

  // ========== 地图浏览已登记 ==========
  let browseOverlayEl = null;
  let browseMap = null;
  let browseMarkers = [];
  let browsePlaces = [];
  let browseOnSelect = null;
  let browseHoverPlaceId = null;
  let browsePinnedPlaceId = null;
  let browsePinAt = 0;
  let browseMarkerClickLock = false;
  let browseLongPressTimer = null;
  let browseLongPressStart = null;
  let browseHoverSwitchTimer = null;
  let browseHoverClearTimer = null;
  let browseMyLocationMarker = null;
  const BROWSE_HOVER_SWITCH_MS = 90;
  const BROWSE_HOVER_CLEAR_MS = 50;
  // 500ms：Android/Material 与多数 App 长按约定，短于易与点按冲突，长于手感拖沓
  const BROWSE_LONG_PRESS_MS = 500;
  const BROWSE_LONG_PRESS_MOVE_PX = 14;

  function escapeBrowseText(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function isBrowseMapOpen() {
    return Boolean(browseOverlayEl && browseOverlayEl.open);
  }

  function destroyBrowseMapInstance() {
    if (browseHoverSwitchTimer) {
      clearTimeout(browseHoverSwitchTimer);
      browseHoverSwitchTimer = null;
    }
    if (browseHoverClearTimer) {
      clearTimeout(browseHoverClearTimer);
      browseHoverClearTimer = null;
    }
    if (browseMap) {
      try {
        browseMap.destroy();
      } catch (_err) {
        /* ignore */
      }
    }
    browseMap = null;
    browseMarkers = [];
    browseHoverPlaceId = null;
    browsePinnedPlaceId = null;
    browsePinAt = 0;
    browseMarkerClickLock = false;
    if (browseLongPressTimer) {
      clearTimeout(browseLongPressTimer);
      browseLongPressTimer = null;
    }
    browseLongPressStart = null;
    browseMyLocationMarker = null;
  }

  function closeBrowseMap() {
    destroyBrowseMapInstance();
    browsePlaces = [];
    browseOnSelect = null;
    document.body.classList.remove('amap-browse-open');
    if (browseOverlayEl?.open) {
      browseOverlayEl.close();
    }
  }

  function resizeBrowseMap() {
    if (!browseMap || !isBrowseMapOpen()) return;
    try {
      browseMap.resize();
    } catch (_err) {
      /* ignore */
    }
  }

  function setBrowseLocateBusy(busy) {
    const btn = browseOverlayEl && browseOverlayEl.querySelector('#amap-browse-locate');
    if (!btn) return;
    btn.disabled = Boolean(busy);
    btn.classList.toggle('is-busy', Boolean(busy));
    btn.title = busy ? '定位中…' : '我的位置';
    btn.setAttribute('aria-label', busy ? '定位中' : '我的位置');
  }

  function showBrowseMyLocation(lng, lat) {
    const AMap = global.AMap;
    if (!browseMap || !AMap || !Number.isFinite(lng) || !Number.isFinite(lat)) return;
    const pos = [lng, lat];
    if (browseMyLocationMarker) {
      browseMyLocationMarker.setPosition(pos);
    } else {
      browseMyLocationMarker = new AMap.Marker({
        position: pos,
        offset: new AMap.Pixel(-10, -10),
        zIndex: 200,
        content:
          '<div class="amap-browse-me-dot" aria-hidden="true">' +
          '<span class="amap-browse-me-dot-core"></span>' +
          '</div>',
      });
      browseMap.add(browseMyLocationMarker);
    }
    browseMap.setZoomAndCenter(Math.max(browseMap.getZoom(), 16), pos);
  }

  function convertBrowsePosition(lng, lat, done) {
    const AMap = global.AMap;
    if (!AMap || typeof AMap.convertFrom !== 'function') {
      done(lng, lat);
      return;
    }
    AMap.convertFrom([lng, lat], 'gps', function (status, result) {
      if (status === 'complete' && result?.locations?.length) {
        const loc = result.locations[0];
        done(loc.lng, loc.lat);
      } else {
        done(lng, lat);
      }
    });
  }

  function locateBrowseWithBrowser() {
    if (!global.navigator?.geolocation) {
      setBrowseLocateBusy(false);
      alert('当前环境不支持定位');
      return;
    }
    global.navigator.geolocation.getCurrentPosition(
      function (position) {
        const lng = position.coords.longitude;
        const lat = position.coords.latitude;
        if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
          setBrowseLocateBusy(false);
          alert('获取到的坐标无效');
          return;
        }
        convertBrowsePosition(lng, lat, function (gcjLng, gcjLat) {
          setBrowseLocateBusy(false);
          showBrowseMyLocation(gcjLng, gcjLat);
        });
      },
      function (error) {
        setBrowseLocateBusy(false);
        alert(locateErrorMessage(error));
      },
      {
        enableHighAccuracy: true,
        timeout: 20000,
        maximumAge: 0,
      },
    );
  }

  function locateBrowseMyPosition() {
    if (!browseMap || !isBrowseMapOpen()) return;
    setBrowseLocateBusy(true);
    const AMap = global.AMap;
    if (!AMap) {
      locateBrowseWithBrowser();
      return;
    }

    const run = function () {
      try {
        if (!amapGeolocation) {
          amapGeolocation = new AMap.Geolocation({
            enableHighAccuracy: true,
            timeout: 15000,
            maximumAge: 0,
            convert: true,
            showButton: false,
            showMarker: false,
            showCircle: false,
            panToLocation: false,
            zoomToAccuracy: false,
          });
        }
        amapGeolocation.getCurrentPosition(function (status, result) {
          if (status === 'complete' && result?.position) {
            setBrowseLocateBusy(false);
            showBrowseMyLocation(result.position.lng, result.position.lat);
            return;
          }
          locateBrowseWithBrowser();
        });
      } catch (_err) {
        locateBrowseWithBrowser();
      }
    };

    if (typeof AMap.Geolocation === 'function') {
      run();
      return;
    }
    AMap.plugin('AMap.Geolocation', function () {
      if (typeof AMap.Geolocation !== 'function') {
        locateBrowseWithBrowser();
        return;
      }
      run();
    });
  }

  function ensureBrowseOverlay() {
    if (browseOverlayEl) return browseOverlayEl;

    browseOverlayEl = document.createElement('dialog');
    browseOverlayEl.className = 'amap-picker-overlay amap-browse-overlay';
    browseOverlayEl.setAttribute('aria-label', '地图');
    browseOverlayEl.innerHTML =
      '<div class="amap-picker amap-browse">' +
      '<button type="button" class="amap-browse-close" id="amap-browse-close" aria-label="关闭">&times;</button>' +
      '<div class="amap-picker-map-wrap">' +
      '<div class="amap-picker-map" id="amap-browse-map"></div>' +
      '<button type="button" class="amap-browse-locate" id="amap-browse-locate" aria-label="我的位置" title="我的位置">' +
      '<svg class="amap-browse-locate-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
      '<circle cx="12" cy="12" r="3" fill="currentColor"></circle>' +
      '<path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"></path>' +
      '<circle cx="12" cy="12" r="7.2" stroke="currentColor" stroke-width="1.8" fill="none"></circle>' +
      '</svg>' +
      '</button>' +
      '<div class="amap-picker-zoom">' +
      '<button type="button" class="amap-picker-fab amap-picker-zoom-out" id="amap-browse-zoom-out" aria-label="缩小">−</button>' +
      '<button type="button" class="amap-picker-fab amap-picker-zoom-in" id="amap-browse-zoom-in" aria-label="放大">+</button>' +
      '</div>' +
      '<p class="amap-browse-empty" id="amap-browse-empty" hidden></p>' +
      '</div>' +
      '</div>';

    document.body.appendChild(browseOverlayEl);

    browseOverlayEl.querySelector('#amap-browse-close').addEventListener('click', closeBrowseMap);
    browseOverlayEl.querySelector('#amap-browse-locate').addEventListener('click', function () {
      locateBrowseMyPosition();
    });
    browseOverlayEl.querySelector('#amap-browse-zoom-in').addEventListener('click', function () {
      if (browseMap) browseMap.zoomIn();
    });
    browseOverlayEl.querySelector('#amap-browse-zoom-out').addEventListener('click', function () {
      if (browseMap) browseMap.zoomOut();
    });
    browseOverlayEl.addEventListener('cancel', function (event) {
      event.preventDefault();
      closeBrowseMap();
    });
    browseOverlayEl.addEventListener('click', function (event) {
      if (event.target === browseOverlayEl) closeBrowseMap();
    });
    // 避免 Ctrl+A 全选地图上所有招牌文字；截图快捷键冲突请在 QQ/系统里改
    browseOverlayEl.addEventListener('keydown', function (event) {
      if ((event.ctrlKey || event.metaKey) && String(event.key || '').toLowerCase() === 'a') {
        event.preventDefault();
      }
    });

    return browseOverlayEl;
  }

  // 锚点盒含上方招牌区：底边中点仍是针尖，避免标签伸出 AMap 命中盒导致顶部难点
  const BROWSE_PIN_ANCHOR_W = 148;
  const BROWSE_PIN_NEEDLE_H = 34;
  const BROWSE_PIN_LABEL_SPACE = 44;
  const BROWSE_PIN_ANCHOR_H = BROWSE_PIN_NEEDLE_H + BROWSE_PIN_LABEL_SPACE;
  // 小于该距离视为「挨得近」：只用于提示/点选列表，绝不改动登记坐标
  const BROWSE_NEAR_METERS = 50;

  function haversineMeters(lng1, lat1, lng2, lat2) {
    const toRad = Math.PI / 180;
    const dLat = (lat2 - lat1) * toRad;
    const dLng = (lng2 - lng1) * toRad;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 6371000 * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
  }

  function groupNearbyBrowsePlaces(places, maxMeters) {
    const groups = [];
    const used = {};
    for (let i = 0; i < places.length; i++) {
      if (used[i]) continue;
      const group = [places[i]];
      used[i] = true;
      const lng = Number(places[i].lng);
      const lat = Number(places[i].lat);
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
        groups.push(group);
        continue;
      }
      for (let j = i + 1; j < places.length; j++) {
        if (used[j]) continue;
        const lng2 = Number(places[j].lng);
        const lat2 = Number(places[j].lat);
        if (!Number.isFinite(lng2) || !Number.isFinite(lat2)) continue;
        if (haversineMeters(lng, lat, lng2, lat2) <= maxMeters) {
          group.push(places[j]);
          used[j] = true;
        }
      }
      groups.push(group);
    }
    return groups;
  }

  // 标记位置 = 登记坐标，不做任何视觉偏移
  function layoutBrowsePlaces(places) {
    const groups = groupNearbyBrowsePlaces(places, BROWSE_NEAR_METERS);
    const neighborMap = {};
    groups.forEach(function (group) {
      group.forEach(function (place) {
        neighborMap[String(place.id)] = group;
      });
    });
    return places.map(function (place) {
      const neighbors = neighborMap[String(place.id)] || [place];
      return {
        place: place,
        lng: Number(place.lng),
        lat: Number(place.lat),
        neighbors: neighbors.slice(),
      };
    });
  }

  function createBrowseMarkerContent(place, active, neighborCount) {
    const title = escapeBrowseText(place.title || '未命名');
    const rating =
      place.rating != null && Number(place.rating) > 0
        ? '<span class="amap-browse-pin-rating">' + escapeBrowseText(String(place.rating)) + '星</span>'
        : '';
    const activeClass = active ? ' is-active' : '';
    const clusterClass = neighborCount > 1 ? ' has-cluster' : '';
    return (
      '<button type="button" class="amap-browse-pin' +
      activeClass +
      clusterClass +
      '" data-browse-id="' +
      escapeBrowseText(place.id) +
      '">' +
      '<span class="amap-browse-pin-label">' +
      title +
      rating +
      '</span>' +
      '<span class="amap-browse-pin-needle" aria-hidden="true"></span>' +
      '</button>'
    );
  }

  function browseMarkerOffset(AMap) {
    return new AMap.Pixel(-Math.round(BROWSE_PIN_ANCHOR_W / 2), -BROWSE_PIN_ANCHOR_H);
  }

  function syncBrowseMarkerAnchor(marker) {
    const AMap = global.AMap;
    if (!marker || !AMap) return;
    // 固定用锚点盒尺寸，避免悬停放大后 getBoundingClientRect 把针尖算偏
    marker.setOffset(browseMarkerOffset(AMap));
  }

  function selectBrowsePlace(place) {
    if (!place || typeof browseOnSelect !== 'function') return;
    // 不关闭大地图：详情叠在上面，关掉详情后仍停在原地图位置
    // 延后一帧再开详情，避免 APP 上同一次触摸的合成 click 打到详情里的商品行
    const payload = place;
    window.setTimeout(function () {
      browseOnSelect(payload);
    }, 0);
  }

  function getBrowseVisualActiveId() {
    // 已点击固定时只显示固定招牌，鼠标移到别家也不切换
    if (browsePinnedPlaceId != null) return browsePinnedPlaceId;
    return browseHoverPlaceId;
  }

  function applyBrowseMarkerActiveState() {
    const activeId = getBrowseVisualActiveId();
    browseMarkers.forEach(function (item) {
      const n = (item.neighbors && item.neighbors.length) || 1;
      const isActive = activeId != null && String(item.place.id) === String(activeId);
      item.marker.setzIndex(isActive ? 320 : 100 + n);
      if (typeof item.marker.setTop === 'function') {
        item.marker.setTop(isActive);
      }
      const root = getBrowseMarkerDom(item.marker);
      const pin = root?.querySelector?.('.amap-browse-pin') || root;
      if (pin?.classList) {
        pin.classList.toggle('is-active', isActive);
      }
    });
  }

  function clearBrowsePinnedPlace() {
    if (browsePinnedPlaceId == null) return;
    clearBrowseLongPress();
    browsePinnedPlaceId = null;
    browsePinAt = 0;
    browseHoverPlaceId = null;
    applyBrowseMarkerActiveState();
  }

  function clearBrowseLongPress() {
    if (browseLongPressTimer) {
      clearTimeout(browseLongPressTimer);
      browseLongPressTimer = null;
    }
    browseLongPressStart = null;
  }

  function beginBrowseLongPress(placeId, clientX, clientY) {
    clearBrowseLongPress();
    const id = placeId != null ? String(placeId) : '';
    // 仅已固定放大的招牌：长按进入详情
    if (!id || browsePinnedPlaceId == null || browsePinnedPlaceId !== id) return;
    browseLongPressStart = { id: id, x: clientX, y: clientY };
    browseLongPressTimer = window.setTimeout(function () {
      browseLongPressTimer = null;
      const start = browseLongPressStart;
      browseLongPressStart = null;
      if (!start || browsePinnedPlaceId !== start.id) return;
      const entry = browseMarkers.find(function (item) {
        return String(item.place.id) === start.id;
      });
      if (!entry) return;
      try {
        if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
          navigator.vibrate(12);
        }
      } catch (_err) {
        /* ignore */
      }
      selectBrowsePlace(entry.place);
    }, BROWSE_LONG_PRESS_MS);
  }

  function moveBrowseLongPress(clientX, clientY) {
    if (!browseLongPressStart) return;
    const dx = clientX - browseLongPressStart.x;
    const dy = clientY - browseLongPressStart.y;
    if (dx * dx + dy * dy > BROWSE_LONG_PRESS_MOVE_PX * BROWSE_LONG_PRESS_MOVE_PX) {
      clearBrowseLongPress();
    }
  }

  function bindBrowseMarkerLongPress(mapEl) {
    if (!mapEl || mapEl.dataset.browseLongPressBound === '1') return;
    mapEl.dataset.browseLongPressBound = '1';

    mapEl.addEventListener(
      'touchstart',
      function (event) {
        if (event.touches.length !== 1) {
          clearBrowseLongPress();
          return;
        }
        const pin = event.target.closest?.('.amap-browse-pin');
        if (!pin) {
          clearBrowseLongPress();
          return;
        }
        const touch = event.touches[0];
        beginBrowseLongPress(pin.dataset.browseId, touch.clientX, touch.clientY);
      },
      { passive: true },
    );

    mapEl.addEventListener(
      'touchmove',
      function (event) {
        if (!browseLongPressStart || !event.touches[0]) return;
        const touch = event.touches[0];
        moveBrowseLongPress(touch.clientX, touch.clientY);
      },
      { passive: true },
    );

    mapEl.addEventListener('touchend', clearBrowseLongPress, { passive: true });
    mapEl.addEventListener('touchcancel', clearBrowseLongPress, { passive: true });

    mapEl.addEventListener('mousedown', function (event) {
      if (event.button !== 0) return;
      const pin = event.target.closest?.('.amap-browse-pin');
      if (!pin) {
        clearBrowseLongPress();
        return;
      }
      beginBrowseLongPress(pin.dataset.browseId, event.clientX, event.clientY);
    });

    mapEl.addEventListener('mousemove', function (event) {
      if (!browseLongPressStart) return;
      moveBrowseLongPress(event.clientX, event.clientY);
    });

    mapEl.addEventListener('mouseup', clearBrowseLongPress);
    mapEl.addEventListener('mouseleave', clearBrowseLongPress);
  }

  function handleBrowseMarkerClick(entry) {
    browseMarkerClickLock = true;
    window.setTimeout(function () {
      browseMarkerClickLock = false;
    }, 50);
    clearBrowseLongPress();

    const id = String(entry.place.id);
    // 已放大固定：短按保持，进详情改为长按
    if (browsePinnedPlaceId != null && browsePinnedPlaceId === id) {
      return;
    }

    // 第一次点 / 点另一家：仅放大固定，不移动地图、不进详情
    browsePinnedPlaceId = id;
    browsePinAt = Date.now();
    browseHoverPlaceId = null;
    focusBrowsePlace(entry.place);
  }

  function getBrowseMarkerDom(marker) {
    return marker?.dom || marker?.getContentDom?.() || null;
  }

  function setBrowseMarkerHover(placeId) {
    // 有固定放大时忽略悬停预览
    if (browsePinnedPlaceId != null) {
      if (browseHoverPlaceId != null) {
        browseHoverPlaceId = null;
        applyBrowseMarkerActiveState();
      }
      return;
    }
    const nextId = placeId != null ? String(placeId) : null;
    if (browseHoverPlaceId === nextId) return;
    browseHoverPlaceId = nextId;
    applyBrowseMarkerActiveState();
  }

  function requestBrowseMarkerHover(placeId) {
    if (browsePinnedPlaceId != null) {
      if (browseHoverSwitchTimer) {
        clearTimeout(browseHoverSwitchTimer);
        browseHoverSwitchTimer = null;
      }
      if (browseHoverClearTimer) {
        clearTimeout(browseHoverClearTimer);
        browseHoverClearTimer = null;
      }
      if (browseHoverPlaceId != null) {
        browseHoverPlaceId = null;
        applyBrowseMarkerActiveState();
      }
      return;
    }
    const nextId = placeId != null ? String(placeId) : null;
    if (browseHoverClearTimer) {
      clearTimeout(browseHoverClearTimer);
      browseHoverClearTimer = null;
    }
    if (browseHoverPlaceId === nextId) {
      if (browseHoverSwitchTimer) {
        clearTimeout(browseHoverSwitchTimer);
        browseHoverSwitchTimer = null;
      }
      return;
    }
    if (browseHoverSwitchTimer) {
      clearTimeout(browseHoverSwitchTimer);
      browseHoverSwitchTimer = null;
    }
    // 首次放大、离开缩小：立刻生效；只对「换另一家」轻微防抖
    if (browseHoverPlaceId == null || nextId == null) {
      setBrowseMarkerHover(nextId);
      return;
    }
    browseHoverSwitchTimer = setTimeout(function () {
      browseHoverSwitchTimer = null;
      setBrowseMarkerHover(nextId);
    }, BROWSE_HOVER_SWITCH_MS);
  }

  function scheduleBrowseHoverClear() {
    if (browsePinnedPlaceId != null) return;
    if (browseHoverPlaceId == null) return;
    if (browseHoverClearTimer) return;
    browseHoverClearTimer = setTimeout(function () {
      browseHoverClearTimer = null;
      requestBrowseMarkerHover(null);
    }, BROWSE_HOVER_CLEAR_MS);
  }

  function findBrowsePinNode(node) {
    if (!node || !node.nodeType) return null;
    // 红钉本体，或招牌文字都算命中该标记
    if (node.classList?.contains('amap-browse-pin')) return node;
    if (node.classList?.contains('amap-browse-pin-label')) {
      return node.closest?.('.amap-browse-pin') || null;
    }
    if (node.classList?.contains('amap-browse-pin-needle')) {
      return node.closest?.('.amap-browse-pin') || null;
    }
    const fromClosest = node.closest?.('.amap-browse-pin');
    if (fromClosest) return fromClosest;
    return null;
  }

  function resolveBrowseHoverFromPoint(clientX, clientY) {
    if (clientX == null || clientY == null) return null;
    const stack = document.elementsFromPoint
      ? document.elementsFromPoint(clientX, clientY)
      : [document.elementFromPoint(clientX, clientY)].filter(Boolean);
    const hits = [];
    const seen = Object.create(null);
    for (let i = 0; i < stack.length; i++) {
      const pin = findBrowsePinNode(stack[i]);
      if (!pin) continue;
      const id = pin.dataset?.browseId;
      if (id == null || seen[id]) continue;
      seen[id] = true;
      const entry = browseMarkers.find(function (e) {
        return String(e.place.id) === String(id);
      });
      if (entry) hits.push(entry);
    }
    if (!hits.length) return null;
    // 放大后命中盒也变大：指针仍在当前放大项上时优先粘住
    const stickyId = getBrowseVisualActiveId();
    if (stickyId != null) {
      for (let j = 0; j < hits.length; j++) {
        if (String(hits[j].place.id) === String(stickyId)) {
          return hits[j];
        }
      }
    }
    return hits[0];
  }

  function bindBrowseMarkerHover() {
    if (!browseMap) return;
    browseMarkers.forEach(function (entry) {
      entry.marker.on('mouseover', function () {
        requestBrowseMarkerHover(entry.place.id);
      });
      entry.marker.on('mouseout', function (event) {
        const origin = event?.originEvent || event;
        const related = origin?.relatedTarget;
        if (related) {
          const relatedPin = findBrowsePinNode(related);
          if (relatedPin && String(relatedPin.dataset?.browseId) === String(entry.place.id)) {
            return;
          }
        }
        const x = origin?.clientX;
        const y = origin?.clientY;
        if (x != null && y != null) {
          const hit = resolveBrowseHoverFromPoint(x, y);
          // 还在放大后的命中框内 → 保持；真正离开 → 立刻缩小
          if (hit && String(hit.place.id) === String(entry.place.id)) return;
          requestBrowseMarkerHover(hit ? hit.place.id : null);
          return;
        }
        if (browseHoverPlaceId != null && String(browseHoverPlaceId) === String(entry.place.id)) {
          requestBrowseMarkerHover(null);
        }
      });
    });
    browseMap.on('mousemove', function (event) {
      const origin = event?.originEvent || event;
      const x = origin?.clientX;
      const y = origin?.clientY;
      if (x == null || y == null) return;
      const hit = resolveBrowseHoverFromPoint(x, y);
      if (hit) {
        requestBrowseMarkerHover(hit.place.id);
        return;
      }
      // 探测不到：可能是真离开，也可能短暂打到画布；短延迟后再缩，避免误抖
      scheduleBrowseHoverClear();
    });
    browseMap.on('mouseout', function () {
      requestBrowseMarkerHover(null);
    });
  }

  function focusBrowsePlace(place) {
    if (!browseMap || !place) return;
    const placeId = String(place.id);
    if (browsePinnedPlaceId == null) {
      browsePinnedPlaceId = placeId;
    }
    // 只放大招牌，不改地图中心/缩放（以用户当前视野为准）
    if (browseHoverClearTimer) {
      clearTimeout(browseHoverClearTimer);
      browseHoverClearTimer = null;
    }
    if (browseHoverSwitchTimer) {
      clearTimeout(browseHoverSwitchTimer);
      browseHoverSwitchTimer = null;
    }
    browseHoverPlaceId = null;
    browseMarkers.forEach(function (item) {
      const active = String(item.place.id) === placeId;
      const n = (item.neighbors && item.neighbors.length) || 1;
      item.marker.setContent(createBrowseMarkerContent(item.place, active, n));
      syncBrowseMarkerAnchor(item.marker);
    });
    applyBrowseMarkerActiveState();
  }

  function fitBrowseMarkers() {
    if (!browseMap || !browseMarkers.length) return;
    try {
      browseMap.setFitView(
        browseMarkers.map(function (e) {
          return e.marker;
        }),
        false,
        [72, 72, 72, 72],
      );
    } catch (_err) {
      /* ignore */
    }
  }

  function initBrowseMap() {
    const AMap = global.AMap;
    const mapEl = browseOverlayEl.querySelector('#amap-browse-map');
    const emptyEl = browseOverlayEl.querySelector('#amap-browse-empty');
    destroyBrowseMapInstance();
    if (!mapEl) return;

    const layouts = layoutBrowsePlaces(browsePlaces);
    const center =
      layouts.length > 0
        ? [layouts[0].lng, layouts[0].lat]
        : DEFAULT_CENTER;

    browseMap = new AMap.Map(mapEl, {
      zoom: layouts.length ? 14 : 11,
      center: center,
      viewMode: '2D',
      showIndoorMap: false,
      mapStyle: 'amap://styles/normal',
      touchZoom: true,
      touchZoomCenter: 1,
      dragEnable: true,
    });

    browseMarkers = layouts.map(function (layout) {
      const neighborCount = layout.neighbors.length;
      const marker = new AMap.Marker({
        position: [layout.lng, layout.lat],
        // 仅用 offset：内容盒底边中点=针尖（勿再叠加 anchor，避免双重偏移）
        offset: browseMarkerOffset(AMap),
        content: createBrowseMarkerContent(layout.place, false, neighborCount),
        title: layout.place.title || '',
        zIndex: 100 + neighborCount,
      });
      const entry = {
        marker: marker,
        place: layout.place,
        lng: layout.lng,
        lat: layout.lat,
        neighbors: layout.neighbors,
      };
      marker.on('click', function () {
        handleBrowseMarkerClick(entry);
      });
      browseMap.add(marker);
      return entry;
    });

    browseMap.on('click', function () {
      // 点空白处取消固定放大；点标记时由 marker click 处理
      if (browseMarkerClickLock) return;
      clearBrowseLongPress();
      clearBrowsePinnedPlace();
    });

    browseMap.on('dragging', clearBrowseLongPress);
    browseMap.on('zoomstart', clearBrowseLongPress);
    bindBrowseMarkerLongPress(mapEl);
    bindBrowseMarkerHover();

    if (emptyEl) emptyEl.hidden = browsePlaces.length > 0;

    requestAnimationFrame(function () {
      try {
        browseMap.resize();
        browseMarkers.forEach(function (entry) {
          syncBrowseMarkerAnchor(entry.marker);
        });
        if (browseMarkers.length) {
          browseMap.setFitView(
            browseMarkers.map(function (e) {
              return e.marker;
            }),
            false,
            [72, 72, 72, 72],
          );
        }
      } catch (_err) {
        /* ignore */
      }
      // 再同步一次：fitView / 布局稳定后针尖更准
      requestAnimationFrame(function () {
        browseMarkers.forEach(function (entry) {
          syncBrowseMarkerAnchor(entry.marker);
        });
        fitBrowseMarkers();
      });
    });
  }

  function openBrowseMap(options) {
    const opts = options || {};
    if (!hasKey()) {
      return Promise.reject(new Error('尚未配置高德 Key'));
    }

    // 选点与浏览互斥
    if (isOpen()) closePicker(null);

    browsePlaces = Array.isArray(opts.places) ? opts.places.slice() : [];
    browseOnSelect = typeof opts.onSelect === 'function' ? opts.onSelect : null;

    ensureBrowseOverlay();
    document.body.classList.add('amap-browse-open');
    if (!browseOverlayEl.open) {
      browseOverlayEl.showModal();
    }

    return loadAmapSdk()
      .then(function () {
        return new Promise(function (resolve) {
          requestAnimationFrame(function () {
            requestAnimationFrame(function () {
              initBrowseMap();
              resolve(true);
            });
          });
        });
      })
      .catch(function (error) {
        closeBrowseMap();
        return Promise.reject(error);
      });
  }

  // 缩略小地图实例（详情/编辑页）
  const miniMaps = new Map();

  function destroyMiniMap(container) {
    if (!container) return;
    const entry = miniMaps.get(container);
    if (entry) {
      try {
        entry.map.destroy();
      } catch (_err) {
        /* ignore */
      }
      miniMaps.delete(container);
    }
    container.innerHTML = '';
  }

  function destroyAllMiniMaps() {
    miniMaps.forEach(function (_entry, container) {
      destroyMiniMap(container);
    });
  }

  // 详情/编辑缩略图：与地图浏览同一套红色钉
  function createMiniMapRedPinContent() {
    return (
      '<div class="shop-mini-map-pin" aria-hidden="true">' +
      '<span class="amap-browse-pin-needle"></span>' +
      '</div>'
    );
  }

  function mountMiniMap(container, options) {
    const opts = options || {};
    const lng = opts.lng != null ? Number(opts.lng) : NaN;
    const lat = opts.lat != null ? Number(opts.lat) : NaN;
    if (!container || !Number.isFinite(lng) || !Number.isFinite(lat)) {
      return Promise.resolve(null);
    }
    if (!hasKey()) return Promise.resolve(null);

    destroyMiniMap(container);
    container.innerHTML = '';
    const mapEl = document.createElement('div');
    mapEl.className = 'shop-map-thumb-canvas';
    container.appendChild(mapEl);

    return loadAmapSdk()
      .then(function (AMap) {
        // 容器可能已被换掉
        if (!container.isConnected) return null;
        const center = [lng, lat];
        const miniMap = new AMap.Map(mapEl, {
          zoom: opts.zoom || 16,
          center: center,
          viewMode: '2D',
          dragEnable: false,
          zoomEnable: false,
          doubleClickZoom: false,
          scrollWheel: false,
          touchZoom: false,
          keyboardEnable: false,
          rotateEnable: false,
          pitchEnable: false,
          showIndoorMap: false,
          mapStyle: 'amap://styles/normal',
        });
        const miniMarker = new AMap.Marker({
          position: center,
          offset: new AMap.Pixel(-12, -34),
          content: createMiniMapRedPinContent(),
          zIndex: 120,
        });
        miniMap.add(miniMarker);
        miniMaps.set(container, { map: miniMap, marker: miniMarker });
        // 尺寸稳定后再重绘一次，避免缩略图空白
        requestAnimationFrame(function () {
          try {
            miniMap.resize();
            miniMap.setCenter(center);
          } catch (_err) {
            /* ignore */
          }
        });
        return miniMap;
      })
      .catch(function () {
        container.innerHTML = '';
        return null;
      });
  }

  global.AmapPicker = {
    open: openAmapPicker,
    openBrowseMap: openBrowseMap,
    closeBrowseMap: closeBrowseMap,
    resizeBrowseMap: resizeBrowseMap,
    hasKey: hasKey,
    isOpen: isOpen,
    isBrowseMapOpen: isBrowseMapOpen,
    cancelIfOpen: cancelIfOpen,
    loadSdk: loadAmapSdk,
    mountMiniMap: mountMiniMap,
    destroyMiniMap: destroyMiniMap,
    destroyAllMiniMaps: destroyAllMiniMaps,
  };
})(window);
