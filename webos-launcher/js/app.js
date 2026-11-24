/* ============================================================
   VuTV Launcher — webOS 4.0+
   Loads apps from bundled apps-config.json (dev-mode safe).
   Launching uses public /launch API which is allowed for dev apps.
   ============================================================ */

(function () {
    'use strict';

    var COLS = 8;
    var LONG_PRESS_MS = 700;
    var TOAST_DURATION = 2500;
    var MAX_RECENT = 10;
    var STORAGE_RECENT = 'vutv_recent';
    var STORAGE_FAVS = 'vutv_favs';

    var state = {
        allApps: [],
        recentIds: [],
        favoriteIds: [],
        sections: [],
        currentSection: 0,
        currentIndex: 0,
        modalOpen: false,
        modalFocusIndex: 0,
        longPressTimer: null,
        modalCallback: null
    };

    var dom = {};

    function $(id) { return document.getElementById(id); }

    function cacheDom() {
        dom.recentRow = $('recent-apps');
        dom.favoriteRow = $('favorite-apps');
        dom.allGrid = $('all-apps');
        dom.recentEmpty = $('recent-empty');
        dom.favoritesEmpty = $('favorites-empty');
        dom.timeDisplay = $('time-display');
        dom.dateDisplay = $('date-display');
        dom.content = $('content');
        dom.overlay = $('overlay');
        dom.modalTitle = $('modal-title');
        dom.modalBody = $('modal-body');
        dom.modalOk = $('modal-ok');
        dom.modalCancel = $('modal-cancel');
        dom.toast = $('toast');
        dom.bottomBar = $('bottom-bar');
    }

    // ── Luna bridge ────────────────────────────────────────────
    function lunaCall(uri, params) {
        return new Promise(function (resolve, reject) {
            if (typeof PalmServiceBridge === 'undefined') {
                reject(new Error('PalmServiceBridge unavailable'));
                return;
            }
            var bridge = new PalmServiceBridge();
            bridge.onservicecallback = function (msg) {
                try {
                    var resp = JSON.parse(msg);
                    if (resp.returnValue !== false) resolve(resp);
                    else reject(resp);
                } catch (e) { reject(e); }
            };
            bridge.call(uri, JSON.stringify(params || {}));
        });
    }

    function launchApp(appId) {
        addToRecent(appId);
        return lunaCall('luna://com.webos.applicationManager/launch', { id: appId })
            .catch(function () { showToast('Không thể mở ứng dụng'); });
    }

    // ── Storage ────────────────────────────────────────────────
    function loadJson(key, fallback) {
        try {
            var s = localStorage.getItem(key);
            return s ? JSON.parse(s) : fallback;
        } catch (e) { return fallback; }
    }
    function saveJson(key, val) {
        try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {}
    }

    function addToRecent(id) {
        state.recentIds = [id].concat(state.recentIds.filter(function (x) { return x !== id; })).slice(0, MAX_RECENT);
        saveJson(STORAGE_RECENT, state.recentIds);
    }

    function toggleFavorite(id) {
        var idx = state.favoriteIds.indexOf(id);
        if (idx === -1) {
            state.favoriteIds.push(id);
            showToast('★ Đã thêm vào yêu thích');
        } else {
            state.favoriteIds.splice(idx, 1);
            showToast('Đã xóa khỏi yêu thích');
        }
        saveJson(STORAGE_FAVS, state.favoriteIds);
        renderAll();
    }

    // ── App icon URL ───────────────────────────────────────────
    function getIconUrl(app) {
        if (!app.icon) return '';
        if (app.icon.charAt(0) === '/') return 'file://' + app.icon;
        if (app.folderPath) return 'file://' + app.folderPath + '/' + app.icon;
        return '';
    }

    function initialLetter(title) {
        if (!title) return '?';
        var ch = title.charAt(0).toUpperCase();
        return ch;
    }

    // ── Card creation (DOM API — XSS-safe) ─────────────────────
    function createCard(app) {
        var card = document.createElement('div');
        card.className = 'app-card';
        card.setAttribute('data-app-id', app.id);
        card.setAttribute('tabindex', '0');
        if (state.favoriteIds.indexOf(app.id) !== -1) {
            card.classList.add('is-favorite');
        }

        var badge = document.createElement('span');
        badge.className = 'fav-badge';
        badge.textContent = '★';
        card.appendChild(badge);

        var iconWrap = document.createElement('div');
        iconWrap.className = 'app-icon';
        iconWrap.style.backgroundColor = (app.iconColor || '#4A90E2') + '33';

        var url = getIconUrl(app);
        if (url) {
            var img = document.createElement('img');
            img.alt = '';
            img.addEventListener('load', function () {
                iconWrap.classList.add('has-img');
            });
            img.addEventListener('error', function () {
                var fb = document.createElement('span');
                fb.className = 'icon-fallback';
                fb.textContent = initialLetter(app.title);
                fb.style.color = app.iconColor || '#4A90E2';
                iconWrap.innerHTML = '';
                iconWrap.appendChild(fb);
            });
            img.src = url;
            iconWrap.appendChild(img);
        } else {
            var fb2 = document.createElement('span');
            fb2.className = 'icon-fallback';
            fb2.textContent = initialLetter(app.title);
            fb2.style.color = app.iconColor || '#4A90E2';
            iconWrap.appendChild(fb2);
        }
        card.appendChild(iconWrap);

        var name = document.createElement('span');
        name.className = 'app-name';
        name.textContent = app.title || app.id;
        card.appendChild(name);

        return card;
    }

    function findApp(id) {
        for (var i = 0; i < state.allApps.length; i++) {
            if (state.allApps[i].id === id) return state.allApps[i];
        }
        return null;
    }

    // ── Render ─────────────────────────────────────────────────
    function renderRow(container, ids, emptyEl) {
        container.innerHTML = '';
        var items = [];
        for (var i = 0; i < ids.length; i++) {
            var app = findApp(ids[i]);
            if (!app) continue;
            var card = createCard(app);
            container.appendChild(card);
            items.push({ el: card, appId: ids[i] });
        }
        if (emptyEl) {
            if (items.length === 0) emptyEl.classList.add('visible');
            else emptyEl.classList.remove('visible');
        }
        return items;
    }

    function renderAll() {
        var recentItems = renderRow(dom.recentRow, state.recentIds, dom.recentEmpty);
        var favItems = renderRow(dom.favoriteRow, state.favoriteIds, dom.favoritesEmpty);

        dom.allGrid.innerHTML = '';
        var allItems = [];
        for (var i = 0; i < state.allApps.length; i++) {
            var card = createCard(state.allApps[i]);
            dom.allGrid.appendChild(card);
            allItems.push({ el: card, appId: state.allApps[i].id });
        }

        var bottomItems = [];
        var actionEls = dom.bottomBar.querySelectorAll('.action-item');
        for (var k = 0; k < actionEls.length; k++) {
            bottomItems.push({ el: actionEls[k], action: actionEls[k].getAttribute('data-action') });
        }

        state.sections = [];
        if (recentItems.length > 0) state.sections.push({ type: 'row', items: recentItems, cols: recentItems.length });
        if (favItems.length > 0) state.sections.push({ type: 'row', items: favItems, cols: favItems.length });
        state.sections.push({ type: 'grid', items: allItems, cols: COLS });
        state.sections.push({ type: 'bar', items: bottomItems, cols: bottomItems.length });

        if (state.currentSection >= state.sections.length) state.currentSection = 0;
        var sec = state.sections[state.currentSection];
        if (sec && state.currentIndex >= sec.items.length) state.currentIndex = 0;
        updateFocus();
    }

    // ── Focus / Navigation ─────────────────────────────────────
    function updateFocus() {
        var focused = document.querySelectorAll('.focused');
        for (var i = 0; i < focused.length; i++) focused[i].classList.remove('focused');

        var sec = state.sections[state.currentSection];
        if (!sec || sec.items.length === 0) return;
        var item = sec.items[state.currentIndex];
        if (!item) return;
        item.el.classList.add('focused');
        scrollIntoView(item.el);
    }

    function scrollIntoView(el) {
        var container = dom.content;
        var r = el.getBoundingClientRect();
        var cr = container.getBoundingClientRect();
        var top = 80, bottom = 80;
        if (r.top < cr.top + top) container.scrollTop -= (cr.top + top - r.top + 40);
        else if (r.bottom > cr.bottom - bottom) container.scrollTop += (r.bottom - cr.bottom + bottom + 40);
    }

    function navigate(dir) {
        if (state.modalOpen) {
            if (dir === 'left' || dir === 'right') {
                state.modalFocusIndex = state.modalFocusIndex === 0 ? 1 : 0;
                updateModalFocus();
            }
            return;
        }

        var sec = state.sections[state.currentSection];
        if (!sec) return;

        if (dir === 'left') {
            if (state.currentIndex > 0) state.currentIndex--;
        } else if (dir === 'right') {
            if (state.currentIndex < sec.items.length - 1) state.currentIndex++;
        } else if (dir === 'up') {
            if (sec.type === 'grid') {
                var col = state.currentIndex % sec.cols;
                var row = Math.floor(state.currentIndex / sec.cols);
                if (row > 0) { state.currentIndex = (row - 1) * sec.cols + col; updateFocus(); return; }
            }
            if (state.currentSection > 0) {
                state.currentSection--;
                var newSec = state.sections[state.currentSection];
                if (newSec.type === 'grid') {
                    var preferCol = (sec.type === 'grid') ? (state.currentIndex % sec.cols) : Math.min(state.currentIndex, newSec.cols - 1);
                    var rows = Math.ceil(newSec.items.length / newSec.cols);
                    var lastRowStart = (rows - 1) * newSec.cols;
                    state.currentIndex = Math.min(lastRowStart + preferCol, newSec.items.length - 1);
                } else {
                    state.currentIndex = Math.min(state.currentIndex, newSec.items.length - 1);
                }
            }
        } else if (dir === 'down') {
            if (sec.type === 'grid') {
                var colD = state.currentIndex % sec.cols;
                var rowD = Math.floor(state.currentIndex / sec.cols);
                var totalRows = Math.ceil(sec.items.length / sec.cols);
                if (rowD < totalRows - 1) {
                    var next = (rowD + 1) * sec.cols + colD;
                    state.currentIndex = Math.min(next, sec.items.length - 1);
                    updateFocus();
                    return;
                }
            }
            if (state.currentSection < state.sections.length - 1) {
                state.currentSection++;
                var downSec = state.sections[state.currentSection];
                if (sec.type === 'grid' && downSec.type === 'bar') {
                    var ratio = (state.currentIndex % sec.cols) / sec.cols;
                    state.currentIndex = Math.min(Math.floor(ratio * downSec.items.length), downSec.items.length - 1);
                } else if (sec.type === 'grid' && downSec.type === 'grid') {
                    state.currentIndex = Math.min(state.currentIndex % sec.cols, downSec.items.length - 1);
                } else {
                    state.currentIndex = Math.min(state.currentIndex, downSec.items.length - 1);
                }
            }
        }
        updateFocus();
    }

    function activateCurrent() {
        if (state.modalOpen) { activateModalButton(); return; }
        var sec = state.sections[state.currentSection];
        if (!sec) return;
        var item = sec.items[state.currentIndex];
        if (!item) return;
        item.el.classList.add('pressed');
        setTimeout(function () { item.el.classList.remove('pressed'); }, 150);
        if (item.appId) launchApp(item.appId);
        else if (item.action) handleAction(item.action);
    }

    function longPressCurrent() {
        var sec = state.sections[state.currentSection];
        if (!sec) return;
        var item = sec.items[state.currentIndex];
        if (!item || !item.appId) return;
        toggleFavorite(item.appId);
    }

    // ── Actions ────────────────────────────────────────────────
    function handleAction(action) {
        if (action === 'refresh') loadApps().then(function () { showToast('Đã làm mới'); });
        else if (action === 'info') showInfo();
        else if (action === 'reboot') confirmReboot();
    }

    function showInfo() {
        var body = document.createElement('div');
        function row(label, value) {
            var r = document.createElement('div');
            r.className = 'info-row';
            var l = document.createElement('span'); l.className = 'info-label'; l.textContent = label;
            var v = document.createElement('span'); v.className = 'info-value'; v.textContent = value;
            r.appendChild(l); r.appendChild(v);
            return r;
        }
        body.appendChild(row('Ứng dụng', state.allApps.length + ' app'));
        body.appendChild(row('Yêu thích', state.favoriteIds.length + ' app'));
        body.appendChild(row('Gần đây', state.recentIds.length + ' app'));
        body.appendChild(row('Launcher', 'VuTV v1.0.0'));
        body.appendChild(row('UA', navigator.userAgent.split(' ').slice(-2).join(' ')));
        showModal('Thông tin', body, false);
    }

    function confirmReboot() {
        var body = document.createElement('p');
        body.textContent = 'Khởi động lại TV ngay bây giờ?';
        showModal('Khởi động lại', body, true, function () {
            lunaCall('luna://com.webos.service.sleep/shutdown/machineReboot', { reason: 'remoteKey' })
                .catch(function () { showToast('Không thể khởi động lại'); });
        });
    }

    // ── Modal ──────────────────────────────────────────────────
    function showModal(title, bodyNode, showCancel, onOk) {
        dom.modalTitle.textContent = title;
        dom.modalBody.innerHTML = '';
        if (typeof bodyNode === 'string') dom.modalBody.textContent = bodyNode;
        else dom.modalBody.appendChild(bodyNode);
        state.modalCallback = onOk || null;
        dom.modalCancel.style.display = showCancel ? '' : 'none';
        dom.modalOk.textContent = onOk ? 'Đồng ý' : 'OK';
        dom.overlay.classList.remove('hidden');
        state.modalOpen = true;
        state.modalFocusIndex = 0;
        updateModalFocus();
    }
    function hideModal() {
        dom.overlay.classList.add('hidden');
        state.modalOpen = false;
        state.modalCallback = null;
        updateFocus();
    }
    function updateModalFocus() {
        dom.modalOk.classList.toggle('focused', state.modalFocusIndex === 0);
        dom.modalCancel.classList.toggle('focused', state.modalFocusIndex === 1);
    }
    function activateModalButton() {
        if (state.modalFocusIndex === 0 && state.modalCallback) state.modalCallback();
        hideModal();
    }

    // ── Toast ──────────────────────────────────────────────────
    var toastTimer = null;
    function showToast(msg) {
        dom.toast.textContent = msg;
        dom.toast.classList.remove('hidden');
        dom.toast.classList.add('visible');
        if (toastTimer) clearTimeout(toastTimer);
        toastTimer = setTimeout(function () {
            dom.toast.classList.remove('visible');
        }, TOAST_DURATION);
    }

    // ── Clock ──────────────────────────────────────────────────
    var DAYS = ['Chủ nhật','Thứ hai','Thứ ba','Thứ tư','Thứ năm','Thứ sáu','Thứ bảy'];
    function pad2(n) { n = String(n); return n.length < 2 ? '0' + n : n; }
    function updateClock() {
        var now = new Date();
        dom.timeDisplay.textContent = pad2(now.getHours()) + ':' + pad2(now.getMinutes());
        dom.dateDisplay.textContent = DAYS[now.getDay()] + ', ' + now.getDate() + '/' + (now.getMonth() + 1);
    }

    // ── Keys ───────────────────────────────────────────────────
    var KEY = { LEFT:37, UP:38, RIGHT:39, DOWN:40, ENTER:13, BACK:461, BS:8, ESC:27, RED:403, GREEN:404, YELLOW:405, BLUE:406 };

    function onKeyDown(e) {
        var c = e.keyCode;
        if (c === KEY.LEFT) { navigate('left'); e.preventDefault(); }
        else if (c === KEY.RIGHT) { navigate('right'); e.preventDefault(); }
        else if (c === KEY.UP) { navigate('up'); e.preventDefault(); }
        else if (c === KEY.DOWN) { navigate('down'); e.preventDefault(); }
        else if (c === KEY.ENTER) {
            if (!state.longPressTimer) {
                state.longPressTimer = setTimeout(function () {
                    longPressCurrent();
                    state.longPressTimer = null;
                }, LONG_PRESS_MS);
            }
            e.preventDefault();
        }
        else if (c === KEY.BACK || c === KEY.BS || c === KEY.ESC) {
            if (state.modalOpen) hideModal();
            else {
                state.currentSection = 0;
                state.currentIndex = 0;
                dom.content.scrollTop = 0;
                updateFocus();
            }
            e.preventDefault();
        }
        else if (c === KEY.RED) { longPressCurrent(); e.preventDefault(); }
    }

    function onKeyUp(e) {
        if (e.keyCode === KEY.ENTER) {
            if (state.longPressTimer) {
                clearTimeout(state.longPressTimer);
                state.longPressTimer = null;
                activateCurrent();
            }
            e.preventDefault();
        }
    }

    // ── Load apps from bundled config ──────────────────────────
    var BUNDLED_APPS = [{"id": "com.webos.app.livetv", "title": "Chương trình phát", "icon": "assets/icon_antenna.png", "folderPath": "/usr/palm/applications/com.webos.app.livetv", "iconColor": "#a3c125"}, {"id": "com.webos.app.recordings", "title": "Chương trình đã ghi", "icon": "assets/hd1080/icon.png", "folderPath": "/usr/palm/applications/com.webos.app.recordings", "iconColor": "#c134b9"}, {"id": "com.app.cloudphotovideo", "title": "Cloud Photo & Video", "icon": "icon.png", "folderPath": "/media/cryptofs/apps/usr/palm/applications/com.app.cloudphotovideo", "iconColor": "#4446ac"}, {"id": "com.webos.app.remoteservice", "title": "Dịch vụ từ xa của LG", "icon": "assets/hd1080/icon.png", "folderPath": "/usr/palm/applications/com.webos.app.remoteservice", "iconColor": "#a21d4d"}, {"id": "com.fpt.fptplay", "title": "FPT Play", "icon": "icon.png", "folderPath": "/media/cryptofs/apps/usr/palm/applications/com.fpt.fptplay", "iconColor": "#ffffff"}, {"id": "com.gathin.tvhome", "title": "Home", "icon": "icon.png", "folderPath": "/media/developer/apps/usr/palm/applications/com.gathin.tvhome", "iconColor": "#000000"}, {"id": "org.webosbrew.hbchannel", "title": "Homebrew Channel", "icon": "assets/icon80.png", "folderPath": "/media/developer/apps/usr/palm/applications/org.webosbrew.hbchannel", "iconColor": "#cf0652"}, {"id": "com.webos.app.tvuserguide", "title": "Hướng dẫn sử dụng", "icon": "myAssets/hd1080/icon_userguide.png", "folderPath": "/usr/palm/applications/com.webos.app.tvuserguide", "iconColor": "#ff8a00"}, {"id": "com.iq.app.iqiyiapp", "title": "iQIYI", "icon": "resources/iqiyi_logo.png", "folderPath": "/media/cryptofs/apps/usr/palm/applications/com.iq.app.iqiyiapp", "iconColor": "#00dc5a"}, {"id": "com.webos.app.accessibility", "title": "K.năng tr.cập", "icon": "assets/hd1080/icon.png", "folderPath": "/usr/palm/applications/com.webos.app.accessibility", "iconColor": "#ff7010"}, {"id": "com.mytvb2c.app", "title": "MyTV", "icon": "icon.png", "folderPath": "/media/cryptofs/apps/usr/palm/applications/com.mytvb2c.app", "iconColor": "#ffffff"}, {"id": "netflix", "title": "Netflix", "icon": "SMALL_APP_ICON.png", "folderPath": "/media/cryptofs/apps/usr/palm/applications/netflix", "iconColor": "#ffffff"}, {"id": "com.webos.app.btspeakerapp", "title": "Phát lại âm thanh Bluetooth", "icon": "icon.png", "folderPath": "/usr/palm/applications/com.webos.app.btspeakerapp", "iconColor": "#15346f"}, {"id": "com.webos.app.miracast", "title": "Screen Share", "icon": "assets/hd1080/icon_screenshare.png", "folderPath": "/mnt/otncabi/usr/palm/applications/com.webos.app.miracast", "iconColor": "#2c58b9"}, {"id": "spotify-beehive", "title": "Spotify - Nhạc và Podcast", "icon": "icon.png", "folderPath": "/media/cryptofs/apps/usr/palm/applications/spotify-beehive", "iconColor": "#191414"}, {"id": "com.webos.app.notificationcenter", "title": "Thông báo", "icon": "icon_notification.png", "folderPath": "/usr/palm/applications/com.webos.app.notificationcenter", "iconColor": "#dfb709"}, {"id": "com.webos.app.livemenu", "title": "Thông tin chương trình TV", "icon": "assets/icon.png", "folderPath": "/usr/palm/applications/com.webos.app.livemenu", "iconColor": "#1ec15f"}, {"id": "com.webos.app.browser", "title": "Trình duyệt web", "icon": "assets/hd1080/webbrowser_icon.png", "folderPath": "/media/system/apps/usr/palm/applications/com.webos.app.browser", "iconColor": "#FFFFFF"}, {"id": "com.webos.app.connectionwizard", "title": "Trình kết nối thiết bị", "icon": "assets/hd1080/icon.png", "folderPath": "/usr/palm/applications/com.webos.app.connectionwizard", "iconColor": "#2c94c4"}, {"id": "com.viettel.media.tv360", "title": "TV360", "icon": "icon.png", "folderPath": "/media/cryptofs/apps/usr/palm/applications/com.viettel.media.tv360", "iconColor": "#ed2c25"}, {"id": "vieplay.vn", "title": "VieON", "icon": "icon.png", "folderPath": "/media/cryptofs/apps/usr/palm/applications/vieplay.vn", "iconColor": "#0ad418"}, {"id": "com.vtvgotv.app", "title": "VTVGo cho TV Thông minh", "icon": "icon.png", "folderPath": "/media/cryptofs/apps/usr/palm/applications/com.vtvgotv.app", "iconColor": "#d41f39"}, {"id": "youtube.leanback.v4", "title": "YouTube", "icon": "yt_lg_80x80.png", "folderPath": "/media/cryptofs/apps/usr/palm/applications/youtube.leanback.v4", "iconColor": "#ffffff"}, {"id": "com.webos.app.music", "title": "Âm nhạc", "icon": "assets/hd1080/icon.png", "folderPath": "/usr/palm/applications/com.webos.app.music", "iconColor": "#7d53d3"}, {"id": "com.webos.app.photovideo", "title": "Ảnh & Video", "icon": "assets/hd1080/icon.png", "folderPath": "/usr/palm/applications/com.webos.app.photovideo", "iconColor": "#7c20d5"}, {"id": "com.webos.app.scheduler", "title": "Ứng dụng lập lịch ghi", "icon": "sys-assets/hd1080/icon_scheduler.png", "folderPath": "/usr/palm/applications/com.webos.app.scheduler", "iconColor": "#00a844"}];

    function loadApps() {
        return new Promise(function (resolve) {
            state.allApps = BUNDLED_APPS;
            renderAll();
            resolve(BUNDLED_APPS);
        });
    }

    // ── Init ───────────────────────────────────────────────────
    function init() {
        cacheDom();
        state.recentIds = loadJson(STORAGE_RECENT, []);
        state.favoriteIds = loadJson(STORAGE_FAVS, []);
        updateClock();
        setInterval(updateClock, 1000);
        document.addEventListener('keydown', onKeyDown);
        document.addEventListener('keyup', onKeyUp);
        document.addEventListener('webOSRelaunch', loadApps);
        document.addEventListener('visibilitychange', function () {
            if (!document.hidden) loadApps();
        });
        loadApps();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
