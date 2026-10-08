import { wails } from './api.js';
import * as editor from './editor.js';
import * as ocr from './ocr.js';
import { showToast, updateDimAreas, loadConfigToUI, gatherConfig, switchTab, updateAccountUI, updatePublishUIVisibility, centerModalOnPrimaryScreen } from './ui.js';

let startupHideTimer = null; // НОВОЕ: Глобальный таймер авто-скрытия
let isDragging = false, startX = 0, startY = 0, isProcessing = false;
let selectionMode = 'idle'; 
let resizeHandle = null;
let dragOffsetX = 0, dragOffsetY = 0;
let isDraggingToolbar = false;
let tbOffsetX = 0, tbOffsetY = 0;

let isSettingsDirty = false;
let isLoadingConfig = false;
let currentPublishMode = 'default';
let currentHistoryData = { local: [], ipfs: [] };

document.addEventListener('DOMContentLoaded', async () => {
    isLoadingConfig = true;
    await loadConfigToUI();

document.body.style.opacity = '1'; // НОВОЕ: Показываем окно, когда настройки загружены


    // Показываем панель при запуске и настраиваем авто-скрытие
    document.getElementById('panel-ui').style.display = 'flex'; // НОВОЕ: Сначала показываем кнопки
    await wails.ShowPanel(); // НОВОЕ: Потом показываем само окно
    startupHideTimer = setTimeout(() => {
        wails.HideWindow();
        startupHideTimer = null;
    }, 10000); // 10 секунд

    // Отменяем авто-скрытие, если пользователь кликнул по панели
    document.getElementById('panel-ui').addEventListener('click', () => {
        if (startupHideTimer) {
            clearTimeout(startupHideTimer);
            startupHideTimer = null;
        }
    }, { once: true });



    isLoadingConfig = false;

    const settingsUI = document.getElementById('settings-ui');
    settingsUI.addEventListener('input', () => { if (!isLoadingConfig) isSettingsDirty = true; });
    settingsUI.addEventListener('change', () => { if (!isLoadingConfig) isSettingsDirty = true; });

    // Panel Buttons
    document.getElementById('btn-close-panel').addEventListener('click', () => wails.HideWindow());
    document.getElementById('btn-frag').addEventListener('click', startCapture);
    document.getElementById('btn-full').addEventListener('click', doFull);
    document.getElementById('btn-history').addEventListener('click', openHistoryWindow);
    document.getElementById('btn-settings').addEventListener('click', openSettings);
    
    document.getElementById('btn-close-settings').addEventListener('click', async () => {
        if (isSettingsDirty) {
            const save = confirm("Настройки были изменены. Сохранить изменения перед закрытием?");
            if (save) {
                await applySettings(document.getElementById('btn-apply-settings'));
            } else {
                isLoadingConfig = true;
                await loadConfigToUI();
                isLoadingConfig = false;
                isSettingsDirty = false;

              }
        }
        await closeSettings();
    });

    // History Window Close
    document.getElementById('btn-close-history')?.addEventListener('click', closeHistoryWindow);
    // НОВОЕ: Открыть папку со скриншотами
    document.getElementById('btn-open-folder')?.addEventListener('click', () => wails.OpenHistory());

    // Settings Buttons
    document.getElementById('btn-select-folder').addEventListener('click', selectFolder);
    document.getElementById('btn-check-account').addEventListener('click', checkAccount);
    document.getElementById('btn-logout').addEventListener('click', logoutAccount);
    // НОВОЕ: Заглушка для кнопки Web3 авторизации
    const btnCheckAccountServer = document.getElementById('btn-check-account-server');
    if (btnCheckAccountServer) {
        btnCheckAccountServer.addEventListener('click', () => {
            showToast("Web3 авторизация (PKOIN) будет добавлена после гранта.");
        });
    }

    document.getElementById('btn-buy-pro').addEventListener('click', () => wails.BuySubscription());
    document.getElementById('btn-apply-settings').addEventListener('click', () => applySettings(document.getElementById('btn-apply-settings')));
    document.getElementById('btn-reset').addEventListener('click', resetDefaults);

    // НОВОЕ: Проверка обновлений
    const btnCheckUpdates = document.getElementById('btn-check-updates');
    if (btnCheckUpdates) {
        btnCheckUpdates.addEventListener('click', async () => {
            const statusEl = document.getElementById('update-status');
            const btn = document.getElementById('btn-check-updates');
            
            statusEl.innerText = "Проверка обновлений...";
            statusEl.style.color = "var(--text-muted)";
            btn.disabled = true;

            try {
                const [currentVer, updateUrl, err] = await wails.CheckForUpdates();
                
                // Обновляем текст версии на странице
                document.getElementById('app-version').innerText = currentVer;

                if (err) {
                    statusEl.innerText = "❌ " + err;
                    statusEl.style.color = "#ef4444";
                } else if (updateUrl) {
                    statusEl.innerHTML = `✅ Доступно обновление! <br><a href="#" id="update-link" style="color: var(--primary); text-decoration: underline;">Скачать новую версию</a>`;
                    statusEl.style.color = "#10b981";
                    
                    document.getElementById('update-link').addEventListener('click', () => {
                        wails.BrowserOpenURL(updateUrl);
                    });
                } else {
                    statusEl.innerText = "У вас установлена последняя версия!";
                    statusEl.style.color = "#10b981";
                }
            } catch (e) {
                statusEl.innerText = "❌ Ошибка: " + e.message;
                statusEl.style.color = "#ef4444";
            } finally {
                btn.disabled = false;
            }
        });
    }



    // IPFS Gateway Test
    const btnTestGateway = document.getElementById('btn-test-gateway');
    if (btnTestGateway) {
        btnTestGateway.addEventListener('click', async () => {
            const gateway = document.getElementById('ipfsGatewaySelect').value;
            const resultEl = document.getElementById('gateway-test-result');
            if (!gateway) { resultEl.innerText = "❌ Выберите шлюз"; resultEl.style.color = "#ef4444"; return; }
            resultEl.innerText = "Пингую шлюз...";
            resultEl.style.color = "var(--text-muted)";
            btnTestGateway.disabled = true;
            try {
                const res = await wails.TestIPFSGateway(gateway);
                resultEl.innerText = res;
                resultEl.style.color = "#10b981";
            } catch (e) {
                resultEl.innerText = "❌ " + e.message;
                resultEl.style.color = "#ef4444";
            } finally {
                btnTestGateway.disabled = false;
            }
        });
    }

    // Pinata Test
    const btnTestIpfs = document.getElementById('btn-test-ipfs');
    if (btnTestIpfs) {
        btnTestIpfs.addEventListener('click', async () => {
            const jwt = document.getElementById('pinataJWTInput').value;
            if (!jwt) { showToast("Введите API ключ для проверки"); return; }
            showToast("Проверка ключа...");
            try {
                const res = await wails.TestIPFSConnection(jwt);
                showToast("✅ " + res);
            } catch (e) { showToast("❌ " + e.message); }
        });
    }

    // Hotkeys
    const hotkeyFragInput = document.getElementById('hotkeyFrag');
    if (hotkeyFragInput) {
        hotkeyFragInput.addEventListener('keydown', (e) => {
            e.preventDefault();
            if (e.key === 'Tab' || e.key === 'Escape') return;
            const mods = [];
            if (e.ctrlKey) mods.push('Ctrl');
            if (e.shiftKey) mods.push('Shift');
            if (e.altKey) mods.push('Alt');
            let key = e.key;
            if (key === ' ') key = 'Space';
            if (key.length === 1) key = key.toUpperCase();
            if (!['Control', 'Shift', 'Alt'].includes(key)) {
                hotkeyFragInput.value = [...mods, key].join('+');
                isSettingsDirty = true;
            }
        });
    }

    const hotkeyFullInput = document.getElementById('hotkeyFull');
    if (hotkeyFullInput) {
        hotkeyFullInput.addEventListener('keydown', (e) => {
            e.preventDefault();
            if (e.key === 'Tab' || e.key === 'Escape') return;
            const mods = [];
            if (e.ctrlKey) mods.push('Ctrl');
            if (e.shiftKey) mods.push('Shift');
            if (e.altKey) mods.push('Alt');
            let key = e.key;
            if (key === ' ') key = 'Space';
            if (key.length === 1) key = key.toUpperCase();
            if (!['Control', 'Shift', 'Alt'].includes(key)) {
                hotkeyFullInput.value = [...mods, key].join('+');
                isSettingsDirty = true;
            }
        });
    }

    // Proxy Modal
    const btnSetupProxy = document.getElementById('btn-setup-proxy');
    const proxyModal = document.getElementById('proxy-modal');
    const proxyTestResult = document.getElementById('proxy-test-result');

    if (btnSetupProxy) {
        btnSetupProxy.addEventListener('click', async () => {
            proxyTestResult.innerText = '';
            await centerModalOnPrimaryScreen(proxyModal);
            proxyModal.classList.add('active');
        });
    }

    document.getElementById('proxy-cancel').addEventListener('click', () => proxyModal.classList.remove('active'));
    document.getElementById('proxy-save').addEventListener('click', async () => {
        let cfg = gatherConfig();
        await wails.SaveConfig(cfg);
        proxyModal.classList.remove('active');
        showToast("Настройки прокси сохранены");
        isSettingsDirty = false;
    });

    document.getElementById('proxy-test-btn').addEventListener('click', async () => {
        const proxyType = document.getElementById('proxyTypeSelect') ? document.getElementById('proxyTypeSelect').value : 'http';
        const host = document.getElementById('proxyHostInput') ? document.getElementById('proxyHostInput').value : '';
        const port = document.getElementById('proxyPortInput') ? document.getElementById('proxyPortInput').value : '';
        const user = document.getElementById('proxyUserInput') ? document.getElementById('proxyUserInput').value : '';
        const pass = document.getElementById('proxyPassInput') ? document.getElementById('proxyPassInput').value : '';

        if (!host || !port) {
            proxyTestResult.innerText = "❌ Укажите хост и порт";
            proxyTestResult.style.color = "#ef4444";
            return;
        }

        proxyTestResult.innerText = "Пингую Pinata через прокси...";
        proxyTestResult.style.color = "#64748b";
        
        try {
            if (!wails || !wails.TestProxy) throw new Error("Модули Wails не сгенерированы.");
            const res = await wails.TestProxy(proxyType, host, port, user, pass);
            proxyTestResult.innerText = res;
            proxyTestResult.style.color = "#10b981";
        } catch (e) {
            proxyTestResult.innerText = "❌ " + e.message;
            proxyTestResult.style.color = "#ef4444";
        }
    });

    // НОВОЕ: Динамическая панель хранилища
    document.querySelectorAll('input[name="storage"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            // Прячем все панели
            document.querySelectorAll('.storage-panel').forEach(p => p.style.display = 'none');
            // Показываем нужную
            const panelId = 'panel-' + e.target.value;
            const panel = document.getElementById(panelId);
            if (panel) panel.style.display = 'block';
        });
    });


    // Tabs
    document.querySelectorAll('.settings-tabs .tab-btn').forEach(btn => btn.addEventListener('click', () => {
        switchTab(btn.dataset.tab);
    }));

    // History Filters
    document.querySelectorAll('#history-ui .tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            // Снимаем active со всех фильтров
            document.querySelectorAll('#history-ui .tab-btn').forEach(b => b.classList.remove('active'));
            // Ставим active на нажатый
            btn.classList.add('active');
            // Грузим нужную категорию
            loadHistory(btn.dataset.filter);
        });
    });


    // Editor Tools
    document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => btn.addEventListener('click', () => editor.setTool(btn.dataset.tool)));
    document.getElementById('undoBtn').addEventListener('click', () => editor.undo());
    document.getElementById('redoBtn').addEventListener('click', () => editor.redo());
    document.getElementById('btn-copy').addEventListener('click', () => editor.copyEditedImage());
    document.getElementById('btn-save').addEventListener('click', () => editor.saveEditedImage());
    document.getElementById('btn-cancel').addEventListener('click', () => editor.cancelCapture());
