(function () {
  'use strict';

  /* ========== Shared utilities ========== */
  const PRODUCT_STORAGE_KEY = 'shopping-ratings';
  const SHOP_STORAGE_KEY = 'nearbyShops';
  const UNIFIED_MIGRATION_KEY = 'unified-format-migrated-v1';
  const CARD_CLICK_DRAG_THRESHOLD = 5;

  let browseFilter = 'all';
  let selectedDetail = null;
  let searchAddPendingQuery = null;
  let appMessageResolver = null;
  let appMessageIsConfirm = false;

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function normalizeRating(value) {
    const n = Math.round(Number(value) * 2) / 2;
    if (isNaN(n)) return 3;
    if (n <= 0) return 0;
    return Math.min(5, Math.max(0.5, n));
  }

  function ratingOrDefault(value, fallback = 3) {
    if (value === '' || value == null) return fallback;
    const n = Number(value);
    if (isNaN(n)) return fallback;
    return normalizeRating(n);
  }

  function isLowRating(value) {
    const r = Number(value);
    return r > 0 && r <= 2;
  }

  function formatRating(rating) {
    const r = normalizeRating(rating);
    if (r <= 0) return '待定';
    return Number.isInteger(r) ? String(r) : r.toFixed(1);
  }

  function formatRatingLabel(rating) {
    const r = ratingOrDefault(rating, 0);
    return r > 0 ? `${formatRating(r)} 星` : '待定';
  }

  function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function closeAppMessageDialog(result) {
    const dialog = $('#app-message-dialog');
    const resolved = appMessageIsConfirm ? result : true;
    if (dialog?.open) dialog.close();
    if (appMessageResolver) {
      appMessageResolver(resolved);
      appMessageResolver = null;
    }
    appMessageIsConfirm = false;
  }

  function highlightDeleteWords(text) {
    return escapeHtml(text || '').replace(/删除/g, '<span class="text-danger-em">删除</span>');
  }

  function showAppMessageDialog({ message, title = '提示', confirmText = '确定', cancelText = '取消', showCancel = false }) {
    const dialog = $('#app-message-dialog');
    if (!dialog) {
      if (showCancel) return Promise.resolve(window.confirm(message));
      window.alert(message);
      return Promise.resolve(true);
    }
    return new Promise((resolve) => {
      appMessageResolver = resolve;
      appMessageIsConfirm = showCancel;
      const titleEl = $('#app-message-dialog-title');
      const textEl = $('#app-message-dialog-text');
      const hasDeleteWord = String(title).includes('删除') || String(message).includes('删除');
      if (hasDeleteWord) {
        if (titleEl) titleEl.innerHTML = highlightDeleteWords(title);
        if (textEl) textEl.innerHTML = highlightDeleteWords(message);
        dialog.classList.add('dialog-prompt-danger');
      } else {
        if (titleEl) titleEl.textContent = title;
        if (textEl) textEl.textContent = message;
        dialog.classList.remove('dialog-prompt-danger');
      }
      $('#app-message-dialog-ok').textContent = confirmText;
      const cancelBtn = $('#app-message-dialog-cancel');
      cancelBtn.hidden = !showCancel;
      cancelBtn.textContent = cancelText;
      dialog.showModal();
      $('#app-message-dialog-ok')?.focus();
    });
  }

  function showAppAlert(message, title = '提示') {
    return showAppMessageDialog({ message, title, showCancel: false });
  }

  function showAppConfirm(message, title = '请确认') {
    return showAppMessageDialog({
      message,
      title,
      showCancel: true,
      confirmText: '确定',
      cancelText: '取消',
    });
  }

  function setStarsState(starContainer, hiddenInput, ratingDisplayEl, value, defaultWhenEmpty) {
    const v = ratingOrDefault(value, defaultWhenEmpty ?? 0);
    if (hiddenInput) hiddenInput.value = String(v);
    if (ratingDisplayEl) {
      ratingDisplayEl.textContent = formatRatingLabel(v);
      ratingDisplayEl.classList.toggle('is-pending', v <= 0);
    }
    if (!starContainer) return;
    starContainer.querySelectorAll('.star').forEach((star) => {
      const starValue = Number(star.dataset.value);
      star.classList.remove('active', 'half');
      if (v >= starValue) star.classList.add('active');
      else if (v >= starValue - 0.5) star.classList.add('half');
    });
    const wrap = starContainer.closest('.star-rating-wrap');
    wrap?.querySelectorAll('.rating-pending-btn').forEach((btn) => {
      const pending = v <= 0;
      btn.classList.toggle('active', pending);
      btn.setAttribute('aria-pressed', pending ? 'true' : 'false');
    });
  }

  function bindStarRating(starContainer, hiddenInput, ratingDisplayEl, defaultWhenEmpty) {
    starContainer.querySelectorAll('.star').forEach((star) => {
      star.addEventListener('click', (event) => {
        event.stopPropagation();
        const rect = star.getBoundingClientRect();
        const isHalf = event.clientX - rect.left < rect.width / 2;
        const base = Number(star.dataset.value);
        setStarsState(starContainer, hiddenInput, ratingDisplayEl, isHalf ? base - 0.5 : base, defaultWhenEmpty);
      });
    });
    const wrap = starContainer.closest('.star-rating-wrap');
    wrap?.querySelectorAll('.rating-pending-btn').forEach((btn) => {
      btn.addEventListener('click', (event) => {
        event.stopPropagation();
        setStarsState(starContainer, hiddenInput, ratingDisplayEl, 0, 0);
      });
    });
    return (value) => setStarsState(starContainer, hiddenInput, ratingDisplayEl, value, defaultWhenEmpty);
  }

  function renderStarsDisplay(value, lowClass) {
    const r = Number(value) > 0 ? normalizeRating(value) : 0;
    if (r <= 0) {
      return `<span class="item-stars pending"><span class="rating-pending-label">待定</span></span>`;
    }
    const parts = [];
    for (let i = 1; i <= 5; i++) {
      if (r >= i) parts.push('<span class="star-icon full">★</span>');
      else if (r >= i - 0.5) parts.push('<span class="star-icon half">★</span>');
      else parts.push('<span class="star-icon empty">☆</span>');
    }
    return `<span class="item-stars${lowClass ? ' low' : ''}">${parts.join('')}<span class="rating-num">${formatRating(r)}星</span></span>`;
  }

  function createInteractiveStars(id, type, value, index) {
    const score = Number(value) > 0 ? normalizeRating(value) : 0;
    let buttons = '';
    for (let i = 1; i <= 5; i++) {
      let cls = 'star';
      if (score >= i) cls += ' active';
      else if (score >= i - 0.5) cls += ' half';
      buttons += `<button type="button" class="${cls}" data-value="${i}">★</button>`;
    }
    const ratingText = score > 0 ? `${formatRating(score)}星` : '待定';
    const indexAttr = index != null ? ` data-index="${index}"` : '';
    return `<span class="star-rating rateable" data-id="${escapeHtml(id)}" data-type="${type}"${indexAttr}>${buttons}<span class="rating-num">${ratingText}</span></span>`;
  }

  function renderRatingEditorHtml(score, options = {}) {
    const ratingId = options.ratingId || '';
    const currentId = options.currentId || '';
    const hiddenId = options.hiddenId || '';
    const starClass = options.starClass || '';
    const currentClass = options.currentClass || '';
    const hiddenClass = options.hiddenClass || '';
    const value = ratingOrDefault(score, 3);
    let starButtons = '';
    for (let i = 1; i <= 5; i++) {
      let cls = 'star';
      if (value >= i) cls += ' active';
      else if (value >= i - 0.5) cls += ' half';
      starButtons += `<button type="button" class="${cls}" data-value="${i}" aria-label="${i}星">★</button>`;
    }
    const pendingActive = value <= 0 ? ' active' : '';
    return `
      <div class="star-rating-wrap">
        <div class="star-rating${starClass ? ` ${starClass}` : ''}"${ratingId ? ` id="${ratingId}"` : ''}>
          ${starButtons}
        </div>
        <button type="button" class="rating-pending-btn${pendingActive}" aria-pressed="${value <= 0 ? 'true' : 'false'}">待定</button>
        <span class="rating-current${currentClass ? ` ${currentClass}` : ''}${value <= 0 ? ' is-pending' : ''}"${currentId ? ` id="${currentId}"` : ''}>${formatRatingLabel(value)}</span>
      </div>
      <input type="hidden"${hiddenId ? ` id="${hiddenId}"` : ''}${hiddenClass ? ` class="${hiddenClass}"` : ''} value="${value}">
    `;
  }

  function hasSelectedText() {
    const selection = window.getSelection();
    return Boolean(selection && selection.toString().trim());
  }

  function isCardDragClick(event, pressPoint) {
    if (!pressPoint) return false;
    return (
      Math.abs(event.clientX - pressPoint.x) > CARD_CLICK_DRAG_THRESHOLD ||
      Math.abs(event.clientY - pressPoint.y) > CARD_CLICK_DRAG_THRESHOLD
    );
  }

  function shouldOpenFromCardClick(event, pressPoint) {
    if (event.target.closest('.brand-product-row')) {
      // 必须先有按压点：地图点开详情后的幽灵 click 没有 dialog 内的 touch/mousedown
      if (!pressPoint) return false;
      if (hasSelectedText()) return false;
      if (isCardDragClick(event, pressPoint)) return false;
      return true;
    }
    if (event.target.closest('.star-rating.rateable') || event.target.closest('button') || event.target.closest('a')) {
      return false;
    }
    if (hasSelectedText()) return false;
    if (isCardDragClick(event, pressPoint)) return false;
    return true;
  }

  function createClickGuard() {
    let pressPoint = null;
    let blockNextClick = false;

    return {
      onMouseDown(event, hasTarget) {
        pressPoint = hasTarget ? { x: event.clientX, y: event.clientY } : null;
        blockNextClick = false;
      },
      onMouseUp(event) {
        if (!pressPoint) return;
        if (hasSelectedText() || isCardDragClick(event, pressPoint)) {
          blockNextClick = true;
        }
      },
      shouldHandleClick(event) {
        if (blockNextClick) {
          blockNextClick = false;
          pressPoint = null;
          return false;
        }
        const ok = shouldOpenFromCardClick(event, pressPoint);
        pressPoint = null;
        return ok;
      },
    };
  }

  /* ========== Product module ========== */
  let items = loadItems();
  let shops = [];

  function loadShops() {
    try {
      const saved = localStorage.getItem(SHOP_STORAGE_KEY);
      shops = saved ? JSON.parse(saved) : [];
      shops = shops.map((s) => {
        if (s.product && !s.products) {
          s.products = [s.product];
          delete s.product;
        }
        return s;
      });
    } catch {
      shops = [];
    }
  }

  loadShops();

  const productEls = {
    detailDialog: $('#detail-dialog'),
    dialogTitle: $('#dialog-title'),
    dialogHeaderName: $('#dialog-header-name'),
    dialogNameInput: $('#dialog-name'),
    dialogHeaderEditBtn: $('#dialog-header-edit-btn'),
    dialogBody: $('#dialog-body'),
    dialogClose: $('#dialog-close'),
    dialogEditBtn: $('#dialog-edit-btn'),
    dialogDeleteBtn: $('#dialog-delete-btn'),
    dialogBrandDeleteBtn: $('#dialog-brand-delete-btn'),
  };

  let dialogEditMode = false;
  let dialogSetStars = null;
  // 从地图浏览点进详情后，短暂忽略小地图点击，避免 APP 穿透误开选点页
  let suppressBrandMapThumbUntil = 0;
  // 同时屏蔽详情内商品行/底部按钮，避免幽灵点击直接跳进商品编辑
  let suppressDetailInteractionUntil = 0;

  function armDetailGhostClickShield(ms = 750) {
    const until = Date.now() + ms;
    suppressBrandMapThumbUntil = until;
    suppressDetailInteractionUntil = until;
  }

  function isDetailInteractionSuppressed() {
    return Date.now() < suppressDetailInteractionUntil;
  }

  function resetDialogHeader() {
    if (productEls.dialogTitle) {
      productEls.dialogTitle.hidden = false;
    }
    if (productEls.dialogHeaderName) {
      productEls.dialogHeaderName.hidden = true;
    }
    if (productEls.dialogNameInput) {
      productEls.dialogNameInput.value = '';
    }
    if (productEls.dialogHeaderEditBtn) {
      productEls.dialogHeaderEditBtn.hidden = true;
    }
  }

  function showDialogTitle(text) {
    resetDialogHeader();
    if (productEls.dialogTitle) {
      productEls.dialogTitle.textContent = text || '详情';
      productEls.dialogTitle.hidden = false;
    }
  }

  function showDialogNameField(value) {
    if (productEls.dialogTitle) {
      productEls.dialogTitle.hidden = true;
    }
    if (productEls.dialogHeaderName) {
      productEls.dialogHeaderName.hidden = false;
    }
    if (productEls.dialogNameInput) {
      productEls.dialogNameInput.value = value || '';
    }
    if (productEls.dialogHeaderEditBtn) {
      productEls.dialogHeaderEditBtn.hidden = true;
    }
  }

  function setDialogViewMode() {
    dialogEditMode = false;
    dialogSetStars = null;
    productEls.dialogEditBtn.textContent = '编辑';
    productEls.dialogEditBtn.className = 'btn btn-primary';
    productEls.dialogEditBtn.hidden = false;
    productEls.dialogDeleteBtn.textContent = '删除';
    productEls.dialogDeleteBtn.className = 'btn btn-danger';
    productEls.dialogDeleteBtn.hidden = false;
    productEls.detailDialog.classList.remove('dialog-editing', 'dialog-renaming');
    if (productEls.dialogHeaderEditBtn) {
      productEls.dialogHeaderEditBtn.hidden = true;
    }
    if (productEls.dialogBrandDeleteBtn) {
      productEls.dialogBrandDeleteBtn.hidden = true;
    }
    if (productEls.dialogHeaderName) {
      productEls.dialogHeaderName.hidden = true;
    }
    if (productEls.dialogTitle) {
      productEls.dialogTitle.hidden = false;
    }
  }

  function updateDialogUnitPriceDisplay() {
    const box = $('#dialog-unit-price-box');
    const display = $('#dialog-unit-price-display');
    if (!box || !display) return;
    const priceEl = $('#dialog-price');
    const weightEl = $('#dialog-weight');
    const price = priceEl && priceEl.value !== '' ? parseFloat(priceEl.value) : null;
    const weight = weightEl && weightEl.value !== '' ? parseFloat(weightEl.value) : null;
    const unit = calcUnitPricePerJin(price, weight);
    if (unit != null) {
      box.hidden = false;
      display.textContent = '¥' + unit.toFixed(2) + ' / 斤';
    } else {
      box.hidden = true;
      display.textContent = '—';
    }
  }

  function parseCoord(value) {
    if (value == null || value === '') return null;
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  }

  function formatLocationWithGeo(address, lng, lat) {
    const text = escapeHtml(address) || '—';
    if (parseCoord(lng) == null || parseCoord(lat) == null) return text;
    return `${text} <span class="geo-located-hint">已定位</span>`;
  }

  function renderShopMapThumbHtml({ lng, lat, buttonId }) {
    const hasGeo = parseCoord(lng) != null && parseCoord(lat) != null;
    const idAttr = buttonId ? ` id="${escapeHtml(buttonId)}"` : '';
    const body = hasGeo
      ? `<div class="shop-map-thumb-map" data-lng="${escapeHtml(String(lng))}" data-lat="${escapeHtml(String(lat))}"></div>`
      : `<div class="shop-map-thumb-empty"><span class="shop-map-thumb-pin" aria-hidden="true"></span></div>`;
    return `
      <button type="button" class="shop-map-thumb${hasGeo ? ' has-geo' : ''}"${idAttr} aria-label="打开地图选点">
        ${body}
      </button>
    `;
  }

  function mountShopMapThumb(thumbBtn) {
    if (!thumbBtn || !window.AmapPicker?.mountMiniMap) return;
    const mapHost = thumbBtn.querySelector('.shop-map-thumb-map');
    if (!mapHost) return;
    const lng = parseCoord(mapHost.dataset.lng);
    const lat = parseCoord(mapHost.dataset.lat);
    if (lng == null || lat == null) return;
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        AmapPicker.mountMiniMap(mapHost, { lng, lat, zoom: 16 });
      });
    });
  }

  function refreshShopMapThumbElement(thumbBtn, lng, lat) {
    if (!thumbBtn) return;
    const host = thumbBtn.querySelector('.shop-map-thumb-map');
    if (host && window.AmapPicker?.destroyMiniMap) {
      AmapPicker.destroyMiniMap(host);
    }
    const html = renderShopMapThumbHtml({ lng, lat, buttonId: thumbBtn.id || '' });
    const wrap = document.createElement('div');
    wrap.innerHTML = html.trim();
    const next = wrap.firstElementChild;
    if (!next) return;
    thumbBtn.replaceWith(next);
    mountShopMapThumb(next);
    return next;
  }

  function renderShopLocationFieldHtml({ address, mapAddress, lng, lat }) {
    const hasGeo = parseCoord(lng) != null && parseCoord(lat) != null;
    const official = (mapAddress || '').trim();
    const mapHint = official
      ? `地图官方地址：${escapeHtml(official)}${hasGeo ? ' <span class="geo-located-hint">已定位</span>' : ''}`
      : hasGeo
        ? '已在地图选点（可与上方手填位置不同）'
        : '未选地图位置；与上方手填位置互不影响';
    return `
      <div class="form-row form-row-shop-location">
        <label for="dialog-shop-location">店铺位置</label>
        <input type="text" id="dialog-shop-location" value="${escapeHtml(address || '')}" placeholder="手填方便辨认的位置，例如：建设路李记">
        <p class="field-hint">可随意填写，不必和地图官方地址一致</p>
      </div>
      <div class="form-row form-row-shop-map">
        <label>地图定位</label>
        ${renderShopMapThumbHtml({ lng, lat, buttonId: 'dialog-amap-thumb' })}
        <div class="shop-map-field">
          <button type="button" class="btn btn-secondary btn-sm" id="dialog-amap-pick-btn">打开大图选点</button>
          <button type="button" class="btn btn-secondary btn-sm" id="dialog-amap-clear-btn"${hasGeo || official ? '' : ' hidden'}>清除定位</button>
        </div>
        <input type="hidden" id="dialog-shop-map-address" value="${escapeHtml(official)}">
        <input type="hidden" id="dialog-shop-lng" value="${hasGeo ? escapeHtml(String(lng)) : ''}">
        <input type="hidden" id="dialog-shop-lat" value="${hasGeo ? escapeHtml(String(lat)) : ''}">
        <p class="field-hint shop-location-geo-hint" id="dialog-shop-geo-hint">${mapHint}</p>
      </div>
    `;
  }

  function getShopLocationCoordsFromForm() {
    return {
      lng: parseCoord($('#dialog-shop-lng')?.value),
      lat: parseCoord($('#dialog-shop-lat')?.value),
    };
  }

  function getShopMapAddressFromForm() {
    return ($('#dialog-shop-map-address')?.value || '').trim();
  }

  function updateShopMapHint() {
    const hint = $('#dialog-shop-geo-hint');
    const clearBtn = $('#dialog-amap-clear-btn');
    const coords = getShopLocationCoordsFromForm();
    const official = getShopMapAddressFromForm();
    const hasGeo = coords.lng != null && coords.lat != null;
    if (hint) {
      if (official) {
        hint.innerHTML =
          '地图官方地址：' +
          escapeHtml(official) +
          (hasGeo ? ' <span class="geo-located-hint">已定位</span>' : '');
      } else if (hasGeo) {
        hint.textContent = '已在地图选点（可与上方手填位置不同）';
      } else {
        hint.textContent = '未选地图位置；与上方手填位置互不影响';
      }
    }
    if (clearBtn) clearBtn.hidden = !(hasGeo || official);
    const thumb = $('#dialog-amap-thumb');
    if (thumb) {
      const next = refreshShopMapThumbElement(thumb, coords.lng, coords.lat);
      next?.addEventListener('click', openShopMapPickerFromForm);
    }
  }

  async function openShopMapPickerFromForm() {
    if (!window.AmapPicker?.open) {
      alert('地图选点模块未加载');
      return;
    }
    window.AmapPicker.destroyAllMiniMaps?.();
    const mapAddress = getShopMapAddressFromForm();
    const nick = ($('#dialog-shop-location')?.value || '').trim();
    const lng = parseCoord($('#dialog-shop-lng')?.value);
    const lat = parseCoord($('#dialog-shop-lat')?.value);
    const hasGeo = lng != null && lat != null;
    const result = await AmapPicker.open({
      address: mapAddress || (hasGeo ? nick : ''),
      lng: lng,
      lat: lat,
    });
    if (!result) {
      mountShopMapThumb($('#dialog-amap-thumb'));
      return;
    }
    if ($('#dialog-shop-map-address')) {
      $('#dialog-shop-map-address').value = result.address || '';
    }
    if ($('#dialog-shop-lng')) {
      $('#dialog-shop-lng').value = result.lng != null ? String(result.lng) : '';
    }
    if ($('#dialog-shop-lat')) {
      $('#dialog-shop-lat').value = result.lat != null ? String(result.lat) : '';
    }
    const nickInput = $('#dialog-shop-location');
    if (nickInput && !(nickInput.value || '').trim() && result.address) {
      nickInput.value = result.address;
    }
    updateShopMapHint();
  }

  function bindShopLocationPicker() {
    $('#dialog-amap-pick-btn')?.addEventListener('click', openShopMapPickerFromForm);
    const thumb = $('#dialog-amap-thumb');
    thumb?.addEventListener('click', openShopMapPickerFromForm);
    mountShopMapThumb(thumb);

    $('#dialog-amap-clear-btn')?.addEventListener('click', () => {
      if ($('#dialog-shop-map-address')) $('#dialog-shop-map-address').value = '';
      if ($('#dialog-shop-lng')) $('#dialog-shop-lng').value = '';
      if ($('#dialog-shop-lat')) $('#dialog-shop-lat').value = '';
      updateShopMapHint();
    });
  }

  function renderProductEditForm(item) {
    const unitPrice = formatUnitPrice(item.price, item.weight);
    const showUnitPrice = unitPrice !== '—';
    const showStockFields = hasStockQuantity(item);
    return `
      <form id="dialog-edit-form" class="dialog-edit-form" onsubmit="return false">
        <div class="form-row form-row-key form-row-key-name">
          <label for="dialog-flavor">商品名1</label>
          <input type="text" id="dialog-flavor" value="${escapeHtml(item.flavor || '')}" placeholder="请输入商品名1">
        </div>
        <div class="form-row">
          <label>评分</label>
          ${renderRatingEditorHtml(item.rating, {
            ratingId: 'dialog-star-rating',
            currentId: 'dialog-rating-current',
            hiddenId: 'dialog-rating',
          })}
        </div>
        <div class="form-row form-row-key form-row-key-quantity">
          <label for="dialog-quantity">数量</label>
          <input type="number" id="dialog-quantity" min="1" step="1" value="${item.quantity != null ? item.quantity : ''}">
        </div>
        <div class="form-row form-row-key form-row-key-category" id="dialog-category-row"${showStockFields ? '' : ' hidden'}>
          <label for="dialog-category">分类</label>
          <select id="dialog-category">
            ${renderCategorySelectOptions(item.category)}
          </select>
        </div>
        <div class="form-row form-row-key form-row-key-location" id="dialog-storage-location-row"${showStockFields ? '' : ' hidden'}>
          <label for="dialog-storage-location">所在位置</label>
          <input type="text" id="dialog-storage-location" value="${escapeHtml(item.storageLocation || '')}" placeholder="请输入所在位置">
        </div>
        <div class="form-row form-row-key form-row-key-notes">
          <label for="dialog-notes">备注</label>
          <textarea id="dialog-notes" rows="3" placeholder="可选，仅本商品备注">${escapeHtml(item.notes || '')}</textarea>
        </div>
        <div class="form-row">
          <label for="dialog-price">价格（元）</label>
          <input type="number" id="dialog-price" min="0" step="0.01" value="${item.price != null ? item.price : ''}">
        </div>
        <div class="form-row">
          <label for="dialog-weight">总重量（斤）</label>
          <input type="number" id="dialog-weight" min="0" step="0.01" value="${item.weight != null ? item.weight : ''}">
        </div>
        <div class="form-row">
          <label for="dialog-single-weight">单个重量（克）</label>
          <input type="number" id="dialog-single-weight" min="0" step="1" value="${item.singleWeight != null ? item.singleWeight : ''}">
        </div>
        <div class="unit-price-box" id="dialog-unit-price-box"${showUnitPrice ? '' : ' hidden'}>
          <span class="unit-price-label">单价</span>
          <span class="unit-price-value" id="dialog-unit-price-display">${showUnitPrice ? unitPrice.replace('/斤', ' / 斤') : '—'}</span>
        </div>
        <div id="extra-products-list" class="extra-products-list"></div>
        <button type="button" class="btn btn-primary btn-add-extra-product" id="dialog-add-extra-product">添加新商品</button>
      </form>
    `;
  }

  function renderExtraProductRowHtml(index, item = {}) {
    const flavor = item.flavor || '';
    const score = ratingOrDefault(item.rating, 3);
    const quantity = item.quantity != null ? item.quantity : '';
    const showStockFields = hasStockQuantity(item);
    const price = item.price != null ? item.price : '';
    const productNumber = index + 2;
    return `
      <div class="extra-product-row" data-index="${index}">
        <div class="extra-product-row-header">
          <button type="button" class="extra-product-remove">移除</button>
        </div>
        <div class="form-row form-row-key form-row-key-name">
          <label>商品名${productNumber}</label>
          <input type="text" class="extra-flavor" value="${escapeHtml(flavor)}" placeholder="请输入商品名${productNumber}">
        </div>
        <div class="form-row">
          <label>评分</label>
          ${renderRatingEditorHtml(score, {
            starClass: 'extra-star-rating',
            currentClass: 'extra-rating-current',
            hiddenClass: 'extra-rating',
          })}
        </div>
        <div class="form-row form-row-key form-row-key-quantity">
          <label>数量</label>
          <input type="number" class="extra-quantity" min="1" step="1" value="${quantity}">
        </div>
        <div class="form-row form-row-key form-row-key-category extra-category-row"${showStockFields ? '' : ' hidden'}>
          <label>分类</label>
          <select class="extra-category">
            ${renderCategorySelectOptions(item.category)}
          </select>
        </div>
        <div class="form-row form-row-key form-row-key-location extra-storage-location-row"${showStockFields ? '' : ' hidden'}>
          <label>所在位置</label>
          <input type="text" class="extra-storage-location" value="${escapeHtml(item.storageLocation || '')}" placeholder="请输入所在位置">
        </div>
        <div class="form-row form-row-key form-row-key-notes">
          <label>备注</label>
          <textarea class="extra-notes" rows="2" placeholder="可选，仅本商品备注">${escapeHtml(item.notes || '')}</textarea>
        </div>
        <div class="form-row">
          <label>价格（元）</label>
          <input type="number" class="extra-price" min="0" step="0.01" value="${price}">
        </div>
      </div>
    `;
  }

  function bindExtraProductRow(row, rating = 3) {
    const starContainer = row.querySelector('.extra-star-rating');
    const hiddenInput = row.querySelector('.extra-rating');
    const ratingDisplay = row.querySelector('.extra-rating-current');
    bindStarRating(starContainer, hiddenInput, ratingDisplay, 3)(ratingOrDefault(rating, 3));
    bindStockDependentFields(
      row.querySelector('.extra-quantity'),
      row.querySelector('.extra-category-row'),
      row.querySelector('.extra-storage-location-row'),
    );
    row.querySelector('.extra-product-remove')?.addEventListener('click', () => {
      row.remove();
      refreshProductNameLabels();
    });
  }

  function refreshProductNameLabels() {
    const mainLabel = $('#dialog-flavor')?.closest('.form-row')?.querySelector('label');
    const mainInput = $('#dialog-flavor');
    if (mainLabel) mainLabel.textContent = '商品名1';
    if (mainInput) mainInput.placeholder = '请输入商品名1';
    document.querySelectorAll('.extra-product-row').forEach((row, index) => {
      const number = index + 2;
      const label = row.querySelector('.form-row label');
      const input = row.querySelector('.extra-flavor');
      if (label) label.textContent = `商品名${number}`;
      if (input) input.placeholder = `请输入商品名${number}`;
      row.dataset.index = String(index);
    });
  }

  function addExtraProductRow(item = {}) {
    const list = $('#extra-products-list');
    if (!list) return;
    const index = list.querySelectorAll('.extra-product-row').length;
    const wrapper = document.createElement('div');
    wrapper.innerHTML = renderExtraProductRowHtml(index, item);
    const row = wrapper.firstElementChild;
    list.appendChild(row);
    bindExtraProductRow(row, ratingOrDefault(item.rating, 3));
    row.querySelector('.extra-flavor')?.focus();
  }

  function getExtraProductsFormData() {
    return [...document.querySelectorAll('.extra-product-row')]
      .map((row) =>
        sanitizeProductStockFields({
          flavor: (row.querySelector('.extra-flavor')?.value || '').trim(),
          category: (row.querySelector('.extra-category')?.value || '').trim(),
          storageLocation: (row.querySelector('.extra-storage-location')?.value || '').trim(),
          quantity:
            row.querySelector('.extra-quantity')?.value !== ''
              ? parseInt(row.querySelector('.extra-quantity').value, 10)
              : null,
          price:
            row.querySelector('.extra-price')?.value !== ''
              ? parseFloat(row.querySelector('.extra-price').value)
              : null,
          rating: ratingOrDefault(row.querySelector('.extra-rating')?.value, 3),
          notes: (row.querySelector('.extra-notes')?.value || '').trim(),
        }),
      )
      .filter((item) => item.flavor);
  }

  function buildAdditionalProductData(baseData, extra, now) {
    return {
      id: generateId(),
      name: baseData.name,
      shopInstanceId: baseData.shopInstanceId || generateId(),
      brand: '',
      flavor: extra.flavor,
      category: hasStockQuantity(extra) ? (extra.category || '').trim() : '',
      storageLocation: hasStockQuantity(extra) ? (extra.storageLocation || '').trim() : '',
      quantity: extra.quantity,
      shopName: '',
      shopLocation: baseData.shopLocation || '',
      shopMapAddress: baseData.shopMapAddress || '',
      shopLng: baseData.shopLng ?? null,
      shopLat: baseData.shopLat ?? null,
      price: extra.price,
      weight: null,
      singleWeight: null,
      rating: extra.rating,
      notes: (extra.notes || '').trim(),
      createdAt: now,
      updatedAt: now,
    };
  }

  function hasMainProductContent(data) {
    const sanitized = sanitizeProductStockFields(data);
    return Boolean(
      sanitized.flavor ||
        sanitized.quantity != null ||
        sanitized.shopLocation ||
        sanitized.price != null ||
        sanitized.weight != null ||
        sanitized.singleWeight != null,
    );
  }

  function finishProductSave(brand, shopInstanceId) {
    setDialogViewMode();
    const group = findBrandGroup(brand, shopInstanceId);
    if (group) showBrandDetail(group);
    else closeDetailDialog();
    renderBrowse();
  }

  function bindDialogProductEdit(item) {
    const starContainer = $('#dialog-star-rating');
    const hiddenInput = $('#dialog-rating');
    const ratingDisplay = $('#dialog-rating-current');
    dialogSetStars = bindStarRating(starContainer, hiddenInput, ratingDisplay, 3);
    dialogSetStars(ratingOrDefault(item.rating, 3));
    const priceEl = $('#dialog-price');
    const weightEl = $('#dialog-weight');
    if (priceEl) priceEl.addEventListener('input', updateDialogUnitPriceDisplay);
    if (weightEl) weightEl.addEventListener('input', updateDialogUnitPriceDisplay);
    bindStockDependentFields(
      $('#dialog-quantity'),
      $('#dialog-category-row'),
      $('#dialog-storage-location-row'),
    );
    $('#dialog-add-extra-product')?.addEventListener('click', () => addExtraProductRow());
  }

  function getDialogProductFormData() {
    // 编辑页已去掉店铺位置；保存时保留原有定位，避免被清空
    const existing =
      selectedDetail?.type === 'product' && selectedDetail.id && !selectedDetail.isNew
        ? items.find((i) => i.id === selectedDetail.id)
        : null;
    const shopInfo = existing ? getProductShopInfo(existing) : null;
    const name =
      (selectedDetail?.brand || '').trim() ||
      (existing ? getBrandName(existing) : '') ||
      (productEls.dialogNameInput?.value || $('#dialog-name')?.value || '').trim();
    const shopInstanceId =
      (selectedDetail?.shopInstanceId || '').trim() ||
      (existing ? getShopInstanceId(existing) : '') ||
      generateId();
    return sanitizeProductStockFields({
      name,
      shopInstanceId,
      brand: '',
      flavor: ($('#dialog-flavor')?.value || '').trim(),
      category: ($('#dialog-category')?.value || '').trim(),
      storageLocation: ($('#dialog-storage-location')?.value || '').trim(),
      quantity: $('#dialog-quantity')?.value !== '' ? parseInt($('#dialog-quantity').value, 10) : null,
      shopName: '',
      shopLocation: shopInfo?.shopLocation || '',
      shopMapAddress: shopInfo?.shopMapAddress || '',
      shopLng: shopInfo?.shopLng ?? null,
      shopLat: shopInfo?.shopLat ?? null,
      price: $('#dialog-price')?.value !== '' ? parseFloat($('#dialog-price').value) : null,
      weight: $('#dialog-weight')?.value !== '' ? parseFloat($('#dialog-weight').value) : null,
      singleWeight: $('#dialog-single-weight')?.value !== '' ? parseFloat($('#dialog-single-weight').value) : null,
      rating: ratingOrDefault($('#dialog-rating')?.value, 3),
      notes: ($('#dialog-notes')?.value || '').trim(),
    });
  }

  function showProductEditDialog(item) {
    const editItem = resolveEditItem(item);
    dialogEditMode = true;
    selectedDetail = {
      type: 'product',
      id: editItem.id,
      brand: getBrandName(editItem),
      shopInstanceId: getShopInstanceId(editItem),
    };
    showDialogTitle(getBrandName(editItem));
    window.AmapPicker?.destroyAllMiniMaps?.();
    productEls.dialogBody.innerHTML = renderProductEditForm(editItem);
    bindDialogProductEdit(editItem);
    productEls.dialogEditBtn.textContent = '保存';
    productEls.dialogEditBtn.className = 'btn btn-primary';
    productEls.dialogEditBtn.hidden = false;
    productEls.dialogDeleteBtn.textContent = '删除';
    productEls.dialogDeleteBtn.className = 'btn btn-danger';
    productEls.dialogDeleteBtn.hidden = false;
    productEls.detailDialog.classList.add('dialog-editing');
    if (!productEls.detailDialog.open) productEls.detailDialog.showModal();
    $('#dialog-flavor')?.focus();
  }

  function resolveEditItem(item) {
    if (!item) return item;
    const stored = items.find((i) => i.id === item.id);
    if (stored) return stored;
    if (item.id && String(item.id).includes(':')) {
      const matched = items.find(
        (i) =>
          getBrandName(i) === getBrandName(item) &&
          (i.flavor || '') === (item.flavor || '') &&
          (i.shopLocation || '') === (item.shopLocation || getProductShopInfo(item).shopLocation || ''),
      );
      if (matched) return matched;
    }
    return item;
  }

  async function saveProductFromDialog() {
    if (!selectedDetail || selectedDetail.type !== 'product') return;
    const data = getDialogProductFormData();
    const extras = getExtraProductsFormData();
    if (!data.name) {
      productEls.dialogNameInput?.focus();
      return;
    }
    if (!hasMainProductContent(data) && !extras.length) {
      $('#dialog-flavor')?.focus();
      return;
    }
    if (hasStockQuantity(data) && !(await validateMainProductStockFields(data))) {
      return;
    }
    if (!(await validateExtraProductRowsStockFields())) {
      return;
    }
    const now = new Date().toISOString();
    const brand = selectedDetail.brand || data.name;
    const shopInstanceId = selectedDetail.shopInstanceId || data.shopInstanceId;

    if (selectedDetail.isNew) {
      if (hasMainProductContent(data)) {
        items.push({ id: generateId(), ...data, shopInstanceId, createdAt: now, updatedAt: now });
      }
      extras.forEach((extra) => {
        items.push(buildAdditionalProductData({ ...data, shopInstanceId }, extra, now));
      });
      saveItems();
      searchAddPendingQuery = null;
      finishProductSave(brand, shopInstanceId);
      return;
    }

    let idx = items.findIndex((i) => i.id === selectedDetail.id);
    if (idx === -1) {
      if (hasMainProductContent(data)) {
        items.push({ id: generateId(), ...data, shopInstanceId, createdAt: now, updatedAt: now });
      }
    } else {
      items[idx] = { ...items[idx], ...data, shopInstanceId, updatedAt: now };
    }
    extras.forEach((extra) => {
      items.push(buildAdditionalProductData({ ...data, shopInstanceId }, extra, now));
    });
    saveItems();
    finishProductSave(brand, shopInstanceId);
  }

  function renderShopEditForm(shop) {
    return `
      <form id="dialog-edit-form" class="dialog-edit-form" onsubmit="return false">
        <div class="form-row">
          <label>评分</label>
          ${renderRatingEditorHtml(shop.rating, {
            ratingId: 'dialog-star-rating',
            currentId: 'dialog-rating-current',
            hiddenId: 'dialog-rating',
          })}
        </div>
      </form>
    `;
  }

  function showShopEditDialog(shop) {
    dialogEditMode = true;
    selectedDetail = { type: 'shop', id: shop.id };
    showDialogTitle(shop.name || '编辑');
    window.AmapPicker?.destroyAllMiniMaps?.();
    productEls.dialogBody.innerHTML = renderShopEditForm(shop);
    bindDialogProductEdit({ rating: ratingOrDefault(shop.rating, 3) });
    productEls.dialogEditBtn.textContent = '保存';
    productEls.dialogDeleteBtn.textContent = '取消';
    productEls.dialogDeleteBtn.className = 'btn btn-secondary';
    productEls.detailDialog.classList.add('dialog-editing');
    if (!productEls.detailDialog.open) productEls.detailDialog.showModal();
  }

  function saveShopFromDialog() {
    if (!selectedDetail || selectedDetail.type !== 'shop') return;
    const shop = shops.find((s) => s.id === selectedDetail.id);
    if (!shop) return;
    // 编辑页已去掉店铺位置，定位字段保持原值
    shop.rating = ratingOrDefault($('#dialog-rating')?.value, 3);
    saveShops();
    setDialogViewMode();
    showShopDetail(shop);
    renderBrowse();
  }

  function cancelDialogEdit() {
    if (!selectedDetail) return;
    const { type, id, brand, renaming, shopInstanceId } = selectedDetail;
    setDialogViewMode();
    if (type === 'brand' && (renaming || brand)) {
      const group = findBrandGroup(brand, shopInstanceId);
      if (group) showBrandDetail(group);
      else closeDetailDialog();
      return;
    }
    if (type === 'product') {
      const item = resolveEditItem({ id });
      const productBrand = (brand || (item && getBrandName(item)) || '').trim();
      const sid = shopInstanceId || (item && getShopInstanceId(item)) || '';
      const group = findBrandGroup(productBrand, sid);
      if (group) showBrandDetail(group);
      else closeDetailDialog();
      return;
    }
    if (type === 'shop') {
      const shop = shops.find((entry) => entry.id === id);
      if (shop) showShopDetail(shop);
      else closeDetailDialog();
      return;
    }
    closeDetailDialog();
  }

  function getGroupShopRating(groupOrProducts) {
    const products = Array.isArray(groupOrProducts)
      ? groupOrProducts
      : groupOrProducts?.products || [];
    for (const item of products) {
      if (item && item.shopRating != null && item.shopRating !== '') {
        return ratingOrDefault(item.shopRating, 0);
      }
    }
    return 0;
  }

  function startBrandNameEdit(brand, shopInstanceId) {
    const brandName = (brand || '').trim();
    if (!brandName) return;
    const group = findBrandGroup(brandName, shopInstanceId);
    const shopRating = getGroupShopRating(group);
    const primaryProduct = group?.products?.[0] || null;
    const showStockFields = hasStockQuantity(primaryProduct);
    dialogEditMode = true;
    selectedDetail = {
      type: 'brand',
      brand: brandName,
      shopInstanceId: group?.shopInstanceId || shopInstanceId || '',
      renaming: true,
      primaryProductId: primaryProduct?.id ?? null,
    };
    window.AmapPicker?.destroyAllMiniMaps?.();
    showDialogNameField(brandName);
    if (productEls.dialogBody) {
      productEls.dialogBody.innerHTML = `
        <form id="dialog-edit-form" class="dialog-edit-form dialog-brand-edit-form" onsubmit="return false">
          <div class="form-row">
            <label>评分</label>
            ${renderRatingEditorHtml(shopRating, {
              ratingId: 'dialog-star-rating',
              currentId: 'dialog-rating-current',
              hiddenId: 'dialog-rating',
            })}
          </div>
          <div class="form-row form-row-key form-row-key-quantity">
            <label for="dialog-quantity">数量</label>
            <input type="number" id="dialog-quantity" min="1" step="1" value="${primaryProduct?.quantity != null ? primaryProduct.quantity : ''}">
          </div>
          <div class="form-row form-row-key form-row-key-category" id="dialog-category-row"${showStockFields ? '' : ' hidden'}>
            <label for="dialog-category">分类</label>
            <select id="dialog-category">
              ${renderCategorySelectOptions(primaryProduct?.category)}
            </select>
          </div>
          <div class="form-row form-row-key form-row-key-location" id="dialog-storage-location-row"${showStockFields ? '' : ' hidden'}>
            <label for="dialog-storage-location">所在位置</label>
            <input type="text" id="dialog-storage-location" value="${escapeHtml(primaryProduct?.storageLocation || '')}" placeholder="请输入所在位置">
          </div>
          <div class="form-row form-row-key form-row-key-notes">
            <label for="dialog-brand-notes">备注</label>
            <textarea id="dialog-brand-notes" rows="3" placeholder="可选，仅本品牌备注">${escapeHtml(getBrandNotes(group) || '')}</textarea>
          </div>
        </form>
      `;
    }
    const starContainer = $('#dialog-star-rating');
    const hiddenInput = $('#dialog-rating');
    const ratingDisplay = $('#dialog-rating-current');
    dialogSetStars = bindStarRating(starContainer, hiddenInput, ratingDisplay, 0);
    dialogSetStars(ratingOrDefault(shopRating, 0));
    bindStockDependentFields(
      $('#dialog-quantity'),
      $('#dialog-category-row'),
      $('#dialog-storage-location-row'),
    );
    productEls.dialogEditBtn.textContent = '保存';
    productEls.dialogEditBtn.className = 'btn btn-primary';
    productEls.dialogEditBtn.hidden = false;
    productEls.dialogDeleteBtn.hidden = true;
    if (productEls.dialogBrandDeleteBtn) {
      productEls.dialogBrandDeleteBtn.hidden = false;
    }
    productEls.detailDialog.classList.add('dialog-editing', 'dialog-renaming');
    productEls.dialogNameInput?.focus();
    productEls.dialogNameInput?.select?.();
  }

  async function saveBrandNameFromDialog() {
    if (!selectedDetail || selectedDetail.type !== 'brand' || !selectedDetail.renaming) return;
    const oldName = (selectedDetail.brand || '').trim();
    const newName = (productEls.dialogNameInput?.value || '').trim();
    if (!newName) {
      productEls.dialogNameInput?.focus();
      return;
    }
    const shopRating = ratingOrDefault($('#dialog-rating')?.value, 0);
    const quantityRaw = $('#dialog-quantity')?.value;
    const quantity =
      quantityRaw != null && quantityRaw !== '' ? parseInt(quantityRaw, 10) : null;
    const category = ($('#dialog-category')?.value || '').trim();
    const storageLocation = ($('#dialog-storage-location')?.value || '').trim();
    const brandNotes = ($('#dialog-brand-notes')?.value || '').trim();
    const stockData = { quantity, category, storageLocation };
    if (hasStockQuantity(stockData) && !(await validateMainProductStockFields(stockData))) {
      return;
    }
    const primaryProductId = selectedDetail.primaryProductId;
    const shopInstanceId = (selectedDetail.shopInstanceId || '').trim();
    const now = new Date().toISOString();
    let changed = false;
    items = items.map((item) => {
      if (!itemBelongsToShop(item, oldName, shopInstanceId)) return item;
      changed = true;
      const next = {
        ...item,
        name: newName,
        shopInstanceId: shopInstanceId || getShopInstanceId(item),
        shopRating,
        brandNotes,
        updatedAt: now,
      };
      if ((item.shopName || '').trim() === oldName) {
        next.shopName = newName;
      }
      if (primaryProductId != null && item.id === primaryProductId) {
        next.quantity = quantity;
        next.category = category;
        next.storageLocation = storageLocation;
      }
      return next;
    });
    if (!changed) {
      items.push({
        id: generateId(),
        name: newName,
        shopInstanceId: shopInstanceId || generateId(),
        isBrandPlaceholder: true,
        brand: '',
        flavor: '',
        category,
        storageLocation,
        quantity,
        shopName: '',
        shopLocation: '',
        shopMapAddress: '',
        shopLng: null,
        shopLat: null,
        price: null,
        weight: null,
        singleWeight: null,
        rating: 0,
        shopRating,
        notes: '',
        brandNotes,
        createdAt: now,
        updatedAt: now,
      });
    }
    saveItems();
    window.location.reload();
  }

  function mergeById(existing, incoming) {
    const map = new Map();
    (existing || []).forEach((item) => {
      if (item && item.id != null) map.set(String(item.id), item);
    });
    (incoming || []).forEach((item) => {
      if (item && item.id != null) map.set(String(item.id), item);
    });
    return Array.from(map.values());
  }

  function normalizeShops(list) {
    return (list || []).map((shop) => {
      if (shop.product && !shop.products) {
        shop.products = [shop.product];
        delete shop.product;
      }
      return shop;
    });
  }

  function tryRecoverPendingData() {
    let recovered = false;
    const productText =
      sessionStorage.getItem('migrate-pending-product') || sessionStorage.getItem('migrate-product-data');
    const shopText =
      sessionStorage.getItem('migrate-pending-shop') || sessionStorage.getItem('migrate-shop-data');

    if (productText) {
      try {
        const incoming = JSON.parse(productText);
        if (Array.isArray(incoming) && incoming.length) {
          const merged = mergeById(loadItems(), incoming);
          localStorage.setItem(PRODUCT_STORAGE_KEY, JSON.stringify(merged));
          recovered = true;
        }
      } catch {
        /* ignore invalid pending product data */
      }
    }

    if (shopText) {
      try {
        const incoming = normalizeShops(JSON.parse(shopText));
        if (Array.isArray(incoming) && incoming.length) {
          const migrated = migrateShopRecords(incoming);
          const merged = mergeById(loadItems(), migrated);
          localStorage.setItem(PRODUCT_STORAGE_KEY, JSON.stringify(merged));
          recovered = true;
        }
      } catch {
        /* ignore invalid pending shop data */
      }
    }

    return recovered;
  }

  function loadItems() {
    try {
      const raw = localStorage.getItem(PRODUCT_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      const { items: sanitized, changed } = sanitizeItemsStockFields(parsed);
      const ensured = ensureShopInstanceIds(sanitized);
      if (changed || ensured.changed) {
        localStorage.setItem(PRODUCT_STORAGE_KEY, JSON.stringify(ensured.items));
      }
      return ensured.items;
    } catch {
      return [];
    }
  }

  function saveItems() {
    localStorage.setItem(PRODUCT_STORAGE_KEY, JSON.stringify(items));
    window.HebingSync?.scheduleCloudSync?.();
  }

  function formatPrice(price) {
    if (price === '' || price == null || isNaN(price)) return '—';
    return '¥' + Number(price).toFixed(2);
  }

  function formatWeight(weight) {
    if (weight == null || isNaN(weight) || weight <= 0) return '—';
    return Number(weight) + ' 斤';
  }

  function formatGramWeight(weight) {
    if (weight == null || isNaN(weight) || weight <= 0) return '—';
    return Number(weight) + ' 克';
  }

  function calcUnitPricePerJin(price, weight) {
    const p = Number(price);
    const w = Number(weight);
    if (!p || p <= 0 || !w || w <= 0 || isNaN(p) || isNaN(w)) return null;
    return p / w;
  }

  function formatUnitPrice(price, weight) {
    const unit = calcUnitPricePerJin(price, weight);
    if (unit == null) return '—';
    return '¥' + unit.toFixed(2) + '/斤';
  }

  function renderDetailBody(rows) {
    return rows
      .map(
        ([label, value]) =>
          `<div class="detail-row"><span class="detail-label">${label}</span><span class="detail-value">${value}</span></div>`,
      )
      .join('');
  }

  function showDetailDialog(title, rows) {
    setDialogViewMode();
    showDialogTitle(title);
    productEls.dialogBody.innerHTML = renderDetailBody(rows);
    productEls.dialogEditBtn.hidden = false;
    productEls.dialogDeleteBtn.hidden = false;
    productEls.detailDialog.showModal();
  }

  function closeDetailDialog() {
    window.AmapPicker?.destroyAllMiniMaps?.();
    productEls.detailDialog.close();
    selectedDetail = null;
    setDialogViewMode();
    // 详情盖在大地图上时，关掉后刷新一下地图，避免空白/错位
    if (window.AmapPicker?.isBrowseMapOpen?.()) {
      requestAnimationFrame(function () {
        try {
          window.AmapPicker?.resizeBrowseMap?.();
        } catch (_err) {
          /* ignore */
        }
      });
    }
  }

  function showParentBrandDetailForProduct(item) {
    const brand = item ? getBrandName(item) : '';
    const group = findBrandGroup(brand, item ? getShopInstanceId(item) : '');
    if (group) {
      showBrandDetail(group);
      return true;
    }
    return false;
  }

  function handleDetailLayerBack() {
    if (!productEls.detailDialog?.open) return false;
    // 上层还有选点/确认框时，不要越级处理详情返回
    if (
      window.AmapPicker?.isPickerOverlayOpen?.() ||
      window.AmapPicker?.isOpen?.() ||
      document.getElementById('app-message-dialog')?.open ||
      document.getElementById('search-add-confirm-dialog')?.open
    ) {
      return false;
    }
    if (dialogEditMode) {
      cancelDialogEdit();
      return true;
    }
    if (selectedDetail?.type === 'product') {
      const item = resolveEditItem({ id: selectedDetail.id });
      if (showParentBrandDetailForProduct(item)) return true;
    }
    closeDetailDialog();
    return true;
  }

  window.HebingNavigation = {
    ...(window.HebingNavigation || {}),
    handleBack: handleDetailLayerBack,
  };

  function getProductShopInfo(item) {
    const shopLocation = (item.shopLocation || '').trim();
    const shopMapAddress = (item.shopMapAddress || '').trim();
    return {
      shopName: (item.shopName || '').trim(),
      shopLocation,
      // 旧数据没有 mapAddress 时，地图侧可回退用手填内容打开，但不强制两边一致
      shopMapAddress,
      shopLng: parseCoord(item.shopLng),
      shopLat: parseCoord(item.shopLat),
    };
  }

  function getBrandName(item) {
    return (item.name || '').trim() || '未命名';
  }

  /** 旧数据按店名兼容；新建同名店用独立 UUID，互不合并 */
  function legacyShopInstanceId(brandName) {
    return 'legacy:' + encodeURIComponent((brandName || '').trim() || '未命名');
  }

  function getShopInstanceId(item) {
    const explicit = (item?.shopInstanceId || '').trim();
    if (explicit) return explicit;
    return legacyShopInstanceId(getBrandName(item));
  }

  function ensureShopInstanceIds(list) {
    const arr = Array.isArray(list) ? list : [];
    let changed = false;
    for (const item of arr) {
      if ((item.shopInstanceId || '').trim()) continue;
      item.shopInstanceId = legacyShopInstanceId(getBrandName(item));
      changed = true;
    }
    return { items: arr, changed };
  }

  function findBrandGroup(brand, shopInstanceId) {
    const groups = groupProductsByBrand(items);
    const sid = (shopInstanceId || '').trim();
    if (sid) {
      const byId = groups.find((g) => g.shopInstanceId === sid);
      if (byId) return byId;
    }
    const name = (brand || '').trim();
    if (!name) return null;
    return groups.find((g) => g.brand === name) || null;
  }

  function itemBelongsToShop(item, brand, shopInstanceId) {
    const sid = (shopInstanceId || '').trim();
    if (sid) return getShopInstanceId(item) === sid;
    return getBrandName(item) === (brand || '').trim();
  }

  function getBrandNotes(groupOrProducts) {
    const products = Array.isArray(groupOrProducts)
      ? groupOrProducts
      : groupOrProducts?.products || [];
    for (const item of products) {
      const notes = (item?.brandNotes || '').trim();
      if (notes) return notes;
    }
    return '';
  }

  function isBrandPlaceholder(item) {
    return item?.isBrandPlaceholder === true;
  }

  function buildBrandPlaceholder(brandName, seed = {}) {
    const now = new Date().toISOString();
    const name = (brandName || '').trim() || '未命名';
    const shopInfo = seed && seed.id != null ? getProductShopInfo(seed) : {
      shopLocation: (seed.shopLocation || '').trim(),
      shopMapAddress: (seed.shopMapAddress || '').trim(),
      shopLng: parseCoord(seed.shopLng),
      shopLat: parseCoord(seed.shopLat),
    };
    const shopInstanceId =
      (seed.shopInstanceId || '').trim() ||
      (seed && seed.id != null ? getShopInstanceId(seed) : generateId());
    return {
      id: generateId(),
      name,
      shopInstanceId,
      isBrandPlaceholder: true,
      brand: '',
      flavor: '',
      category: '',
      storageLocation: '',
      quantity: null,
      shopName: '',
      shopLocation: shopInfo.shopLocation || '',
      shopMapAddress: shopInfo.shopMapAddress || '',
      shopLng: shopInfo.shopLng ?? null,
      shopLat: shopInfo.shopLat ?? null,
      price: null,
      weight: null,
      singleWeight: null,
      rating: 0,
      shopRating: ratingOrDefault(seed.shopRating, 0),
      notes: '',
      brandNotes: (seed.brandNotes || '').trim(),
      createdAt: seed.createdAt || now,
      updatedAt: now,
    };
  }

  function ensureBrandRecordAfterProductRemoval(brandName, seedItem, shopInstanceId) {
    const brand = (brandName || '').trim();
    if (!brand) return;
    const sid = (shopInstanceId || (seedItem && getShopInstanceId(seedItem)) || '').trim();
    const remaining = items.filter((item) => itemBelongsToShop(item, brand, sid));
    if (remaining.some((item) => !isBrandPlaceholder(item))) return;
    if (remaining.some(isBrandPlaceholder)) return;
    items.push(
      buildBrandPlaceholder(brand, {
        ...(seedItem || {}),
        shopInstanceId: sid || generateId(),
      }),
    );
  }

  const PRODUCT_CATEGORIES = ['食品', '速食', '其他'];

  const STOCK_COLOR_CLASSES = [
    'stock-red',
    'stock-orange',
    'stock-amber',
    'stock-lime',
    'stock-green',
    'stock-teal',
    'stock-cyan',
    'stock-blue',
    'stock-indigo',
    'stock-violet',
    'stock-fuchsia',
    'stock-rose',
  ];

  function hasStockQuantity(item) {
    const quantity = Number(item?.quantity);
    return item?.quantity != null && item.quantity !== '' && !Number.isNaN(quantity) && quantity > 0;
  }

  function shouldShowStockFields(value) {
    if (value === '' || value == null) return false;
    const quantity = Number(value);
    return !Number.isNaN(quantity) && quantity > 0;
  }

  function bindStockDependentFields(quantityInput, ...dependentRows) {
    if (!quantityInput || !dependentRows.length) return;
    const update = () => {
      const show = shouldShowStockFields(quantityInput.value);
      dependentRows.forEach((row) => {
        if (row) row.hidden = !show;
      });
    };
    quantityInput.addEventListener('input', update);
    update();
  }

  function renderCategorySelectOptions(selectedValue) {
    const selected = (selectedValue || '').trim();
    let html = '<option value="">请选择分类</option>';
    for (const category of PRODUCT_CATEGORIES) {
      html += `<option value="${escapeHtml(category)}"${selected === category ? ' selected' : ''}>${escapeHtml(category)}</option>`;
    }
    return html;
  }

  function getItemCategory(item) {
    if (!hasStockQuantity(item)) return '';
    return (item.category || '').trim();
  }

  function getItemStorageLocation(item) {
    if (!hasStockQuantity(item)) return '';
    return (item.storageLocation || '').trim();
  }

  function sanitizeProductStockFields(data) {
    const sanitized = { ...data };
    if (!hasStockQuantity(sanitized)) {
      sanitized.storageLocation = '';
      sanitized.category = '';
    } else {
      sanitized.storageLocation = (sanitized.storageLocation || '').trim();
      sanitized.category = (sanitized.category || '').trim();
    }
    return sanitized;
  }

  function getStockFieldsValidationError(data) {
    if (!hasStockQuantity(data)) return null;
    if (!(data.category || '').trim()) return '有数量时必须选择分类';
    if (!(data.storageLocation || '').trim()) return '有数量时必须填写所在位置';
    return null;
  }

  async function validateMainProductStockFields(data) {
    const message = getStockFieldsValidationError(data);
    if (!message) return true;
    await showAppAlert(message);
    $('#dialog-category-row')?.removeAttribute('hidden');
    $('#dialog-storage-location-row')?.removeAttribute('hidden');
    if (!(data.category || '').trim()) {
      $('#dialog-category')?.focus();
    } else {
      $('#dialog-storage-location')?.focus();
    }
    return false;
  }

  async function validateExtraProductRowsStockFields() {
    for (const row of document.querySelectorAll('.extra-product-row')) {
      const quantityInput = row.querySelector('.extra-quantity');
      const quantity =
        quantityInput?.value !== '' ? parseInt(quantityInput.value, 10) : null;
      const item = {
        quantity,
        category: (row.querySelector('.extra-category')?.value || '').trim(),
        storageLocation: (row.querySelector('.extra-storage-location')?.value || '').trim(),
      };
      const message = getStockFieldsValidationError(item);
      if (!message) continue;
      await showAppAlert(message);
      row.querySelector('.extra-category-row')?.removeAttribute('hidden');
      row.querySelector('.extra-storage-location-row')?.removeAttribute('hidden');
      if (!(item.category || '').trim()) {
        row.querySelector('.extra-category')?.focus();
      } else {
        row.querySelector('.extra-storage-location')?.focus();
      }
      return false;
    }
    return true;
  }

  function sanitizeItemsStockFields(itemList) {
    let changed = false;
    const sanitized = itemList.map((item) => {
      const next = sanitizeProductStockFields(item);
      if (
        next.storageLocation !== (item.storageLocation || '') ||
        next.category !== (item.category || '')
      ) {
        changed = true;
      }
      return next;
    });
    return { items: sanitized, changed };
  }

  function getStockColorIndex(item) {
    const key = String(item.id || item.flavor || item.name || '');
    let hash = 0;
    for (let i = 0; i < key.length; i++) {
      hash = (hash + key.charCodeAt(i) * (i + 1)) % STOCK_COLOR_CLASSES.length;
    }
    return hash;
  }

  function getStockDisplayClass(item) {
    if (!hasStockQuantity(item)) return 'no-stock';
    return `in-stock ${STOCK_COLOR_CLASSES[getStockColorIndex(item)]}`;
  }

  function brandHasStock(products) {
    return products.some(hasStockQuantity);
  }

  function compareStockPriority(a, b) {
    const stockDiff = Number(hasStockQuantity(b)) - Number(hasStockQuantity(a));
    if (stockDiff !== 0) return stockDiff;
    const ratingDiff = Number(b.rating || 0) - Number(a.rating || 0);
    if (ratingDiff !== 0) return ratingDiff;
    return (b.updatedAt || b.createdAt || '').localeCompare(a.updatedAt || a.createdAt || '');
  }

  function getBrandStockClass(products) {
    const stocked = products.find(hasStockQuantity);
    if (stocked) return getStockDisplayClass(stocked);
    return 'no-stock';
  }

  function renderStockBadge(item) {
    if (!hasStockQuantity(item)) return '';
    return `<span class="stock-badge">库存 ×${item.quantity}</span>`;
  }

  function renderStorageLocationHtml(location) {
    if (!location) return '';
    return escapeHtml(location);
  }

  function renderBrandStockPreviewChip(item) {
    const label = item.flavor || '未命名商品';
    const location = getItemStorageLocation(item);
    const parts = [
      `<span class="brand-stock-name">${escapeHtml(label)}</span>`,
      `<span class="brand-stock-qty">×${item.quantity}</span>`,
    ];
    if (location) {
      parts.push(`<span class="brand-stock-location">${escapeHtml(location)}</span>`);
    }
    return `<span class="brand-stock-chip">${parts.join('<span class="brand-stock-sep">·</span>')}</span>`;
  }

  function getSearchSuggestionClass(group) {
    const stocked = group.products.find(hasStockQuantity);
    const ref = stocked || { id: group.brand, name: group.brand, flavor: group.brand };
    return `in-stock ${STOCK_COLOR_CLASSES[getStockColorIndex(ref)]}`;
  }

  function groupProductsByBrand(productList) {
    const groups = new Map();
    for (const item of productList) {
      const shopInstanceId = getShopInstanceId(item);
      if (!groups.has(shopInstanceId)) groups.set(shopInstanceId, []);
      groups.get(shopInstanceId).push(item);
    }
    return [...groups.entries()]
      .map(([shopInstanceId, products]) => {
        const sorted = [...products].sort(compareStockPriority);
        const brand = getBrandName(sorted[0]);
        const ratings = sorted.map((p) => Number(p.rating || 0)).filter((r) => r > 0);
        const shopRating = getGroupShopRating(sorted);
        return {
          brand,
          shopInstanceId,
          products: sorted,
          shopRating,
          maxRating: ratings.length ? Math.max(...ratings) : 0,
          avgRating: ratings.length ? ratings.reduce((s, r) => s + r, 0) / ratings.length : 0,
          hasStock: sorted.some(hasStockQuantity),
        };
      })
      .sort((a, b) => {
        const stockDiff = Number(b.hasStock) - Number(a.hasStock);
        if (stockDiff !== 0) return stockDiff;
        const shopDiff = Number(b.shopRating || 0) - Number(a.shopRating || 0);
        if (shopDiff !== 0) return shopDiff;
        const diff = b.maxRating - a.maxRating;
        if (diff !== 0) return diff;
        const nameDiff = a.brand.localeCompare(b.brand, 'zh');
        if (nameDiff !== 0) return nameDiff;
        const aLatest = a.products[0]?.updatedAt || a.products[0]?.createdAt || '';
        const bLatest = b.products[0]?.updatedAt || b.products[0]?.createdAt || '';
        return bLatest.localeCompare(aLatest);
      });
  }

  function getProductSearchText(item) {
    const { shopName, shopLocation } = getProductShopInfo(item);
    return [
      getBrandName(item),
      item.name,
      item.brand,
      item.flavor,
      item.category,
      item.storageLocation,
      item.quantity != null ? String(item.quantity) : '',
      shopName,
      shopLocation,
      item.notes,
      item.brandNotes,
      item.price != null ? String(item.price) : '',
      item.weight != null ? String(item.weight) : '',
      item.singleWeight != null ? String(item.singleWeight) : '',
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
  }

  function buildProductMetaHtml(item) {
    const unitPrice = formatUnitPrice(item.price, item.weight);
    const { shopName, shopLocation, shopLng, shopLat } = getProductShopInfo(item);
    return [
      item.brand && `<span>${escapeHtml(item.brand)}</span>`,
      item.flavor && `<span>${escapeHtml(item.flavor)}</span>`,
      `<span>店铺名称：${escapeHtml(shopName) || '—'}</span>`,
      `<span>店铺位置：${formatLocationWithGeo(shopLocation, shopLng, shopLat)}</span>`,
      item.price != null && `<span>${formatPrice(item.price)}</span>`,
      item.weight != null && item.weight > 0 && `<span>${formatWeight(item.weight)}</span>`,
      item.singleWeight != null && item.singleWeight > 0 && `<span>${formatGramWeight(item.singleWeight)}</span>`,
      unitPrice !== '—' && `<span class="meta-unit-price">${unitPrice}</span>`,
    ]
      .filter(Boolean)
      .join('');
  }

  function buildProductDetailRows(item) {
    const isLow = isLowRating(item.rating);
    const unitPrice = formatUnitPrice(item.price, item.weight);
    const { shopName, shopLocation, shopLng, shopLat } = getProductShopInfo(item);
    return [
      ['评分', renderStarsDisplay(item.rating, isLow)],
      ['名称', escapeHtml(getBrandName(item))],
      ['商品名', escapeHtml(item.flavor) || '—'],
      ['分类', escapeHtml(getItemCategory(item)) || '—'],
      ['所在位置', escapeHtml(getItemStorageLocation(item)) || '—'],
      ['数量', item.quantity != null && item.quantity > 0 ? String(item.quantity) : '—'],
      ['店铺名称', escapeHtml(shopName) || '—'],
      ['店铺位置', formatLocationWithGeo(shopLocation, shopLng, shopLat)],
      ['价格', formatPrice(item.price)],
      ['总重量', formatWeight(item.weight)],
      ['单个重量', formatGramWeight(item.singleWeight)],
      ['单价', unitPrice],
      ['备注', escapeHtml(item.notes) || '—'],
    ];
  }

  function renderProductCard(item, options = {}) {
    const type = options.type || 'product';
    const cardId = options.id || item.id;
    const isLow = isLowRating(item.rating);
    const meta = buildProductMetaHtml(item);
    const productIdAttr = options.productId ? ` data-product-id="${escapeHtml(options.productId)}"` : '';
    return `
      <li class="item-card ${getStockDisplayClass(item)}" data-type="${type}" data-id="${escapeHtml(cardId)}"${productIdAttr}>
        <div class="item-header">
          <div class="item-title-wrap">
            <h3 class="item-name">${escapeHtml(item.name)}</h3>
          </div>
          ${renderStarsDisplay(item.rating, isLow)}
        </div>
        ${getItemStorageLocation(item) ? `<div class="item-location">${renderStorageLocationHtml(getItemStorageLocation(item))}</div>` : ''}
        ${meta ? `<div class="item-meta">${meta}</div>` : ''}
        ${item.notes ? `<p class="item-notes">${escapeHtml(item.notes)}</p>` : ''}
      </li>`;
  }

  function renderBrandStockPreview(products) {
    const stocked = products.filter(hasStockQuantity);
    if (!stocked.length) return '';
    const chips = stocked.map((item) => renderBrandStockPreviewChip(item)).join('');
    return `<div class="brand-stock-preview">${chips}</div>`;
  }

  function renderBrandCountHint(products) {
    const actualProducts = products.filter((item) => !isBrandPlaceholder(item));
    const count = actualProducts.length;
    const stockedCount = actualProducts.filter(hasStockQuantity).length;
    if (stockedCount > 0) {
      return '点击查看全部商品';
    }
    if (count === 0) return '待定，点击查看详情';
    return count === 1 ? '共 1 种商品，点击查看详情' : `共 ${count} 种商品，点击查看详情`;
  }

  function renderBrandCard(group) {
    const { brand, products, shopRating, shopInstanceId } = group;
    const displayRating = ratingOrDefault(shopRating, 0);
    const isLow = isLowRating(displayRating);
    const stockClass = getBrandStockClass(products);
    const stockPreview = renderBrandStockPreview(products);
    const locInfo = getBrandShopLocationInfo(group);
    const locText = (locInfo.shopLocation || locInfo.shopMapAddress || '').trim();
    const bodyHtml = `
      ${locText ? `<p class="brand-location-hint">${escapeHtml(locText)}</p>` : ''}
      <p class="brand-count-hint">${renderBrandCountHint(products)}</p>
    `;

    return `
      <li class="item-card brand-card ${stockClass}" data-type="brand" data-brand="${escapeHtml(brand)}" data-shop-instance-id="${escapeHtml(shopInstanceId || '')}">
        <div class="item-header">
          <div class="item-title-wrap">
            <h3 class="item-name">${escapeHtml(brand)}</h3>
          </div>
          ${stockPreview}
          <div class="item-header-rating">${renderStarsDisplay(displayRating, isLow)}</div>
        </div>
        ${bodyHtml}
      </li>`;
  }

  function getBrandShopLocationInfo(group) {
    const products = group?.products || [];
    for (const item of products) {
      const info = getProductShopInfo(item);
      if (info.shopLocation || info.shopMapAddress || (info.shopLng != null && info.shopLat != null)) {
        return info;
      }
    }
    if (group?.shopLocation || group?.shopMapAddress || group?.shopLng != null || group?.shopLat != null) {
      return {
        shopName: group.brand || '',
        shopLocation: (group.shopLocation || '').trim(),
        shopMapAddress: (group.shopMapAddress || group.mapAddress || '').trim(),
        shopLng: parseCoord(group.shopLng),
        shopLat: parseCoord(group.shopLat),
      };
    }
    return {
      shopName: group?.brand || '',
      shopLocation: '',
      shopMapAddress: '',
      shopLng: null,
      shopLat: null,
    };
  }

  function renderBrandLocationBar(group) {
    const { shopLng, shopLat } = getBrandShopLocationInfo(group);
    const hasGeo = parseCoord(shopLng) != null && parseCoord(shopLat) != null;
    const emptyClass = hasGeo ? '' : ' is-empty';

    return `
      <div class="brand-location-bar${emptyClass}" role="group" aria-label="店铺位置" data-brand="${escapeHtml(group.brand || '')}">
        ${renderShopMapThumbHtml({ lng: shopLng, lat: shopLat, buttonId: 'brand-amap-thumb' })}
      </div>
    `;
  }

  async function openBrandMapEditor(brand, shopInstanceId) {
    const brandName = (brand || '').trim();
    if (!brandName) return;
    if (!window.AmapPicker?.open) {
      alert('地图选点模块未加载');
      return;
    }
    const group = findBrandGroup(brandName, shopInstanceId);
    if (!group) return;
    const sid = group.shopInstanceId;
    const info = getBrandShopLocationInfo(group);
    window.AmapPicker.destroyAllMiniMaps?.();
    const result = await AmapPicker.open({
      address: info.shopMapAddress || (info.shopLng != null ? info.shopLocation : ''),
      lng: info.shopLng,
      lat: info.shopLat,
    });
    if (!result) {
      mountShopMapThumb($('#brand-amap-thumb'));
      return;
    }
    const now = new Date().toISOString();
    let changed = false;
    items = items.map((item) => {
      if (!itemBelongsToShop(item, brandName, sid)) return item;
      changed = true;
      return {
        ...item,
        shopInstanceId: sid || getShopInstanceId(item),
        shopMapAddress: result.address || '',
        shopLng: result.lng,
        shopLat: result.lat,
        updatedAt: now,
      };
    });
    if (!changed) return;
    saveItems();
    const updated = findBrandGroup(brandName, sid);
    if (updated) showBrandDetail(updated);
    else renderBrowse();
  }

  function bindBrandLocationMapThumb(group) {
    const thumb = $('#brand-amap-thumb');
    if (!thumb) return;
    const brand = group?.brand || '';
    const shopInstanceId = group?.shopInstanceId || '';
    thumb.addEventListener('click', (event) => {
      if (Date.now() < suppressBrandMapThumbUntil) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      openBrandMapEditor(brand, shopInstanceId);
    });
    mountShopMapThumb(thumb);
  }

  function renderBrandDetailBody(group) {
    const products = group.products.filter((item) => !isBrandPlaceholder(item));
    const brandNotes = getBrandNotes(group);
    const rows = products
      .map((item) => {
        const label = item.flavor || '未命名商品';
        const isLow = isLowRating(item.rating);
        const unitPrice = formatUnitPrice(item.price, item.weight);
        const metaParts = [
          item.price != null && formatPrice(item.price),
          unitPrice !== '—' && unitPrice,
          item.notes && escapeHtml(item.notes),
        ].filter(Boolean);

        return `
          <button type="button" class="brand-product-row ${getStockDisplayClass(item)}" data-product-id="${escapeHtml(item.id)}">
            <div class="brand-product-row-main">
              <div class="brand-product-title-wrap">
                <span class="brand-product-name">${escapeHtml(label)}</span>
                ${renderStockBadge(item)}
              </div>
              ${renderStarsDisplay(item.rating, isLow)}
            </div>
            ${getItemStorageLocation(item) ? `<div class="brand-product-row-location">${renderStorageLocationHtml(getItemStorageLocation(item))}</div>` : ''}
            ${metaParts.length ? `<div class="brand-product-row-meta">${metaParts.join(' · ')}</div>` : ''}
          </button>`;
      })
      .join('');

    return `
      ${renderBrandLocationBar(group)}
      ${brandNotes ? `<p class="brand-notes">${escapeHtml(brandNotes)}</p>` : ''}
      <div class="brand-products-list">${rows}</div>
    `;
  }

  function shopToBrandGroup(shop) {
    const brand = (shop.name || '').trim() || '未命名';
    const shopLocation = (shop.location || '').trim();
    const shopMapAddress = (shop.mapAddress || '').trim();
    const shopLng = parseCoord(shop.lng);
    const shopLat = parseCoord(shop.lat);
    const shopInstanceId = (shop.id && String(shop.id)) || generateId();
    const shopProducts = getShopProducts(shop);
    const products = shopProducts.length
      ? shopProducts.map((product, index) => ({
          id: product.id || `${shop.id || brand}-${index}`,
          name: brand,
          shopInstanceId,
          flavor: (product.name || '').trim(),
          shopName: brand,
          shopLocation,
          shopMapAddress,
          shopLng,
          shopLat,
          rating: product.rating ?? shop.rating ?? 3,
          storageLocation: '',
          category: '',
          quantity: null,
          price: null,
          weight: null,
          singleWeight: null,
          notes: '',
        }))
      : [
          {
            id: shop.id || brand,
            name: brand,
            shopInstanceId,
            flavor: '',
            shopName: brand,
            shopLocation,
            shopMapAddress,
            shopLng,
            shopLat,
            rating: shop.rating ?? 3,
          },
        ];
    const ratings = products.map((p) => Number(p.rating || 0)).filter((r) => r > 0);
    return {
      brand,
      shopInstanceId,
      products,
      shopLocation,
      shopMapAddress,
      shopLng,
      shopLat,
      maxRating: ratings.length ? Math.max(...ratings) : 0,
      avgRating: ratings.length ? ratings.reduce((s, r) => s + r, 0) / ratings.length : 0,
      hasStock: false,
    };
  }

  function showAddProductDialog(brand, shopInstanceId) {
    const sid = (shopInstanceId || '').trim();
    const group = findBrandGroup(brand, sid);
    const locInfo = group ? getBrandShopLocationInfo(group) : null;
    const emptyItem = {
      name: brand,
      shopInstanceId: sid || group?.shopInstanceId || generateId(),
      flavor: '',
      category: '',
      storageLocation: '',
      quantity: null,
      shopLocation: locInfo?.shopLocation || '',
      shopMapAddress: locInfo?.shopMapAddress || '',
      shopLng: locInfo?.shopLng ?? null,
      shopLat: locInfo?.shopLat ?? null,
      price: null,
      weight: null,
      singleWeight: null,
      rating: 3,
      notes: '',
    };
    dialogEditMode = true;
    selectedDetail = {
      type: 'product',
      isNew: true,
      brand,
      shopInstanceId: emptyItem.shopInstanceId,
    };
    showDialogTitle(brand || '添加商品');
    window.AmapPicker?.destroyAllMiniMaps?.();
    productEls.dialogBody.innerHTML = renderProductEditForm(emptyItem);
    bindDialogProductEdit(emptyItem);
    productEls.dialogEditBtn.textContent = '保存';
    productEls.dialogDeleteBtn.textContent = '取消';
    productEls.dialogDeleteBtn.className = 'btn btn-secondary';
    productEls.dialogDeleteBtn.hidden = false;
    productEls.detailDialog.classList.add('dialog-editing');
    if (!productEls.detailDialog.open) productEls.detailDialog.showModal();
    $('#dialog-flavor')?.focus();
  }

  function startAddProductForBrand(brand, shopInstanceId) {
    showAddProductDialog(brand, shopInstanceId);
  }

  function showSearchAddConfirm(query) {
    const trimmed = (query || '').trim();
    if (!trimmed) return;
    const dialog = $('#search-add-confirm-dialog');
    if (!dialog) return;
    const relatedCount = getDisplayGroups(trimmed).length;
    const exactCount = groupProductsByBrand(items).filter((g) => g.brand === trimmed).length;
    searchAddPendingQuery = trimmed;
    if (relatedCount > 0) {
      $('#search-add-confirm-text').textContent =
        exactCount > 0
          ? `已有 ${exactCount} 家「${trimmed}」。仍要再建一家同名店吗？（可用地图位置区分）`
          : `已找到 ${relatedCount} 条相关记录。仍要用「${trimmed}」新建一家店吗？`;
    } else {
      $('#search-add-confirm-text').textContent = `没有找到「${trimmed}」相关记录，是否添加为新信息？`;
    }
    dialog.showModal();
  }

  function closeSearchAddConfirm() {
    searchAddPendingQuery = null;
    $('#search-add-confirm-dialog')?.close();
  }

  function confirmSearchAdd() {
    const query = searchAddPendingQuery;
    closeSearchAddConfirm();
    if (!query) return;
    const shopInstanceId = generateId();
    items.push(buildBrandPlaceholder(query, { shopInstanceId }));
    saveItems();
    renderBrowse();
    const group = findBrandGroup(query, shopInstanceId);
    if (!group) return;
    showBrandDetail(group);
  }

  function updateSearchAddPrompt(query, hasResults) {
    const trimmed = (query || '').trim();
    const hintEl = $('#global-empty-hint');
    const triggerBtn = $('#search-add-trigger-btn');
    if (!hintEl || !triggerBtn) return;

    if (!trimmed) {
      hintEl.hidden = true;
      triggerBtn.hidden = true;
      return;
    }

    hintEl.hidden = false;
    triggerBtn.hidden = false;
    if (hasResults) {
      hintEl.textContent = `已有相关记录。仍可用「${trimmed}」新建一家店（同名也可以）。`;
      triggerBtn.textContent = '新建店铺';
    } else {
      hintEl.textContent = `没有找到「${trimmed}」相关记录。`;
      triggerBtn.textContent = '确认添加';
    }
  }

  function showBrandDetail(group, options = {}) {
    selectedDetail = {
      type: 'brand',
      brand: group.brand,
      shopInstanceId: group.shopInstanceId,
    };
    setDialogViewMode();
    window.AmapPicker?.destroyAllMiniMaps?.();
    showDialogTitle(group.brand);
    if (productEls.dialogHeaderEditBtn) {
      productEls.dialogHeaderEditBtn.hidden = false;
    }
    productEls.dialogBody.innerHTML = renderBrandDetailBody(group);
    if (options.fromBrowseMap) {
      armDetailGhostClickShield(750);
    }
    bindBrandLocationMapThumb(group);
    productEls.dialogEditBtn.textContent = '添加新商品';
    productEls.dialogEditBtn.hidden = false;
    productEls.dialogDeleteBtn.hidden = true;
    productEls.detailDialog.showModal();
  }

  function collectMappedBrandPlaces() {
    const groups = groupProductsByBrand(items);
    const places = [];
    for (const group of groups) {
      const info = getBrandShopLocationInfo(group);
      const lng = parseCoord(info.shopLng);
      const lat = parseCoord(info.shopLat);
      if (lng == null || lat == null) continue;
      places.push({
        id: group.shopInstanceId || group.brand,
        title: group.brand,
        subtitle: info.shopLocation || info.shopMapAddress || '',
        address: info.shopMapAddress || info.shopLocation || '',
        lng,
        lat,
        rating: group.shopRating > 0 ? formatRating(group.shopRating) : '',
        brand: group.brand,
        shopInstanceId: group.shopInstanceId,
      });
    }
    return places;
  }

  async function openBrowseMapView() {
    if (!window.AmapPicker?.openBrowseMap) {
      alert('地图模块未加载');
      return;
    }
    if (!AmapPicker.hasKey?.()) {
      alert('尚未配置高德 Key，无法打开地图查看');
      return;
    }
    const places = collectMappedBrandPlaces();
    try {
      await AmapPicker.openBrowseMap({
        places,
        onSelect(place) {
          const brand = (place?.brand || '').trim();
          const shopInstanceId = (place?.shopInstanceId || place?.id || '').trim();
          const group = findBrandGroup(brand, shopInstanceId);
          if (group) showBrandDetail(group, { fromBrowseMap: true });
        },
      });
    } catch (error) {
      alert(error?.message || '打开地图查看失败');
    }
  }

  function clearSearch() {
    const searchEl = $('#unified-search');
    if (!searchEl) return;
    closeSearchAddConfirm();
    searchEl.value = '';
    renderBrowse();
    searchEl.focus();
  }

  function hasStockCategory(item, category) {
    return hasStockQuantity(item) && (item.category || '').trim() === category;
  }

  function matchesBrowseCategoryFilter(item, filter = browseFilter) {
    if (filter === 'all') return true;
    if (filter === 'food') return hasStockCategory(item, '食品');
    if (filter === 'instant') return hasStockCategory(item, '速食');
    if (filter === 'other') return hasStockCategory(item, '其他');
    return true;
  }

  function updateBrowseCategoryChips() {
    document.querySelectorAll('#browse-category-chips [data-browse-filter]').forEach((chip) => {
      chip.classList.toggle('active', chip.dataset.browseFilter === browseFilter);
    });
  }

  function getFilteredProducts(query) {
    let result = items.filter((item) => matchesBrowseCategoryFilter(item));
    const q = (query || '').trim().toLowerCase();
    if (q) {
      result = result.filter((item) => getProductSearchText(item).includes(q));
    }
    result.sort((a, b) => {
      const diff = Number(b.rating || 0) - Number(a.rating || 0);
      if (diff !== 0) return diff;
      return (b.updatedAt || b.createdAt || '').localeCompare(a.updatedAt || a.createdAt || '');
    });
    return result;
  }

  function getDisplayGroups(query) {
    return groupProductsByBrand(getFilteredProducts(query));
  }

  function findDisplayProduct(productId, query) {
    for (const group of getDisplayGroups(query)) {
      const found = group.products.find((product) => product.id === productId);
      if (found) return found;
    }
    return items.find((item) => item.id === productId) || null;
  }

  function getTotalDisplayCount() {
    return groupProductsByBrand(items.filter((item) => matchesBrowseCategoryFilter(item))).length;
  }

  function renderUnifiedList(query) {
    const listEl = $('#unified-list');
    const emptyEl = $('#unified-empty-hint');
    const groups = getDisplayGroups(query);
    const cards = groups.map((group) => renderBrandCard(group));

    if (!cards.length) {
      listEl.innerHTML = '';
      const hasAnyData = items.length > 0;
      emptyEl.hidden = !hasAnyData;
      if (!hasAnyData) {
        emptyEl.textContent = '暂无记录';
      } else if (browseFilter === 'food') {
        emptyEl.textContent = query.trim() ? '没有符合搜索条件的食品库存记录' : '暂无食品分类的库存记录';
      } else if (browseFilter === 'instant') {
        emptyEl.textContent = query.trim() ? '没有符合搜索条件的速食库存记录' : '暂无速食分类的库存记录';
      } else if (browseFilter === 'other') {
        emptyEl.textContent = query.trim() ? '没有符合搜索条件的其他库存记录' : '暂无其他分类的库存记录';
      } else {
        emptyEl.textContent = '没有符合搜索条件的记录';
      }
      return;
    }

    emptyEl.hidden = true;
    listEl.innerHTML = cards.join('');
  }

  function showProductDetail(item) {
    const detailItem = resolveEditItem(item);
    selectedDetail = {
      type: 'product',
      id: detailItem.id,
    };
    showDetailDialog(getBrandName(detailItem), buildProductDetailRows(detailItem));
  }

  async function handleProductDelete(id) {
    const item = resolveEditItem({ id });
    if (!item) return;
    const brand = getBrandName(item);
    const shopInstanceId = getShopInstanceId(item);
    const label = item.flavor ? `${brand} · ${item.flavor}` : brand;
    if (!(await showAppConfirm(`确定删除「${label}」吗？此操作不可撤销。`, '删除确认'))) return;
    const seed = { ...item };
    window.HebingSync?.recordDeletion?.('products', item.id);
    items = items.filter((i) => i.id !== item.id);
    // 删光商品后仍保留品牌登记（名称、地图位置等），方便继续添加商品
    ensureBrandRecordAfterProductRemoval(brand, seed, shopInstanceId);
    saveItems();
    const group = findBrandGroup(brand, shopInstanceId);
    if (group) showBrandDetail(group);
    else closeDetailDialog();
    renderBrowse();
  }

  async function handleBrandDelete(brand, shopInstanceId) {
    const brandName = (brand || '').trim();
    if (!brandName) return;
    const sid = (shopInstanceId || '').trim();
    const targets = items.filter((item) => itemBelongsToShop(item, brandName, sid));
    if (!targets.length) {
      // 还没保存过的新名称，直接关掉即可
      closeDetailDialog();
      renderBrowse();
      return;
    }
    if (!(await showAppConfirm(`确定删除「${brandName}」及其全部商品记录吗？此操作不可撤销。`, '删除确认'))) return;
    targets.forEach((item) => window.HebingSync?.recordDeletion?.('products', item.id));
    items = items.filter((item) => !itemBelongsToShop(item, brandName, sid));
    saveItems();
    closeDetailDialog();
    renderBrowse();
  }

  function itemAlreadyExists(brand, flavor, shopInstanceId) {
    return items.some(
      (item) =>
        itemBelongsToShop(item, brand, shopInstanceId) &&
        (item.flavor || '') === (flavor || ''),
    );
  }

  function migrateShopsToItems() {
    loadShops();
    items = loadItems();
    let changed = false;

    for (const shop of shops) {
      const brand = (shop.name || '').trim() || '未命名';
      const shopLocation = (shop.location || '').trim();
      const shopInstanceId = (shop.id && String(shop.id)) || generateId();
      const shopProducts = getShopProducts(shop);
      const sourceProducts = shopProducts.length ? shopProducts : [{ name: '', rating: shop.rating }];
      const now = new Date().toISOString();

      for (const product of sourceProducts) {
        const flavor = (product.name || '').trim();
        if (itemAlreadyExists(brand, flavor, shopInstanceId)) {
          if (shopLocation) {
            const existing = items.find(
              (item) =>
                itemBelongsToShop(item, brand, shopInstanceId) &&
                (item.flavor || '') === flavor,
            );
            if (existing && !existing.shopLocation) {
              existing.shopLocation = shopLocation;
              existing.shopInstanceId = shopInstanceId;
              existing.updatedAt = now;
              changed = true;
            }
          }
          continue;
        }
        items.push({
          id: generateId(),
          name: brand,
          shopInstanceId,
          flavor,
          shopName: brand,
          shopLocation,
          rating: product.rating ?? shop.rating ?? 3,
          storageLocation: '',
          category: '',
          quantity: null,
          price: null,
          weight: null,
          singleWeight: null,
          notes: '',
          createdAt: shop.createdAt || now,
          updatedAt: now,
        });
        changed = true;
      }
    }

    if (changed) saveItems();
  }

  function migrateShopRecords(records) {
    const now = new Date().toISOString();
    const migrated = [];
    for (const shop of normalizeShops(records)) {
      const brand = (shop.name || '').trim() || '未命名';
      const shopLocation = (shop.location || '').trim();
      const shopInstanceId = (shop.id && String(shop.id)) || generateId();
      const shopProducts = shop.products || (shop.product ? [shop.product] : []);
      const sourceProducts = shopProducts.length ? shopProducts : [{ name: '', rating: shop.rating }];
      for (const product of sourceProducts) {
        const flavor = (product.name || '').trim();
        migrated.push({
          id: generateId(),
          name: brand,
          shopInstanceId,
          flavor,
          shopName: brand,
          shopLocation,
          rating: product.rating ?? shop.rating ?? 3,
          storageLocation: '',
          category: '',
          quantity: null,
          price: null,
          weight: null,
          singleWeight: null,
          notes: '',
          createdAt: shop.createdAt || now,
          updatedAt: now,
        });
      }
    }
    return migrated;
  }

  function ensureUnifiedFormat() {
    if (!localStorage.getItem(UNIFIED_MIGRATION_KEY)) {
      migrateShopsToItems();
      localStorage.setItem(UNIFIED_MIGRATION_KEY, '1');
    }
    items = loadItems();
  }

  /* ========== Shop module ========== */

  function saveShops() {
    localStorage.setItem(SHOP_STORAGE_KEY, JSON.stringify(shops));
    window.HebingSync?.scheduleCloudSync?.();
  }

  function getShopProducts(shop) {
    return shop.products || (shop.product ? [shop.product] : []);
  }

  function getShopSearchText(shop) {
    const productNames = getShopProducts(shop)
      .map((p) => p.name)
      .join(' ');
    return `${shop.name} ${shop.location} ${productNames}`.toLowerCase();
  }

  function findProductForShop(shop) {
    const shopName = (shop.name || '').trim();
    const shopLocation = (shop.location || '').trim();
    const linked = items.find((item) => {
      const info = getProductShopInfo(item);
      return info.shopName === shopName && info.shopLocation === shopLocation;
    });
    if (linked) return linked;

    for (const product of getShopProducts(shop)) {
      const item = items.find((i) => i.name === product.name);
      if (item) return item;
    }
    return null;
  }

  function renderShopCard(shop) {
    const linked = findProductForShop(shop);
    if (linked) {
      return renderProductCard(linked, { type: 'shop', id: shop.id, productId: linked.id });
    }

    const isLow = isLowRating(shop.rating);
    const products = getShopProducts(shop);
    const meta = [
      `<span>店铺名称：${escapeHtml(shop.name) || '—'}</span>`,
      `<span>店铺位置：${formatLocationWithGeo(shop.location, shop.lng, shop.lat)}</span>`,
      products.length > 0 && `<span>${products.length} 件商品</span>`,
    ]
      .filter(Boolean)
      .join('');

    return `
      <li class="item-card" data-type="shop" data-id="${escapeHtml(shop.id)}">
        <div class="item-header">
          <h3 class="item-name">${escapeHtml(shop.name)}</h3>
          ${renderStarsDisplay(shop.rating, isLow)}
        </div>
        ${meta ? `<div class="item-meta">${meta}</div>` : ''}
      </li>`;
  }

  function buildShopDetailRows(shop) {
    const isLow = isLowRating(shop.rating);
    const rows = [
      ['评分', renderStarsDisplay(shop.rating, isLow)],
      ['店铺位置', formatLocationWithGeo(shop.location, shop.lng, shop.lat)],
    ];
    const products = getShopProducts(shop);
    if (!products.length) {
      rows.push(['商品', '—']);
      return rows;
    }
    products.forEach((product, index) => {
      const suffix = products.length > 1 ? String(index + 1) : '';
      const pLow = isLowRating(product.rating);
      rows.push([`商品${suffix}`, escapeHtml(product.name) || '—']);
      rows.push([`商品评分${suffix}`, renderStarsDisplay(product.rating, pLow)]);
    });
    return rows;
  }

  function showShopDetail(shop) {
    const linked = findProductForShop(shop);
    if (linked) {
      showProductDetail(linked);
      return;
    }

    showBrandDetail(shopToBrandGroup(shop));
  }

  async function deleteShop(shopId) {
    if (!(await showAppConfirm('确定要删除该商店及其商品记录吗？', '删除确认'))) return;
    window.HebingSync?.recordDeletion?.('shops', shopId);
    shops = shops.filter((s) => s.id !== shopId);
    saveShops();
    if (selectedDetail?.type === 'shop' && selectedDetail.id === shopId) {
      closeDetailDialog();
    }
    renderBrowse();
  }

  function getFilteredShops(query) {
    const q = (query || '').trim().toLowerCase();
    return shops.filter((shop) => !q || getShopSearchText(shop).includes(q));
  }

  function clearItemHighlight() {
    $$('.item-card.highlight').forEach((card) => card.classList.remove('highlight'));
  }

  function highlightItemCard(type, id, brand, shopInstanceId) {
    clearItemHighlight();
    let card;
    if (type === 'brand') {
      const sid = (shopInstanceId || '').trim();
      if (sid) {
        card = document.querySelector(
          `.item-card[data-type="brand"][data-shop-instance-id="${CSS.escape(sid)}"]`,
        );
      }
      if (!card && brand) {
        card = document.querySelector(`.item-card[data-type="brand"][data-brand="${CSS.escape(brand)}"]`);
      }
    } else {
      card = document.querySelector(`.item-card[data-type="${type}"][data-id="${id}"]`);
    }
    if (card) card.classList.add('highlight');
  }

  /* ========== Unified browse ========== */
  function renderBrowse() {
    items = loadItems();

    const query = $('#unified-search').value;
    updateBrowseCategoryChips();
    renderUnifiedList(query);
    clearItemHighlight();

    const totalEntries = getTotalDisplayCount();
    const shownTotal = getDisplayGroups(query).length;

    $('#browse-summary').textContent =
      totalEntries === 0
        ? browseFilter === 'food'
          ? '暂无食品分类的库存记录'
          : browseFilter === 'instant'
            ? '暂无速食分类的库存记录'
            : browseFilter === 'other'
              ? '暂无其他分类的库存记录'
              : ''
        : `共 ${totalEntries} 条记录；当前显示 ${shownTotal} 条`;

    const globalEmpty = $('#global-empty-hint');
    const hasAnyData = items.length > 0;
    const hasResults = shownTotal > 0;
    const panelBrowse = $('#panel-browse');
    if (panelBrowse) panelBrowse.classList.toggle('has-browse-content', hasAnyData || !!query.trim());

    if (!hasAnyData) {
      globalEmpty.hidden = true;
      $('#browse-results').hidden = false;
      const banner = $('#no-data-banner');
      if (banner) banner.hidden = false;
      updateSearchAddPrompt(query, hasResults);
    } else {
      const banner = $('#no-data-banner');
      if (banner) banner.hidden = true;
      $('#browse-results').hidden = false;
      updateSearchAddPrompt(query, hasResults);
    }

    updateUnifiedSuggestions();
  }

  function updateUnifiedSuggestions() {
    const container = $('#unified-suggestions');
    const query = $('#unified-search').value.trim().toLowerCase();
    if (!query) {
      container.innerHTML = '';
      container.classList.add('hidden');
      return;
    }

    const matches = groupProductsByBrand(getFilteredProducts(query))
      .slice(0, 8)
      .map((group) => {
        const locInfo = getBrandShopLocationInfo(group);
        const locText = (locInfo.shopLocation || locInfo.shopMapAddress || '').trim();
        return {
          type: 'brand',
          brand: group.brand,
          shopInstanceId: group.shopInstanceId,
          locText,
          stockClass: getSearchSuggestionClass(group),
          stockedCount: group.products.filter(hasStockQuantity).length,
        };
      });

    if (!matches.length) {
      container.innerHTML = '';
      container.classList.add('hidden');
      return;
    }

    container.innerHTML = matches
      .map(
        (m) => `
          <div class="search-suggestion-item ${m.stockClass}" data-type="${m.type}" data-brand="${escapeHtml(m.brand)}" data-shop-instance-id="${escapeHtml(m.shopInstanceId || '')}">
            <span class="search-suggestion-brand">${escapeHtml(m.brand)}</span>
            ${m.locText ? `<span class="search-suggestion-loc">${escapeHtml(m.locText)}</span>` : ''}
            ${m.stockedCount > 0 ? `<span class="stock-badge">${m.stockedCount} 种有库存</span>` : ''}
          </div>`,
      )
      .join('');
    container.classList.remove('hidden');
  }

  function handleUnifiedSuggestionClick(event) {
    const item = event.target.closest('.search-suggestion-item');
    if (!item) return;
    const { type, id } = item.dataset;
    if (type === 'brand') {
      const brand = item.dataset.brand;
      const shopInstanceId = item.dataset.shopInstanceId || '';
      if (brand) {
        $('#unified-search').value = brand;
        renderBrowse();
        highlightItemCard('brand', null, brand, shopInstanceId);
        const card = shopInstanceId
          ? document.querySelector(
              `.item-card[data-type="brand"][data-shop-instance-id="${CSS.escape(shopInstanceId)}"]`,
            )
          : document.querySelector(`.item-card[data-type="brand"][data-brand="${CSS.escape(brand)}"]`);
        if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    } else if (type === 'product') {
      const product = items.find((i) => i.id === id);
      if (product) {
        $('#unified-search').value = getBrandName(product);
        renderBrowse();
        highlightItemCard('brand', null, getBrandName(product), getShopInstanceId(product));
        const card = document.querySelector(
          `.item-card[data-type="brand"][data-shop-instance-id="${CSS.escape(getShopInstanceId(product))}"]`,
        );
        if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
    $('#unified-suggestions').classList.add('hidden');
  }

  function updateSyncStatusBanner(result) {
    const banner = $('#sync-status-banner');
    const setupBanner = $('#sync-setup-banner');
    if (!banner) return;

    if (result?.error) {
      banner.hidden = false;
      banner.textContent = '自动同步失败：' + result.error + '。请打开「云端同步」重试。';
      const failHint = $('#sync-fail-hint');
      const failSep = $('#sync-fail-sep');
      if (failHint) failHint.hidden = false;
      if (failSep) failSep.hidden = false;
      if (setupBanner && window.HebingSync?.isGithubApiMode?.() && !HebingSync.hasGithubToken?.()) {
        setupBanner.hidden = false;
      }
      return;
    }

    banner.hidden = true;
    banner.textContent = '';
    const failHint = $('#sync-fail-hint');
    const failSep = $('#sync-fail-sep');
    if (failHint) failHint.hidden = true;
    if (failSep) failSep.hidden = true;

    // 已拉取合并但未保存令牌：提醒一次，本机修改还不能自动上传
    if (setupBanner) {
      const needsToken =
        result?.needsToken ||
        (window.HebingSync?.isGithubApiMode?.() && !HebingSync.hasGithubToken?.());
      setupBanner.hidden = !needsToken;
    }
  }

  /* ========== Init ========== */
  async function init() {
    tryRecoverPendingData();
    ensureUnifiedFormat();

    let bootstrapResult = null;
    if (window.HebingSync?.bootstrap) {
      bootstrapResult = await HebingSync.bootstrap();
      items = loadItems();
      loadShops();
      updateSyncStatusBanner(bootstrapResult);
    } else if (window.HebingSync?.isGithubApiMode?.() && !HebingSync.hasGithubToken?.()) {
      const setupBanner = $('#sync-setup-banner');
      if (setupBanner) setupBanner.hidden = false;
    }

    productEls.dialogClose.addEventListener('click', () => {
      handleDetailLayerBack();
    });
    productEls.dialogHeaderEditBtn?.addEventListener('click', () => {
      if (isDetailInteractionSuppressed()) return;
      if (!selectedDetail || selectedDetail.type !== 'brand' || dialogEditMode) return;
      startBrandNameEdit(selectedDetail.brand, selectedDetail.shopInstanceId);
    });
    productEls.dialogBrandDeleteBtn?.addEventListener('click', async () => {
      if (!selectedDetail || selectedDetail.type !== 'brand' || !selectedDetail.renaming) return;
      await handleBrandDelete(selectedDetail.brand, selectedDetail.shopInstanceId);
    });
    productEls.dialogNameInput?.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      if (!dialogEditMode || selectedDetail?.type !== 'brand' || !selectedDetail.renaming) return;
      event.preventDefault();
      saveBrandNameFromDialog();
    });
    productEls.dialogEditBtn.addEventListener('click', async () => {
      if (!selectedDetail) return;
      // 非编辑态（如「添加新商品」）屏蔽地图穿透；编辑态保存仍要可用
      if (!dialogEditMode && isDetailInteractionSuppressed()) return;
      if (dialogEditMode) {
        if (selectedDetail.type === 'brand' && selectedDetail.renaming) {
          saveBrandNameFromDialog();
          return;
        }
        if (selectedDetail.type === 'shop') {
          saveShopFromDialog();
          return;
        }
        await saveProductFromDialog();
        return;
      }
      const { type, id } = selectedDetail;
      if (type === 'brand') {
        startAddProductForBrand(selectedDetail.brand, selectedDetail.shopInstanceId);
      } else if (type === 'product') {
        const item = resolveEditItem({ id });
        if (item) showProductEditDialog(item);
      }
    });
    productEls.dialogDeleteBtn.addEventListener('click', async () => {
      if (!selectedDetail) return;
      if (dialogEditMode) {
        if (selectedDetail.type === 'brand' && selectedDetail.renaming) {
          cancelDialogEdit();
          return;
        }
        if (selectedDetail.isNew || selectedDetail.type === 'shop') {
          cancelDialogEdit();
          return;
        }
        if (selectedDetail.type === 'product') {
          await handleProductDelete(selectedDetail.id);
        }
        return;
      }
      const { type, id } = selectedDetail;
      if (type === 'product') {
        await handleProductDelete(id);
      }
    });
    productEls.detailDialog.addEventListener('click', (e) => {
      // 地图选点打开时（含 SDK 加载中），不要点穿关掉下层详情
      if (
        window.AmapPicker?.isPickerOverlayOpen?.() ||
        window.AmapPicker?.isOpen?.()
      ) {
        return;
      }
      if (e.target === productEls.detailDialog) handleDetailLayerBack();
    });
    productEls.detailDialog.addEventListener('cancel', (e) => {
      if (
        window.AmapPicker?.isPickerOverlayOpen?.() ||
        window.AmapPicker?.isOpen?.()
      ) {
        e.preventDefault();
        return;
      }
      e.preventDefault();
      handleDetailLayerBack();
    });

    $('#unified-search').addEventListener('input', renderBrowse);
    $('#browse-category-chips')?.addEventListener('click', (event) => {
      const chip = event.target.closest('[data-browse-filter]');
      if (!chip) return;
      browseFilter = chip.dataset.browseFilter || 'all';
      renderBrowse();
    });
    $('#browse-map-btn')?.addEventListener('click', () => {
      openBrowseMapView();
    });
    $('#unified-search').addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      const query = $('#unified-search').value;
      if (!query.trim()) return;
      // 没结果：回车直接确认添加；有结果：用「新建店铺」按钮，避免误触
      if (!getDisplayGroups(query).length) {
        showSearchAddConfirm(query);
      }
    });
    $('#search-add-trigger-btn').addEventListener('click', () => {
      showSearchAddConfirm($('#unified-search').value);
    });
    $('#search-add-confirm-ok').addEventListener('click', confirmSearchAdd);
    $('#search-add-confirm-cancel').addEventListener('click', closeSearchAddConfirm);
    $('#search-add-confirm-close').addEventListener('click', closeSearchAddConfirm);
    $('#search-add-confirm-dialog').addEventListener('cancel', (event) => {
      event.preventDefault();
      closeSearchAddConfirm();
    });
    $('#search-add-confirm-dialog').addEventListener('click', (event) => {
      if (event.target === $('#search-add-confirm-dialog')) closeSearchAddConfirm();
    });
    $('#app-message-dialog-ok')?.addEventListener('click', () => closeAppMessageDialog(true));
    $('#app-message-dialog-cancel')?.addEventListener('click', () => closeAppMessageDialog(false));
    $('#app-message-dialog-close')?.addEventListener('click', () => closeAppMessageDialog(false));
    $('#app-message-dialog')?.addEventListener('cancel', (event) => {
      event.preventDefault();
      closeAppMessageDialog(false);
    });
    $('#app-message-dialog')?.addEventListener('click', (event) => {
      if (event.target === $('#app-message-dialog')) closeAppMessageDialog(false);
    });
    $('#unified-suggestions').addEventListener('click', handleUnifiedSuggestionClick);

    const listClickGuard = createClickGuard();
    const dialogRowClickGuard = createClickGuard();

    $('#unified-list').addEventListener('mousedown', (event) => {
      listClickGuard.onMouseDown(event, event.target.closest('.item-card'));
    });
    $('#unified-list').addEventListener('mouseup', (event) => {
      listClickGuard.onMouseUp(event);
    });

    function handleBrowseCardClick(event) {
      const card = event.target.closest('.item-card');
      if (!card) return;
      if (!listClickGuard.shouldHandleClick(event)) return;
      const { brand, shopInstanceId } = card.dataset;
      if (!brand) return;
      const query = $('#unified-search').value;
      const group =
        findBrandGroup(brand, shopInstanceId) ||
        getDisplayGroups(query).find(
          (g) => g.brand === brand && (!shopInstanceId || g.shopInstanceId === shopInstanceId),
        );
      if (group) showBrandDetail(group);
    }

    productEls.dialogBody.addEventListener('mousedown', (event) => {
      dialogRowClickGuard.onMouseDown(event, event.target.closest('.brand-product-row'));
    });
    productEls.dialogBody.addEventListener(
      'touchstart',
      (event) => {
        if (event.touches.length !== 1) return;
        const row = event.target.closest('.brand-product-row');
        if (!row) return;
        const touch = event.touches[0];
        dialogRowClickGuard.onMouseDown(
          { clientX: touch.clientX, clientY: touch.clientY },
          row,
        );
      },
      { passive: true },
    );
    productEls.dialogBody.addEventListener('mouseup', (event) => {
      dialogRowClickGuard.onMouseUp(event);
    });
    productEls.dialogBody.addEventListener('click', (event) => {
      const row = event.target.closest('.brand-product-row');
      if (!row) return;
      if (isDetailInteractionSuppressed()) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (!dialogRowClickGuard.shouldHandleClick(event)) return;
      const query = $('#unified-search').value;
      const item = findDisplayProduct(row.dataset.productId, query);
      if (item) showProductEditDialog(item);
    });

    $('#unified-list').addEventListener('click', handleBrowseCardClick);

    document.addEventListener('click', (event) => {
      const unifiedSearch = $('#unified-search');
      const unifiedSuggestions = $('#unified-suggestions');
      if (!unifiedSuggestions.contains(event.target) && event.target !== unifiedSearch) {
        unifiedSuggestions.classList.add('hidden');
      }
    });

    renderBrowse();
  }

  init().catch(function (err) {
    console.error('初始化失败', err);
  });
})();
