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

  function formatRating(rating) {
    const r = normalizeRating(rating);
    if (r <= 0) return '—';
    return Number.isInteger(r) ? String(r) : r.toFixed(1);
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
      $('#app-message-dialog-title').textContent = title;
      $('#app-message-dialog-text').textContent = message;
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
    const v = Number(value) > 0 ? normalizeRating(value) : (defaultWhenEmpty ?? 0);
    if (hiddenInput) hiddenInput.value = v > 0 ? String(v) : '';
    if (ratingDisplayEl) {
      ratingDisplayEl.textContent = v > 0 ? `${formatRating(v)} 星` : '—';
    }
    if (!starContainer) return;
    starContainer.querySelectorAll('.star').forEach((star) => {
      const starValue = Number(star.dataset.value);
      star.classList.remove('active', 'half');
      if (v >= starValue) star.classList.add('active');
      else if (v >= starValue - 0.5) star.classList.add('half');
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
    return (value) => setStarsState(starContainer, hiddenInput, ratingDisplayEl, value, defaultWhenEmpty);
  }

  function renderStarsDisplay(value, lowClass) {
    const r = Number(value) > 0 ? normalizeRating(value) : 0;
    const parts = [];
    for (let i = 1; i <= 5; i++) {
      if (r >= i) parts.push('<span class="star-icon full">★</span>');
      else if (r >= i - 0.5) parts.push('<span class="star-icon half">★</span>');
      else parts.push('<span class="star-icon empty">☆</span>');
    }
    const ratingText = r > 0 ? `${formatRating(r)}星` : '—';
    return `<span class="item-stars${lowClass ? ' low' : ''}">${parts.join('')}<span class="rating-num">${ratingText}</span></span>`;
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
    const ratingText = score > 0 ? `${formatRating(score)}星` : '—';
    const indexAttr = index != null ? ` data-index="${index}"` : '';
    return `<span class="star-rating rateable" data-id="${escapeHtml(id)}" data-type="${type}"${indexAttr}>${buttons}<span class="rating-num">${ratingText}</span></span>`;
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
    dialogBody: $('#dialog-body'),
    dialogClose: $('#dialog-close'),
    dialogEditBtn: $('#dialog-edit-btn'),
    dialogDeleteBtn: $('#dialog-delete-btn'),
  };

  let dialogEditMode = false;
  let dialogSetStars = null;

  function setDialogViewMode() {
    dialogEditMode = false;
    dialogSetStars = null;
    productEls.dialogEditBtn.textContent = '编辑';
    productEls.dialogEditBtn.className = 'btn btn-primary';
    productEls.dialogEditBtn.hidden = false;
    productEls.dialogDeleteBtn.textContent = '删除';
    productEls.dialogDeleteBtn.className = 'btn btn-danger';
    productEls.dialogDeleteBtn.hidden = false;
    productEls.detailDialog.classList.remove('dialog-editing');
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

  function renderProductEditForm(item, shopLocation) {
    const unitPrice = formatUnitPrice(item.price, item.weight);
    const showUnitPrice = unitPrice !== '—';
    const showStockFields = hasStockQuantity(item);
    return `
      <form id="dialog-edit-form" class="dialog-edit-form" onsubmit="return false">
        <div class="form-row form-row-key form-row-key-brand">
          <label for="dialog-name">品牌 <span class="required">*</span></label>
          <input type="text" id="dialog-name" required value="${escapeHtml(item.name)}">
        </div>
        <div class="form-row form-row-key form-row-key-name">
          <label for="dialog-flavor">商品名1</label>
          <input type="text" id="dialog-flavor" value="${escapeHtml(item.flavor || '')}" placeholder="请输入商品名1">
        </div>
        <div class="form-row">
          <label>评分</label>
          <div class="star-rating-wrap">
            <div class="star-rating" id="dialog-star-rating">
              <button type="button" class="star" data-value="1" aria-label="1星">★</button>
              <button type="button" class="star" data-value="2" aria-label="2星">★</button>
              <button type="button" class="star" data-value="3" aria-label="3星">★</button>
              <button type="button" class="star" data-value="4" aria-label="4星">★</button>
              <button type="button" class="star" data-value="5" aria-label="5星">★</button>
            </div>
            <span class="rating-current" id="dialog-rating-current">${formatRating(item.rating)} 星</span>
          </div>
          <input type="hidden" id="dialog-rating" value="${item.rating || 3}">
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
        <div class="form-row">
          <label for="dialog-shop-location">店铺位置</label>
          <input type="text" id="dialog-shop-location" value="${escapeHtml(shopLocation || '')}">
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
    const score = Number(item.rating) > 0 ? normalizeRating(item.rating) : 3;
    const quantity = item.quantity != null ? item.quantity : '';
    const showStockFields = hasStockQuantity(item);
    const price = item.price != null ? item.price : '';
    let starButtons = '';
    for (let i = 1; i <= 5; i++) {
      let cls = 'star';
      if (score >= i) cls += ' active';
      else if (score >= i - 0.5) cls += ' half';
      starButtons += `<button type="button" class="${cls}" data-value="${i}" aria-label="${i}星">★</button>`;
    }
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
          <div class="star-rating-wrap">
            <div class="star-rating extra-star-rating">
              ${starButtons}
            </div>
            <span class="rating-current extra-rating-current">${formatRating(score)} 星</span>
          </div>
          <input type="hidden" class="extra-rating" value="${score}">
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
    bindStarRating(starContainer, hiddenInput, ratingDisplay, 3)(rating || 3);
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
    bindExtraProductRow(row, item.rating ?? 3);
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
          rating: normalizeRating(row.querySelector('.extra-rating')?.value || 3),
        }),
      )
      .filter((item) => item.flavor);
  }

  function buildAdditionalProductData(baseData, extra, now) {
    return {
      id: generateId(),
      name: baseData.name,
      brand: '',
      flavor: extra.flavor,
      category: hasStockQuantity(extra) ? (extra.category || '').trim() : '',
      storageLocation: hasStockQuantity(extra) ? (extra.storageLocation || '').trim() : '',
      quantity: extra.quantity,
      shopName: '',
      shopLocation: baseData.shopLocation || '',
      price: extra.price,
      weight: null,
      singleWeight: null,
      rating: extra.rating,
      notes: '',
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

  function finishProductSave(brand) {
    setDialogViewMode();
    const group = groupProductsByBrand(items).find((g) => g.brand === brand);
    if (group) showBrandDetail(group);
    else closeDetailDialog();
    renderBrowse();
  }

  function bindDialogProductEdit(item) {
    const starContainer = $('#dialog-star-rating');
    const hiddenInput = $('#dialog-rating');
    const ratingDisplay = $('#dialog-rating-current');
    dialogSetStars = bindStarRating(starContainer, hiddenInput, ratingDisplay, 3);
    dialogSetStars(item.rating || 3);
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
    return sanitizeProductStockFields({
      name: ($('#dialog-name')?.value || '').trim(),
      brand: '',
      flavor: ($('#dialog-flavor')?.value || '').trim(),
      category: ($('#dialog-category')?.value || '').trim(),
      storageLocation: ($('#dialog-storage-location')?.value || '').trim(),
      quantity: $('#dialog-quantity')?.value !== '' ? parseInt($('#dialog-quantity').value, 10) : null,
      shopName: '',
      shopLocation: ($('#dialog-shop-location')?.value || '').trim(),
      price: $('#dialog-price')?.value !== '' ? parseFloat($('#dialog-price').value) : null,
      weight: $('#dialog-weight')?.value !== '' ? parseFloat($('#dialog-weight').value) : null,
      singleWeight: $('#dialog-single-weight')?.value !== '' ? parseFloat($('#dialog-single-weight').value) : null,
      rating: normalizeRating($('#dialog-rating')?.value || 3),
    });
  }

  function showProductEditDialog(item) {
    const editItem = resolveEditItem(item);
    dialogEditMode = true;
    selectedDetail = { type: 'product', id: editItem.id };
    const shopLocation = editItem.shopLocation || getProductShopInfo(editItem).shopLocation;
    productEls.dialogTitle.textContent = editItem.name || '编辑';
    productEls.dialogBody.innerHTML = renderProductEditForm(editItem, shopLocation);
    bindDialogProductEdit(editItem);
    productEls.dialogEditBtn.textContent = '保存';
    productEls.dialogEditBtn.className = 'btn btn-primary';
    productEls.dialogEditBtn.hidden = false;
    productEls.dialogDeleteBtn.textContent = '删除';
    productEls.dialogDeleteBtn.className = 'btn btn-danger';
    productEls.dialogDeleteBtn.hidden = false;
    productEls.detailDialog.classList.add('dialog-editing');
    if (!productEls.detailDialog.open) productEls.detailDialog.showModal();
    $('#dialog-name')?.focus();
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
      $('#dialog-name')?.focus();
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

    if (selectedDetail.isNew) {
      if (hasMainProductContent(data)) {
        items.push({ id: generateId(), ...data, createdAt: now, updatedAt: now });
      }
      extras.forEach((extra) => {
        items.push(buildAdditionalProductData(data, extra, now));
      });
      saveItems();
      searchAddPendingQuery = null;
      finishProductSave(brand);
      return;
    }

    let idx = items.findIndex((i) => i.id === selectedDetail.id);
    if (idx === -1) {
      if (hasMainProductContent(data)) {
        items.push({ id: generateId(), ...data, createdAt: now, updatedAt: now });
      }
    } else {
      items[idx] = { ...items[idx], ...data, updatedAt: now };
    }
    extras.forEach((extra) => {
      items.push(buildAdditionalProductData(data, extra, now));
    });
    saveItems();
    finishProductSave(brand);
  }

  function renderShopEditForm(shop) {
    return `
      <form id="dialog-edit-form" class="dialog-edit-form" onsubmit="return false">
        <div class="form-row">
          <label for="dialog-shop-location">店铺位置</label>
          <input type="text" id="dialog-shop-location" value="${escapeHtml(shop.location || '')}">
        </div>
        <div class="form-row">
          <label>评分</label>
          <div class="star-rating-wrap">
            <div class="star-rating" id="dialog-star-rating">
              <button type="button" class="star" data-value="1" aria-label="1星">★</button>
              <button type="button" class="star" data-value="2" aria-label="2星">★</button>
              <button type="button" class="star" data-value="3" aria-label="3星">★</button>
              <button type="button" class="star" data-value="4" aria-label="4星">★</button>
              <button type="button" class="star" data-value="5" aria-label="5星">★</button>
            </div>
            <span class="rating-current" id="dialog-rating-current">${formatRating(shop.rating)} 星</span>
          </div>
          <input type="hidden" id="dialog-rating" value="${shop.rating || 3}">
        </div>
      </form>
    `;
  }

  function showShopEditDialog(shop) {
    dialogEditMode = true;
    selectedDetail = { type: 'shop', id: shop.id };
    productEls.dialogTitle.textContent = shop.name || '编辑';
    productEls.dialogBody.innerHTML = renderShopEditForm(shop);
    bindDialogProductEdit({ rating: shop.rating || 3 });
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
    shop.location = ($('#dialog-shop-location')?.value || '').trim();
    shop.rating = normalizeRating($('#dialog-rating')?.value || 3);
    saveShops();
    setDialogViewMode();
    showShopDetail(shop);
    renderBrowse();
  }

  function cancelDialogEdit() {
    if (!selectedDetail) return;
    const { type, id, isNew, brand } = selectedDetail;
    setDialogViewMode();
    if (type === 'product') {
      if (isNew && brand) {
        const group = groupProductsByBrand(items).find((g) => g.brand === brand);
        if (group) showBrandDetail(group);
        else closeDetailDialog();
        return;
      }
      const item = resolveEditItem({ id });
      if (item) showProductDetail(item);
      else closeDetailDialog();
    } else {
      closeDetailDialog();
    }
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
      if (changed) {
        localStorage.setItem(PRODUCT_STORAGE_KEY, JSON.stringify(sanitized));
      }
      return sanitized;
    } catch {
      return [];
    }
  }

  function saveItems() {
    localStorage.setItem(PRODUCT_STORAGE_KEY, JSON.stringify(items));
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
    productEls.dialogTitle.textContent = title;
    productEls.dialogBody.innerHTML = renderDetailBody(rows);
    productEls.dialogEditBtn.hidden = false;
    productEls.dialogDeleteBtn.hidden = false;
    productEls.detailDialog.showModal();
  }

  function closeDetailDialog() {
    productEls.detailDialog.close();
    selectedDetail = null;
    setDialogViewMode();
  }

  function getProductShopInfo(item) {
    return {
      shopName: (item.shopName || '').trim(),
      shopLocation: (item.shopLocation || '').trim(),
    };
  }

  function getBrandName(item) {
    return (item.name || '').trim() || '未命名';
  }

  const PRODUCT_CATEGORIES = ['食品', '其他'];

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

  function renderBrandStockBadge(products, count) {
    if (count === 1) return renderStockBadge(products[0]);
    const stocked = products.filter(hasStockQuantity);
    if (!stocked.length) return '';
    return `<span class="stock-badge">${stocked.length} 种有库存</span>`;
  }

  function getSearchSuggestionClass(group) {
    const stocked = group.products.find(hasStockQuantity);
    const ref = stocked || { id: group.brand, name: group.brand, flavor: group.brand };
    return `in-stock ${STOCK_COLOR_CLASSES[getStockColorIndex(ref)]}`;
  }

  function groupProductsByBrand(productList) {
    const groups = new Map();
    for (const item of productList) {
      const brand = getBrandName(item);
      if (!groups.has(brand)) groups.set(brand, []);
      groups.get(brand).push(item);
    }
    return [...groups.entries()]
      .map(([brand, products]) => {
        const sorted = [...products].sort(compareStockPriority);
        const ratings = sorted.map((p) => Number(p.rating || 0)).filter((r) => r > 0);
        return {
          brand,
          products: sorted,
          maxRating: ratings.length ? Math.max(...ratings) : 0,
          avgRating: ratings.length ? ratings.reduce((s, r) => s + r, 0) / ratings.length : 0,
          hasStock: sorted.some(hasStockQuantity),
        };
      })
      .sort((a, b) => {
        const stockDiff = Number(b.hasStock) - Number(a.hasStock);
        if (stockDiff !== 0) return stockDiff;
        const diff = b.maxRating - a.maxRating;
        if (diff !== 0) return diff;
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
    const { shopName, shopLocation } = getProductShopInfo(item);
    return [
      item.brand && `<span>${escapeHtml(item.brand)}</span>`,
      item.flavor && `<span>${escapeHtml(item.flavor)}</span>`,
      `<span>店铺名称：${escapeHtml(shopName) || '—'}</span>`,
      `<span>店铺位置：${escapeHtml(shopLocation) || '—'}</span>`,
      item.price != null && `<span>${formatPrice(item.price)}</span>`,
      item.weight != null && item.weight > 0 && `<span>${formatWeight(item.weight)}</span>`,
      item.singleWeight != null && item.singleWeight > 0 && `<span>${formatGramWeight(item.singleWeight)}</span>`,
      unitPrice !== '—' && `<span class="meta-unit-price">${unitPrice}</span>`,
    ]
      .filter(Boolean)
      .join('');
  }

  function buildProductDetailRows(item) {
    const isLow = item.rating <= 2;
    const unitPrice = formatUnitPrice(item.price, item.weight);
    const { shopName, shopLocation } = getProductShopInfo(item);
    return [
      ['评分', renderStarsDisplay(item.rating, isLow)],
      ['品牌', escapeHtml(getBrandName(item))],
      ['商品名', escapeHtml(item.flavor) || '—'],
      ['分类', escapeHtml(getItemCategory(item)) || '—'],
      ['所在位置', escapeHtml(getItemStorageLocation(item)) || '—'],
      ['数量', item.quantity != null && item.quantity > 0 ? String(item.quantity) : '—'],
      ['店铺名称', escapeHtml(shopName) || '—'],
      ['店铺位置', escapeHtml(shopLocation) || '—'],
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
    const isLow = item.rating <= 2;
    const meta = buildProductMetaHtml(item);
    const productIdAttr = options.productId ? ` data-product-id="${escapeHtml(options.productId)}"` : '';
    return `
      <li class="item-card ${getStockDisplayClass(item)}" data-type="${type}" data-id="${escapeHtml(cardId)}"${productIdAttr}>
        <div class="item-header">
          <div class="item-title-wrap">
            <h3 class="item-name">${escapeHtml(item.name)}</h3>
            ${renderStockBadge(item)}
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
    const count = products.length;
    const stockedCount = products.filter(hasStockQuantity).length;
    if (stockedCount > 0) {
      return '点击查看全部商品';
    }
    return count === 1 ? '共 1 种商品，点击查看详情' : `共 ${count} 种商品，点击查看详情`;
  }

  function renderBrandCard(group) {
    const { brand, products, maxRating } = group;
    const count = products.length;
    const isLow = maxRating > 0 && maxRating <= 2;
    const displayRating = count === 1 ? products[0].rating : maxRating;
    const stockClass = getBrandStockClass(products);
    const stockPreview = renderBrandStockPreview(products);
    const bodyHtml = `<p class="brand-count-hint">${renderBrandCountHint(products)}</p>`;

    return `
      <li class="item-card brand-card ${stockClass}" data-type="brand" data-brand="${escapeHtml(brand)}">
        <div class="item-header">
          <div class="item-title-wrap">
            <h3 class="item-name">${escapeHtml(brand)}</h3>
            ${renderBrandStockBadge(products, count)}
          </div>
          ${stockPreview}
          <div class="item-header-rating">${renderStarsDisplay(displayRating, isLow)}</div>
        </div>
        ${bodyHtml}
      </li>`;
  }

  function renderBrandDetailBody(group) {
    const { products } = group;
    const rows = products
      .map((item) => {
        const label = item.flavor || '未命名商品';
        const isLow = Number(item.rating) > 0 && Number(item.rating) <= 2;
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

    return `<div class="brand-products-list">${rows}</div>`;
  }

  function showAddProductDialog(brand) {
    const emptyItem = {
      name: brand,
      flavor: '',
      category: '',
      storageLocation: '',
      quantity: null,
      price: null,
      weight: null,
      singleWeight: null,
      rating: 3,
      notes: '',
    };
    dialogEditMode = true;
    selectedDetail = { type: 'product', isNew: true, brand };
    productEls.dialogTitle.textContent = brand;
    productEls.dialogBody.innerHTML = renderProductEditForm(emptyItem, '');
    bindDialogProductEdit(emptyItem);
    productEls.dialogEditBtn.textContent = '保存';
    productEls.dialogDeleteBtn.textContent = '取消';
    productEls.dialogDeleteBtn.className = 'btn btn-secondary';
    productEls.dialogDeleteBtn.hidden = false;
    productEls.detailDialog.classList.add('dialog-editing');
    if (!productEls.detailDialog.open) productEls.detailDialog.showModal();
    $('#dialog-flavor')?.focus();
  }

  function startAddProductForBrand(brand) {
    showAddProductDialog(brand);
  }

  function showSearchAddConfirm(query) {
    const trimmed = (query || '').trim();
    if (!trimmed) return;
    if (getDisplayGroups(trimmed).length > 0) return;
    const dialog = $('#search-add-confirm-dialog');
    if (!dialog) return;
    searchAddPendingQuery = trimmed;
    $('#search-add-confirm-text').textContent = `没有找到「${trimmed}」相关记录，是否添加为新信息？`;
    dialog.showModal();
  }

  function closeSearchAddConfirm() {
    searchAddPendingQuery = null;
    $('#search-add-confirm-dialog')?.close();
  }

  function confirmSearchAdd() {
    const query = searchAddPendingQuery;
    closeSearchAddConfirm();
    if (query) showAddProductDialog(query);
  }

  function updateSearchAddPrompt(query, hasResults) {
    const trimmed = (query || '').trim();
    const hintEl = $('#global-empty-hint');
    const triggerBtn = $('#search-add-trigger-btn');
    if (!hintEl || !triggerBtn) return;

    if (trimmed && !hasResults) {
      hintEl.hidden = false;
      hintEl.textContent = `没有找到「${trimmed}」相关记录。`;
      triggerBtn.hidden = false;
      return;
    }

    hintEl.hidden = true;
    triggerBtn.hidden = true;
  }

  function showBrandDetail(group) {
    selectedDetail = {
      type: 'brand',
      brand: group.brand,
    };
    setDialogViewMode();
    productEls.dialogTitle.textContent = group.brand;
    productEls.dialogBody.innerHTML = renderBrandDetailBody(group);
    productEls.dialogEditBtn.textContent = '添加新商品';
    productEls.dialogEditBtn.hidden = false;
    productEls.dialogDeleteBtn.hidden = true;
    productEls.detailDialog.showModal();
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
    const label = item.flavor ? `${getBrandName(item)} · ${item.flavor}` : getBrandName(item);
    if (!(await showAppConfirm(`确定删除「${label}」吗？此操作不可撤销。`, '删除确认'))) return;
    items = items.filter((i) => i.id !== item.id);
    saveItems();
    closeDetailDialog();
    renderBrowse();
  }

  function itemAlreadyExists(brand, flavor) {
    return items.some(
      (item) => getBrandName(item) === brand && (item.flavor || '') === (flavor || ''),
    );
  }

  function migrateShopsToItems() {
    loadShops();
    items = loadItems();
    let changed = false;

    for (const shop of shops) {
      const brand = (shop.name || '').trim() || '未命名';
      const shopLocation = (shop.location || '').trim();
      const shopProducts = getShopProducts(shop);
      const sourceProducts = shopProducts.length ? shopProducts : [{ name: '', rating: shop.rating }];
      const now = new Date().toISOString();

      for (const product of sourceProducts) {
        const flavor = (product.name || '').trim();
        if (itemAlreadyExists(brand, flavor)) {
          if (shopLocation) {
            const existing = items.find(
              (item) => getBrandName(item) === brand && (item.flavor || '') === flavor,
            );
            if (existing && !existing.shopLocation) {
              existing.shopLocation = shopLocation;
              existing.updatedAt = now;
              changed = true;
            }
          }
          continue;
        }
        items.push({
          id: generateId(),
          name: brand,
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
      const shopProducts = shop.products || (shop.product ? [shop.product] : []);
      const sourceProducts = shopProducts.length ? shopProducts : [{ name: '', rating: shop.rating }];
      for (const product of sourceProducts) {
        const flavor = (product.name || '').trim();
        migrated.push({
          id: generateId(),
          name: brand,
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

    const isLow = Number(shop.rating) > 0 && Number(shop.rating) <= 2;
    const products = getShopProducts(shop);
    const meta = [
      `<span>店铺名称：${escapeHtml(shop.name) || '—'}</span>`,
      `<span>店铺位置：${escapeHtml(shop.location) || '—'}</span>`,
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
    const isLow = Number(shop.rating) > 0 && Number(shop.rating) <= 2;
    const rows = [
      ['评分', renderStarsDisplay(shop.rating, isLow)],
      ['店铺位置', escapeHtml(shop.location) || '—'],
    ];
    const products = getShopProducts(shop);
    if (!products.length) {
      rows.push(['商品', '—']);
      return rows;
    }
    products.forEach((product, index) => {
      const suffix = products.length > 1 ? String(index + 1) : '';
      const pLow = Number(product.rating) > 0 && Number(product.rating) <= 2;
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

  function highlightItemCard(type, id, brand) {
    clearItemHighlight();
    let card;
    if (type === 'brand' && brand) {
      card = document.querySelector(`.item-card[data-type="brand"][data-brand="${CSS.escape(brand)}"]`);
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
          : browseFilter === 'other'
            ? '暂无其他分类的库存记录'
            : ''
        : `共 ${totalEntries} 条记录；当前显示 ${shownTotal} 条`;

    const globalEmpty = $('#global-empty-hint');
    const hasAnyData = items.length > 0;
    const hasResults = shownTotal > 0;
    const clearBtn = $('#clear-search-btn');
    if (clearBtn) clearBtn.hidden = !query.trim();

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
      if (!hasResults && query.trim()) {
        updateSearchAddPrompt(query, hasResults);
      } else {
        updateSearchAddPrompt('', true);
      }
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
      .map((group) => ({
        type: 'brand',
        brand: group.brand,
        stockClass: getSearchSuggestionClass(group),
        stockedCount: group.products.filter(hasStockQuantity).length,
      }));

    if (!matches.length) {
      container.innerHTML = '';
      container.classList.add('hidden');
      return;
    }

    container.innerHTML = matches
      .map(
        (m) => `
          <div class="search-suggestion-item ${m.stockClass}" data-type="${m.type}" data-brand="${escapeHtml(m.brand)}">
            <span class="search-suggestion-brand">${escapeHtml(m.brand)}</span>
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
      if (brand) {
        $('#unified-search').value = brand;
        renderBrowse();
        highlightItemCard('brand', null, brand);
        const card = document.querySelector(`.item-card[data-type="brand"][data-brand="${CSS.escape(brand)}"]`);
        if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    } else if (type === 'product') {
      const product = items.find((i) => i.id === id);
      if (product) {
        $('#unified-search').value = getBrandName(product);
        renderBrowse();
        highlightItemCard('brand', null, getBrandName(product));
        const card = document.querySelector(
          `.item-card[data-type="brand"][data-brand="${CSS.escape(getBrandName(product))}"]`,
        );
        if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
    $('#unified-suggestions').classList.add('hidden');
  }

  /* ========== Init ========== */
  function init() {
    tryRecoverPendingData();
    ensureUnifiedFormat();

    productEls.dialogClose.addEventListener('click', closeDetailDialog);
    productEls.dialogEditBtn.addEventListener('click', async () => {
      if (!selectedDetail) return;
      if (dialogEditMode) {
        await saveProductFromDialog();
        return;
      }
      const { type, id } = selectedDetail;
      if (type === 'brand') {
        startAddProductForBrand(selectedDetail.brand);
      } else if (type === 'product') {
        const item = resolveEditItem({ id });
        if (item) showProductEditDialog(item);
      }
    });
    productEls.dialogDeleteBtn.addEventListener('click', async () => {
      if (!selectedDetail) return;
      if (dialogEditMode) {
        if (selectedDetail.isNew) {
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
      if (e.target === productEls.detailDialog) closeDetailDialog();
    });

    $('#unified-search').addEventListener('input', renderBrowse);
    $('#browse-category-chips')?.addEventListener('click', (event) => {
      const chip = event.target.closest('[data-browse-filter]');
      if (!chip) return;
      browseFilter = chip.dataset.browseFilter || 'all';
      renderBrowse();
    });
    $('#unified-search').addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      const query = $('#unified-search').value;
      if (!getDisplayGroups(query).length && query.trim()) {
        showSearchAddConfirm(query);
      }
    });
    $('#search-add-trigger-btn').addEventListener('click', () => {
      showSearchAddConfirm($('#unified-search').value);
    });
    $('#search-add-confirm-ok').addEventListener('click', confirmSearchAdd);
    $('#search-add-confirm-cancel').addEventListener('click', closeSearchAddConfirm);
    $('#search-add-confirm-close').addEventListener('click', closeSearchAddConfirm);
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
    $('#clear-search-btn').addEventListener('click', clearSearch);
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
      const { brand } = card.dataset;
      if (!brand) return;
      const query = $('#unified-search').value;
      const group = getDisplayGroups(query).find((g) => g.brand === brand);
      if (group) showBrandDetail(group);
    }

    productEls.dialogBody.addEventListener('mousedown', (event) => {
      dialogRowClickGuard.onMouseDown(event, event.target.closest('.brand-product-row'));
    });
    productEls.dialogBody.addEventListener('mouseup', (event) => {
      dialogRowClickGuard.onMouseUp(event);
    });
    productEls.dialogBody.addEventListener('click', (event) => {
      const row = event.target.closest('.brand-product-row');
      if (!row) return;
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

  init();
})();