document.getElementById('btn-ocr').addEventListener('click', () => ocr.runOCR(editor.getFabricCanvas()));
document.getElementById('btn-translate').addEventListener('click', () => ocr.runTranslation(editor.getFabricCanvas(), editor.saveHistory));

    // НОВОЕ: Обработчик быстрых цветов (палитра)
    document.querySelectorAll('.color-swatch').forEach(swatch => {

        swatch.addEventListener('click', (e) => { // НОВОЕ: Добавили (e)
            e.preventDefault(); // НОВОЕ: Останавливаем стандартное поведение кнопки
            e.stopPropagation(); // НОВОЕ: Останавливаем всплытие события

            const color = swatch.dataset.color;
            const colorPicker = document.getElementById('colorPicker');
            if (colorPicker) {
                colorPicker.value = color;
                // Триггерим событие input, чтобы editor.js обновил цвет кисти
                const event = new Event('input', { bubbles: true });
                colorPicker.dispatchEvent(event);
            }
            
            // Визуальное выделение активного цвета
            document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
            swatch.classList.add('active');
        });
    });


    // Toolbar Drag
    document.getElementById('dragHandle').addEventListener('mousedown', (e) => {
        isDraggingToolbar = true;
        const toolbar = document.getElementById('toolbar');
        const rect = toolbar.getBoundingClientRect();
        toolbar.style.transform = 'none';
        toolbar.style.left = rect.left + 'px';
        toolbar.style.top = rect.top + 'px';
        toolbar.style.bottom = 'auto';
        tbOffsetX = e.clientX - rect.left;
        tbOffsetY = e.clientY - rect.top;
        e.preventDefault(); 
    });

    // Mouse Events
    document.addEventListener('mousedown', (e) => {
        if (isDraggingToolbar || e.target.closest('#toolbar')) return;
        
        if (e.target.classList.contains('sel-handle')) {
            selectionMode = 'resizing';
            resizeHandle = e.target.id;
            const container = document.querySelector('.canvas-container');
            if (container) container.style.opacity = '0.5';
            return;
        }
        
        if (e.target.classList.contains('sel-move-handle')) {
            selectionMode = 'dragging';
            const selBox = document.getElementById('selection-box');
            dragOffsetX = e.clientX - selBox.offsetLeft;
            dragOffsetY = e.clientY - selBox.offsetTop;
            const container = document.querySelector('.canvas-container');
            if (container) container.style.opacity = '0.5';
            return;
        }
        
        if (document.querySelector('.canvas-container')) return;

        selectionMode = 'drawing';
        isDragging = true; startX = e.clientX; startY = e.clientY;
        const selBox = document.getElementById('selection-box');
        selBox.classList.remove('adjusted');
        selBox.classList.add('drawing');
        selBox.style.left = startX + 'px'; 
        selBox.style.top = startY + 'px';
        selBox.style.width = '0px'; 
        selBox.style.height = '0px'; 
        selBox.style.display = 'block';
        document.querySelectorAll('.dim-area').forEach(el => el.style.display = 'block');
    });

    document.addEventListener('mousemove', (e) => {
        if (isDraggingToolbar) {
            let x = e.clientX - tbOffsetX;
            let y = e.clientY - tbOffsetY;
            const tbWidth = document.getElementById('toolbar').offsetWidth || 500;
            const tbHeight = document.getElementById('toolbar').offsetHeight || 50;
            x = Math.max(0, Math.min(x, window.innerWidth - tbWidth));
            y = Math.max(0, Math.min(y, window.innerHeight - tbHeight));
            document.getElementById('toolbar').style.left = x + 'px';
            document.getElementById('toolbar').style.top = y + 'px';
            return;
        }

        const selBox = document.getElementById('selection-box');
        
        if (selectionMode === 'drawing' && isDragging) {
            let curX = e.clientX, curY = e.clientY, w = curX - startX, h = curY - startY;
            if (w < 0) { selBox.style.left = curX + 'px'; selBox.style.width = -w + 'px'; } else { selBox.style.width = w + 'px'; }
            if (h < 0) { selBox.style.top = curY + 'px'; selBox.style.height = -h + 'px'; } else { selBox.style.height = h + 'px'; }
            const sizeInd = document.getElementById('size-indicator');
            if (sizeInd) sizeInd.innerText = `${Math.abs(Math.round(w))} x ${Math.abs(Math.round(h))}`;
            updateDimAreas(selBox);
        } 
        else if (selectionMode === 'dragging') {
            let newX = e.clientX - dragOffsetX;
            let newY = e.clientY - dragOffsetY;
            newX = Math.max(0, Math.min(newX, window.innerWidth - selBox.offsetWidth));
            newY = Math.max(0, Math.min(newY, window.innerHeight - selBox.offsetHeight));
            selBox.style.left = newX + 'px';
            selBox.style.top = newY + 'px';
            updateDimAreas(selBox);
        } 
        else if (selectionMode === 'resizing') {
            let rect = selBox.getBoundingClientRect();
            let newLeft = rect.left, newTop = rect.top, newW = rect.width, newH = rect.height;
            if (resizeHandle === 'handle-br') { newW = e.clientX - rect.left; newH = e.clientY - rect.top; }
            else if (resizeHandle === 'handle-bl') { newW = rect.right - e.clientX; newH = e.clientY - rect.top; newLeft = e.clientX; }
            else if (resizeHandle === 'handle-tr') { newW = e.clientX - rect.left; newH = rect.bottom - e.clientY; newTop = e.clientY; }
            else if (resizeHandle === 'handle-tl') { newW = rect.right - e.clientX; newH = rect.bottom - e.clientY; newLeft = e.clientX; newTop = e.clientY; }
            if (newW > 10 && newH > 10) { selBox.style.left = newLeft + 'px'; selBox.style.top = newTop + 'px'; selBox.style.width = newW + 'px'; selBox.style.height = newH + 'px'; updateDimAreas(selBox); }
        }
    });

    document.addEventListener('mouseup', (e) => {
        if (isDraggingToolbar) {
            isDraggingToolbar = false;
            const toolbar = document.getElementById('toolbar');
            localStorage.setItem('bastyshot_toolbar_pos', JSON.stringify({ x: toolbar.offsetLeft, y: toolbar.offsetTop }));
            return;
        }
        if (selectionMode === 'drawing' && isDragging) {
            isDragging = false;
            const selBox = document.getElementById('selection-box');
            selBox.classList.remove('drawing');
            let rect = selBox.getBoundingClientRect();
            if (rect.width < 10 || rect.height < 10) { 
                selBox.style.display = 'none'; 
                selBox.classList.remove('adjusted');
                document.querySelectorAll('.dim-area').forEach(el => el.style.display = 'none');
                selectionMode = 'idle';
                return; 
            }
            editor.initEditor(rect);
            selectionMode = 'editing';
            selBox.classList.add('adjusted');
        } 
        else if (selectionMode === 'dragging' || selectionMode === 'resizing') {
            selectionMode = 'editing';
            let selBox = document.getElementById('selection-box');
            let rect = selBox.getBoundingClientRect();
            editor.updateEditorPosition(rect.left, rect.top, rect.width, rect.height);
            const container = document.querySelector('.canvas-container');
            if (container) container.style.opacity = '1';
        }
    });

    // Publish Dropdown
    const btnPublish = document.getElementById('btn-publish');
    const btnPublishOptions = document.getElementById('btn-publish-options');
    const publishDropdown = document.getElementById('publish-dropdown');
    const publishModeIcon = document.getElementById('publish-mode-icon');

    btnPublishOptions.addEventListener('click', (e) => {
        e.stopPropagation();
        publishDropdown.classList.toggle('active');
    });

    document.querySelectorAll('.publish-option').forEach(opt => {
        opt.addEventListener('click', () => {
            currentPublishMode = opt.dataset.mode;
            const modeText = opt.dataset.text;
            const icon = opt.dataset.icon;
            if (publishModeIcon) publishModeIcon.innerText = icon;
            document.querySelectorAll('.publish-option').forEach(o => o.classList.remove('active'));
            opt.classList.add('active');
            if (currentPublishMode !== 'default') { btnPublishOptions.classList.add('active'); } else { btnPublishOptions.classList.remove('active'); }
            publishDropdown.classList.remove('active');
            showToast(`Настройка публикации: ${modeText}`);
        });
    });

    document.addEventListener('click', (e) => {
        if (!publishDropdown.contains(e.target) && e.target !== btnPublishOptions && !btnPublishOptions.contains(e.target)) {
            publishDropdown.classList.remove('active');
        }
    });

    btnPublish.addEventListener('click', () => {
        const activeOpt = document.querySelector('.publish-option.active');
        const modeText = activeOpt ? activeOpt.dataset.text : 'Без ограничений';
        if (currentPublishMode === 'default' || currentPublishMode === 'password' || currentPublishMode === 'directlink') {
            editor.publishImage();
        } else {
            showToast(`Загрузка с режимом: ${modeText} (Скоро будет доступно на сервере!)`);
        }
    });

    // Toast Buttons
    document.getElementById('toast-btn-open')?.addEventListener('click', () => {
        if (window.currentPublishLink) wails.BrowserOpenURL(window.currentPublishLink);
    });

    document.getElementById('toast-btn-copy')?.addEventListener('click', async () => {
        if (window.currentPublishLink) {
            await wails.ClipboardSetText(window.currentPublishLink);
            const btn = document.getElementById('toast-btn-copy');
            const originalText = btn.innerText;
            btn.innerText = "Скопировано!";
            btn.style.background = "#10b981";
            btn.style.color = "#ffffff";
            setTimeout(() => { btn.innerText = originalText; btn.style.background = ""; btn.style.color = ""; }, 1500);
        }
    });

    document.getElementById('toast-btn-close')?.addEventListener('click', async () => await editor.closePublishToast());

    document.getElementById('toast-btn-retry')?.addEventListener('click', () => {
        if (editor.lastPublishPayload) editor.executePublish(editor.lastPublishPayload);
    });

    document.getElementById('toast-btn-error-cancel')?.addEventListener('click', () => editor.closePublishToast());

    document.getElementById('toast-btn-cancel-loading')?.addEventListener('click', async () => {
        await wails.CancelIPFSUpload();
        await editor.closePublishToast();
        showToast("🚫 Загрузка отменена");
    });

    document.getElementById('toast-hide-success')?.addEventListener('change', async (e) => {
        let cfg = await wails.GetConfig();
        cfg.toastHideSuccess = e.target.checked;
        await wails.SaveConfig(cfg);
    });

    document.getElementById('toast-hide-error')?.addEventListener('change', async (e) => {
        let cfg = await wails.GetConfig();
        cfg.toastHideError = e.target.checked;
        await wails.SaveConfig(cfg);
    });
});

// Wails Events
wails.EventsOn('show_panel_ui', () => {
    window.isSettingsOpen = false;
    window.toastDesiredVisible = false;
    document.getElementById('publish-toast-ui').style.display = 'none';
    document.getElementById('panel-ui').style.display = 'flex';
    document.getElementById('settings-ui').style.display = 'none';
    document.getElementById('history-ui').style.display = 'none';
});

wails.EventsOn('show_settings_ui', async () => {
    window.isSettingsOpen = true;
    document.getElementById('publish-toast-ui').style.display = 'none';
    document.getElementById('panel-ui').style.display = 'none';
    document.getElementById('history-ui').style.display = 'none';
    document.getElementById('settings-ui').style.display = 'flex';
    if (wails.PauseHotkeys) await wails.PauseHotkeys();
    await wails.OpenSettings();
});


wails.EventsOn('show_history_ui', async () => {
    document.getElementById('publish-toast-ui').style.display = 'none';
    window.isSettingsOpen = false;
    window.toastDesiredVisible = false;
    document.getElementById('panel-ui').style.display = 'none';
    document.getElementById('settings-ui').style.display = 'none';
    document.getElementById('overlay-ui').style.display = 'none'; // НОВОЕ: Скрываем затемнение
    document.getElementById('history-ui').style.display = 'flex';
    if (wails.PauseHotkeys) await wails.PauseHotkeys();
    await wails.OpenHistoryWindow();
    loadHistory('all');
});

wails.EventsOn('start_capture', () => startCapture());
wails.EventsOn('start_full_capture', () => doFull());

wails.EventsOn('ipfs:status', (statusText) => {
    const loadingText = document.getElementById('toast-loading-text');
    if (loadingText) loadingText.innerText = statusText;
});

async function startCapture() {
    if (isProcessing) return;
    // НОВОЕ: Отменяем таймер авто-скрытия, если пользователь начал делать скриншот
    if (startupHideTimer) {
        clearTimeout(startupHideTimer);
        startupHideTimer = null;
    }
    isProcessing = true;

    // НОВОЕ: Скрываем старую рамку выделения от прошлого скриншота
    const selBox = document.getElementById('selection-box');
    selBox.style.display = 'none';
    selBox.classList.remove('adjusted');
    document.querySelectorAll('.dim-area').forEach(el => el.style.display = 'none');
    
    currentPublishMode = 'default';
    document.querySelectorAll('.publish-option').forEach(o => o.classList.remove('active'));
    const defOpt = document.querySelector('.publish-option[data-mode="default"]');
    if (defOpt) defOpt.classList.add('active');
    const pubIcon = document.getElementById('publish-mode-icon');
    if (pubIcon) pubIcon.innerText = '♾️';
    
    document.getElementById('publish-toast-ui').style.display = 'none';
    window.toastDesiredVisible = false;
    
    document.getElementById('panel-ui').style.display = 'none';
    document.getElementById('overlay-ui').style.display = 'block';
    
    // НОВОЕ: Показываем рамку фокуса и затемнение
    document.getElementById('capture-border').style.display = 'block';
    
    const img = document.getElementById('bg-screenshot');
    img.style.display = 'block';

    wails.CaptureScreen().then(base64Img => {
        img.onload = () => {
            window.focus(); 
            document.body.focus();
            isProcessing = false;
            selectionMode = 'idle';
            document.getElementById('status-text').style.display = 'block';
            document.getElementById('status-text').innerText = 'Выделите область мышкой';
        };
        img.src = base64Img;
    }).catch(err => { alert(err); isProcessing = false; });
}

async function doFull() {
    if (isProcessing) return;
    // НОВОЕ: Отменяем таймер авто-скрытия
    if (startupHideTimer) {
        clearTimeout(startupHideTimer);
        startupHideTimer = null;
    }
    isProcessing = true;

    // НОВОЕ: Скрываем старую рамку выделения от прошлого скриншота
    const selBox = document.getElementById('selection-box');
    selBox.style.display = 'none';
    selBox.classList.remove('adjusted');
    document.querySelectorAll('.dim-area').forEach(el => el.style.display = 'none');
    
    currentPublishMode = 'default';
    document.querySelectorAll('.publish-option').forEach(o => o.classList.remove('active'));
    const defOpt = document.querySelector('.publish-option[data-mode="default"]');
    if (defOpt) defOpt.classList.add('active');
    const pubIcon = document.getElementById('publish-mode-icon');
    if (pubIcon) pubIcon.innerText = '♾️';
    
    document.getElementById('publish-toast-ui').style.display = 'none';
    window.toastDesiredVisible = false;
    
    document.getElementById('panel-ui').style.display = 'none';
    document.getElementById('overlay-ui').style.display = 'block';
    document.getElementById('bg-screenshot').style.display = 'block';

    // НОВОЕ: Показываем рамку фокуса и затемнение (хотя при полном экране редактор откроется сразу, оставим для-consistency)
    document.getElementById('capture-border').style.display = 'block';

    try {
        let base64Img = await wails.CaptureScreen();
        let img = document.getElementById('bg-screenshot');
        
        await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = reject;
            img.src = base64Img;
        });

        let waitCount = 0;
        while (window.innerWidth < 500 && waitCount < 20) {
            await new Promise(r => setTimeout(r, 50));
            waitCount++;
        }

        window.focus(); 
        document.body.focus();
        isProcessing = false;
        
        let fullRect = { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
        editor.initEditor(fullRect);
    } catch (err) { 
        alert("Ошибка захвата: " + err); 
        isProcessing = false; 
        editor.cancelCapture(); 
    }
}

async function openSettings() {
    if (wails.PauseHotkeys) await wails.PauseHotkeys();
    window.isSettingsOpen = true;
    document.getElementById('publish-toast-ui').style.display = 'none';
    document.getElementById('panel-ui').style.display = 'none';
    document.getElementById('settings-ui').style.display = 'flex';
    await wails.OpenSettings();
}

async function closeSettings() {
    document.getElementById('settings-ui').style.display = 'none';
    await wails.CloseSettings();
    window.isSettingsOpen = false;
    if (window.toastDesiredVisible) {
        document.getElementById('publish-toast-ui').style.display = 'flex';
        await wails.ShowPublishToast();
    } else {
        document.getElementById('panel-ui').style.display = 'flex';
    }
    if (wails.RegisterHotkeys) await wails.RegisterHotkeys();
}

async function selectFolder() {
    try {
        let newPath = await wails.SelectFolder();
        if (newPath) { 
            document.getElementById('savePathInput').value = newPath; 
            isSettingsDirty = true;
        }
    } catch (e) {
        console.error("Выбор папки отменен или произошла ошибка:", e);
        showToast("❌ Не удалось выбрать папку: " + e.message);
    }
}

async function applySettings(btn) {
    if (!btn) return;
    try {
        let oldCfg = await wails.GetConfig();
        let cfg = gatherConfig();
        cfg.savePath = document.getElementById('savePathInput').value;
        cfg.username = document.getElementById('usernameInput').value;
        
        let originalText = btn.innerText;
        btn.innerText = "Сохранение..."; 
        btn.disabled = true;
        
        await wails.SaveConfig(cfg);
        isSettingsDirty = false;
        
        // НОВОЕ: Проверяем, изменилась ли галочка автозапуска
        if (oldCfg.autoStart !== cfg.autoStart) {
            await wails.ToggleAutostart(cfg.autoStart);
            if (cfg.autoStart) {
                showToast("Автозапуск включен");
            } else {
                showToast("Автозапуск выключен");
            }
        }
        
        if (oldCfg.ocrModel !== cfg.ocrModel) {
            await wails.DeleteTessData();
            showToast("Модель OCR изменена. Словари обновятся при следующем скане.");
        }
        
        const btnOcr = document.getElementById('btn-ocr');
        if (btnOcr) btnOcr.style.display = cfg.ocrEnabled ? 'flex' : 'none';
        
        if (cfg.username) {
            let acc = await wails.GetUserAccount();
            updateAccountUI(acc);
        }
        
        updatePublishUIVisibility(cfg.storageType || 'local');
        
        btn.innerText = "Сохранено!"; 
        btn.style.background = "#10b981"; 
        setTimeout(() => { 
            btn.innerText = originalText; 
            btn.style.background = ""; 
            btn.disabled = false;
        }, 1500);
    } catch(e) { 
        console.error("Ошибка сохранения:", e); 
        showToast("❌ Ошибка сохранения: " + e.message);
        btn.innerText = "Сохранить";
        btn.style.background = "#ef4444";
        btn.disabled = false;
        setTimeout(() => { btn.style.background = ""; }, 1500);
    }
}

function resetDefaults() {
    if (confirm("Сбросить все настройки к значениям по умолчанию?")) {
        document.querySelector('input[name="storage"][value="local"]').checked = true;
        document.querySelector('input[name="quality"][value="med"]').checked = true;
        document.querySelector('input[name="autostart"]').checked = false;
        document.querySelector('input[name="proxy"]').checked = false;
        document.querySelector('input[name="localcopy"]').checked = true;
        document.querySelector('input[name="showupload"]').checked = true;
        document.querySelector('input[name="showinfo"]').checked = true;
        document.getElementById('hotkeyFrag').value = "Ctrl + Shift + S";
        document.getElementById('hotkeyFull').value = "Ctrl + Shift + F";
        isSettingsDirty = true;
    }
}

async function checkAccount() {
    let address = document.getElementById('usernameInput').value;
    if (!address || address.length < 20 || address.charAt(0) !== 'P') {
        alert("Введите корректный Bastyon Address (должен начинаться с буквы P)");
        return;
    }
    let cfg = gatherConfig();
    cfg.savePath = document.getElementById('savePathInput').value;
    cfg.username = address;
    await wails.SaveConfig(cfg);
    let acc = await wails.GetUserAccount();
    updateAccountUI(acc);
    isSettingsDirty = false;
}

async function logoutAccount() {
    let cfg = gatherConfig();
    cfg.username = "";
    await wails.SaveConfig(cfg);
    updateAccountUI({ address: "" });
    isSettingsDirty = false;
}

// ==========================================
// ОКНО ИСТОРИИ И ГАЛЕРЕЯ
// ==========================================

async function openHistoryWindow() {
    document.getElementById('publish-toast-ui').style.display = 'none';
    window.toastDesiredVisible = false;
    document.getElementById('panel-ui').style.display = 'none';
    document.getElementById('overlay-ui').style.display = 'none'; // НОВОЕ: Скрываем затемнение
    document.getElementById('history-ui').style.display = 'flex';
    if (wails.PauseHotkeys) await wails.PauseHotkeys();
    await wails.OpenHistoryWindow();
    loadHistory('all');
}

async function closeHistoryWindow() {
    document.getElementById('history-ui').style.display = 'none';
    document.getElementById('panel-ui').style.display = 'flex';
    await wails.CloseHistoryWindow();
    if (wails.RegisterHotkeys) await wails.RegisterHotkeys();
}

async function loadHistory(filter = 'all') {
    const grid = document.getElementById('gallery-grid');
    if (!grid) {
        console.error("Ошибка: #gallery-grid не найден в HTML!");
        return;
    }
    
    if (!wails.GetLocalScreenshots || !wails.GetIPFSHistory) {
        grid.innerHTML = '<div style="color: #ef4444; text-align: center; padding: 20px;">Модули Wails не сгенерированы</div>';
        return;
    }

    grid.innerHTML = '<div style="text-align: center; padding: 40px; color: var(--text-muted);">Загрузка...</div>';

    try {
        const [localFiles, ipfsHistory] = await Promise.all([
            wails.GetLocalScreenshots(),
            wails.GetIPFSHistory()
        ]);
        currentHistoryData.local = localFiles || [];
        currentHistoryData.ipfs = ipfsHistory || [];

        let html = '';

        // Локальные скриншоты
        if (filter === 'all' || filter === 'local') {
            currentHistoryData.local.forEach(item => {
                html += `
                    <div class="gallery-card">
                        <div class="gallery-badge local">💻 Local</div>
                        <img src="screenshots/${encodeURIComponent(item.name.replace('.png', '_thumb.jpg'))}" alt="${item.name}" loading="lazy" onerror="this.onerror=null; this.src='screenshots/${encodeURIComponent(item.name)}'">
                        <div class="gallery-info">
                            <div class="gallery-info-title">${item.name}</div>
                            <div class="gallery-info-date">${item.date}</div>
                            <div class="gallery-card-actions">
                                <button class="btn btn-secondary" onclick="openLocalFile('${item.name}')">Открыть</button>
                                <button class="btn btn-secondary" onclick="deleteLocal('${item.name}')">Удалить</button>
                            </div>
                        </div>
                    </div>
                `;
            });
        }

        // IPFS скриншоты
        if (filter === 'all' || filter === 'ipfs') {
            currentHistoryData.ipfs.forEach(item => {
                let thumb = `<div class="placeholder">🔒</div>`;
                if (item.thumbnail) {
                    thumb = `<img src="${item.thumbnail}" alt="IPFS" loading="lazy">`;
                } else if (item.link && !item.link.includes('#')) {
                    thumb = `<img src="${item.link}" alt="IPFS" loading="lazy" onerror="this.style.display='none'; this.parentElement.innerHTML='<div class=\\'placeholder\\'>🌐</div>'">`;
                }
                
                let shortLink = item.link ? item.link.substring(0, 30) + '...' : 'IPFS Ссылка';
                
                // НОВОЕ: Определяем режим для отображения
                let modeText = "🔒 Зашифровано";
                if (item.mode === "direct") modeText = "🌐 Прямая ссылка";
                if (item.mode === "password") modeText = "🔑 С паролем";
                
                html += `
                    <div class="gallery-card" id="ipfs-card-${item.id}">
                        <div class="gallery-badge ipfs" id="badge-${item.id}">🛡️ IPFS</div>
                        ${thumb}
                        <div class="gallery-info">
                            <div class="gallery-info-title">${shortLink}</div>
                            <div class="gallery-info-date">${item.date} <br> <span style="font-weight: bold; color: var(--text-main);">${modeText}</span></div>
                            <div class="gallery-card-actions">
                                <button class="btn" onclick="copyIPFSLink('${item.id}')">Копировать</button>
                                <button class="btn btn-secondary" onclick="checkIPFS('${item.id}')">Проверить</button>
                                <button class="btn btn-danger" onclick="deleteIPFS('${item.id}')">Удалить</button>
                            </div>
                        </div>
                    </div>
                `;
            });
        }

        if (html === '') {
            grid.innerHTML = '<div style="text-align: center; padding: 40px; color: var(--text-muted); grid-column: 1/-1;">История пуста</div>';
        } else {
            grid.innerHTML = html;
        }
    } catch (e) {
        grid.innerHTML = `<div style="color: #ef4444; text-align: center; padding: 20px;">Ошибка загрузки: ${e.message}</div>`;
    }
}

// Вспомогательные функции для кнопок в галерее
window.openLocalFile = (filename) => {
    wails.OpenLocalScreenshot(filename);
};

window.copyIPFSLink = async (id) => {
    const item = currentHistoryData.ipfs.find(h => h.id === id);
    if (item && item.link) {
        await wails.ClipboardSetText(item.link);
        showToast("✅ Ссылка скопирована!");
    }
};

window.deleteIPFS = async (id) => {
    if (confirm("Удалить запись из истории и снять с IPFS?")) {
        await wails.DeleteIPFSHistory(id);
        const activeFilter = document.querySelector('#history-ui .tab-btn.active');
        loadHistory(activeFilter ? activeFilter.dataset.filter : 'all');
        showToast("Запись удалена");
    }
};

window.deleteLocal = async (filename) => {
    if (confirm("Удалить локальный файл скриншота?")) {
        await wails.DeleteLocalScreenshot(filename);
        const activeFilter = document.querySelector('#history-ui .tab-btn.active');
        loadHistory(activeFilter ? activeFilter.dataset.filter : 'all');
        showToast("Файл удален");
    }
};

window.checkIPFS = async (id) => {
    const item = currentHistoryData.ipfs.find(h => h.id === id);
    if (!item || !item.link) return;
    
    const badge = document.getElementById(`badge-${id}`);
    if (badge) {
        badge.innerText = "⏳ Чек...";
        badge.className = "gallery-badge ipfs";
    }

    try {
        const isAvailable = await wails.CheckIPFSLink(item.link);
        if (badge) {
            if (isAvailable) {
                badge.innerText = "✅ Доступен";
                badge.className = "gallery-badge ipfs";
            } else {
                badge.innerText = "❌ Удален";
                badge.className = "gallery-badge offline";
            }
        }
    } catch (e) {
        if (badge) {
            badge.innerText = "❌ Ошибка";
            badge.className = "gallery-badge offline";
        }
    }
};


// НОВОЕ: Слушаем какой движок перевода сейчас работает
let currentTranslateEngine = "Google";
wails.EventsOn('translate:engine', (engine) => {
    currentTranslateEngine = engine;
});