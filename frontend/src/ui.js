import { wails } from './api.js';

export function showToast(message) {
    const toast = document.getElementById("toast");
    if (!toast) return;
    toast.innerText = message;
    toast.style.display = "block";
    void toast.offsetWidth; 
    toast.style.opacity = "1";
    setTimeout(() => {
        toast.style.opacity = "0";
        setTimeout(() => { toast.style.display = "none"; }, 300);
    }, 2000);
}

export function switchTab(tabName) {
    document.querySelectorAll('.tab-content').forEach(el => el.style.display = 'none');
    document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
    const tab = document.getElementById('tab-' + tabName);
    if (tab) tab.style.display = 'block';
    const btn = document.querySelector(`.tab-btn[data-tab="${tabName}"]`);
    if (btn) btn.classList.add('active');
}

export function updateDimAreas(selBox) {
    const rect = selBox.getBoundingClientRect();
    const leftPos = rect.left;
    const topPos = rect.top;
    const widthPos = rect.width;
    const heightPos = rect.height;

    const dimTop = document.getElementById('dim-top');
    const dimBottom = document.getElementById('dim-bottom');
    const dimLeft = document.getElementById('dim-left');
    const dimRight = document.getElementById('dim-right');

    if (dimTop) {
        dimTop.style.height = topPos + 'px';
        dimTop.style.width = '100%';
        dimTop.style.top = '0';
        dimTop.style.left = '0';
    }
    if (dimBottom) {
        dimBottom.style.top = (topPos + heightPos) + 'px';
        dimBottom.style.height = (window.innerHeight - (topPos + heightPos)) + 'px';
        dimBottom.style.width = '100%';
        dimBottom.style.left = '0';
    }
    if (dimLeft) {
        dimLeft.style.top = topPos + 'px';
        dimLeft.style.height = heightPos + 'px';
        dimLeft.style.width = leftPos + 'px';
        dimLeft.style.left = '0';
    }
    if (dimRight) {
        dimRight.style.top = topPos + 'px';
        dimRight.style.height = heightPos + 'px';
        dimRight.style.left = (leftPos + widthPos) + 'px';
        dimRight.style.width = (window.innerWidth - (leftPos + widthPos)) + 'px';
    }
}

export async function loadConfigToUI() {
    try {
        let cfg = await wails.GetConfig();
        if (!cfg) return;
        
        // Загружаем список мониторов
        const monitors = await wails.GetMonitors();
        const monitorSelect = document.getElementById('monitorSelect');
        if (monitorSelect) {
            monitorSelect.innerHTML = '';
            monitors.forEach((m, i) => {
                let val = i === 0 ? -1 : i - 1;
                monitorSelect.innerHTML += `<option value="${val}">${m}</option>`;
            });
            monitorSelect.value = cfg.monitorIndex !== undefined ? cfg.monitorIndex : -1;
        }
        
        const savePathEl = document.getElementById('savePathInput');
        if (savePathEl && cfg.savePath) savePathEl.value = cfg.savePath;
        
        const hotkeyEl = document.getElementById('hotkeyFrag');
        if (hotkeyEl && cfg.hotkey) hotkeyEl.value = cfg.hotkey;
        
        const hotkeyFullEl = document.getElementById('hotkeyFull');
        if (hotkeyFullEl && cfg.hotkeyFull) hotkeyFullEl.value = cfg.hotkeyFull;
        
        const usernameEl = document.getElementById('usernameInput');
        if (usernameEl && cfg.username) usernameEl.value = cfg.username;
        
        if (cfg.storageType) {
            const el = document.querySelector(`input[name="storage"][value="${cfg.storageType}"]`);
            if (el) el.checked = true;
            
            // НОВОЕ: Принудительно показываем нужную панель справа
            document.querySelectorAll('.storage-panel').forEach(p => p.style.display = 'none');
            const panel = document.getElementById('panel-' + cfg.storageType);
            if (panel) panel.style.display = 'block';
        }
        updatePublishUIVisibility(cfg.storageType || 'local');

        if (cfg.quality) {
            const el = document.querySelector(`input[name="quality"][value="${cfg.quality}"]`);
            if (el) el.checked = true;
        }
        
        const autoStartEl = document.querySelector('input[name="autostart"]');
        if (autoStartEl) autoStartEl.checked = cfg.autoStart || false;
        
        const useProxyEl = document.querySelector('input[name="proxy"]');
        if (useProxyEl) useProxyEl.checked = cfg.useProxy || false;
        
        const localCopyEl = document.querySelector('input[name="localcopy"]');
        if (localCopyEl) localCopyEl.checked = cfg.localCopy || false;
        
        const showUploadEl = document.querySelector('input[name="showupload"]');
        if (showUploadEl) showUploadEl.checked = cfg.showUpload || false;
        
        const showInfoEl = document.querySelector('input[name="showinfo"]');
        if (showInfoEl) showInfoEl.checked = cfg.showInfo || false;
        
        const saveKeyEl = document.querySelector('input[name="saveKeyInHistory"]');
        if (saveKeyEl) saveKeyEl.checked = cfg.saveKeyInHistory !== false; 

        // НОВОЕ: Загрузка настройки очистки логов
        const logCleanupEl = document.getElementById('logCleanupSelect');
        if (logCleanupEl) logCleanupEl.value = cfg.logCleanupHours || 0;
        
        const pinataJwtEl = document.getElementById('pinataJWTInput');
        if (pinataJwtEl) pinataJwtEl.value = cfg.pinataJWT || '';
        
        const ipfsGatewayEl = document.getElementById('ipfsGatewaySelect');
        if (ipfsGatewayEl && cfg.ipfsGateway) ipfsGatewayEl.value = cfg.ipfsGateway;

        const proxyTypeEl = document.getElementById('proxyTypeSelect');
        if (proxyTypeEl) proxyTypeEl.value = cfg.proxyType || 'http';
        
        const proxyHostEl = document.getElementById('proxyHostInput');
        if (proxyHostEl) proxyHostEl.value = cfg.proxyHost || '';
        
        const proxyPortEl = document.getElementById('proxyPortInput');
        if (proxyPortEl) proxyPortEl.value = cfg.proxyPort || '';
        
        const proxyUserEl = document.getElementById('proxyUserInput');
        if (proxyUserEl) proxyUserEl.value = cfg.proxyUser || '';
        
        const proxyPassEl = document.getElementById('proxyPassInput');
        if (proxyPassEl) proxyPassEl.value = cfg.proxyPass || '';

        const ocrEnabledEl = document.querySelector('input[name="ocrEnabled"]');
        if (ocrEnabledEl) ocrEnabledEl.checked = cfg.ocrEnabled !== false; 
        
        const ocrModelEl = document.getElementById('ocrModelSelect');
        if (ocrModelEl) ocrModelEl.value = cfg.ocrModel || 'fast';

        const btnOcr = document.getElementById('btn-ocr');
        if (btnOcr) {
            btnOcr.style.display = (cfg.ocrEnabled !== false) ? 'flex' : 'none';
        }

        if (cfg.username) {
            let acc = await wails.GetUserAccount();
            updateAccountUI(acc);
        }
    } catch (e) {
        console.error("LoadConfig error:", e);
    }
}

export function updateAccountUI(acc) {
    const loginArea = document.getElementById('loginArea');
    const accountInfo = document.getElementById('accountInfo');
    if (!acc || acc.address === "") {
        if (loginArea) loginArea.style.display = 'block'; 
        if (accountInfo) accountInfo.style.display = 'none';
        const usernameEl = document.getElementById('usernameInput');
        if (usernameEl) usernameEl.value = '';
        return;
    }
    if (loginArea) loginArea.style.display = 'none'; 
    if (accountInfo) accountInfo.style.display = 'block';
    
    const accAddrEl = document.getElementById('accountAddress');
    if (accAddrEl) {
        let shortAddr = acc.address.substring(0, 7) + "..." + acc.address.substring(acc.address.length - 6);
        accAddrEl.innerText = shortAddr;
    }
    
    const avatarEl = document.getElementById('avatarLetter');
    if (avatarEl) avatarEl.innerText = acc.address.charAt(1);
    
    const usedEl = document.getElementById('storageUsedText');
    const limitEl = document.getElementById('storageLimitText');
    const barEl = document.getElementById('storageBar');
    
    let usedMB = (acc.storageUsed / 1048576).toFixed(0);
    let limitMB = (acc.storageLimit / 1048576).toFixed(0);
    let percent = (acc.storageUsed / acc.storageLimit * 100).toFixed(1);
    
    if (usedEl) usedEl.innerText = `Занято: ${usedMB} МБ`;
    if (limitEl) limitEl.innerText = `Из ${limitMB} МБ`;
    if (barEl) barEl.style.width = percent + '%';
    
    let proBtn = document.getElementById('btn-buy-pro');
    let planEl = document.getElementById('accountPlan');
    
    if (acc.isPro) {
        if (planEl) planEl.innerText = "Тариф: Pro (Активен)";
        if (proBtn) {
            proBtn.innerText = "Действует до: " + acc.expiryDate;
            proBtn.style.background = "#10b981"; 
            proBtn.disabled = true;
        }
    } else {
        if (planEl) {
            if (acc.expiryDate && acc.expiryDate.includes("Истекла")) {
                planEl.innerText = "Тариф: Free (Pro истек)";
            } else {
                planEl.innerText = "Тариф: Free";
            }
        }
        if (proBtn) {
            if (acc.expiryDate && acc.expiryDate.includes("Истекла")) {
                proBtn.innerText = "Продлить подписку Pro";
            } else {
                proBtn.innerText = "Купить подписку Pro (1 ГБ)";
            }
            proBtn.style.background = "#f59e0b"; 
            proBtn.disabled = false;
        }
    }
}

export function gatherConfig() {
    let currentConfig = {};
    
    const hotkeyEl = document.getElementById('hotkeyFrag');
    if (hotkeyEl) currentConfig.hotkey = hotkeyEl.value;

    const hotkeyFullEl = document.getElementById('hotkeyFull');
    if (hotkeyFullEl) currentConfig.hotkeyFull = hotkeyFullEl.value;
    
    const monitorEl = document.getElementById('monitorSelect');
    if (monitorEl) currentConfig.monitorIndex = parseInt(monitorEl.value);
    
    let storageEl = document.querySelector('input[name="storage"]:checked');
    if (storageEl) currentConfig.storageType = storageEl.value;
    
    let qualityEl = document.querySelector('input[name="quality"]:checked');
    if (qualityEl) currentConfig.quality = qualityEl.value;
    
    const autoStartEl = document.querySelector('input[name="autostart"]');
    if (autoStartEl) currentConfig.autoStart = autoStartEl.checked;
    
    const useProxyEl = document.querySelector('input[name="proxy"]');
    if (useProxyEl) currentConfig.useProxy = useProxyEl.checked;
    
    const localCopyEl = document.querySelector('input[name="localcopy"]');
    if (localCopyEl) currentConfig.localCopy = localCopyEl.checked;
    
    const showUploadEl = document.querySelector('input[name="showupload"]');
    if (showUploadEl) currentConfig.showUpload = showUploadEl.checked;
    
    const showInfoEl = document.querySelector('input[name="showinfo"]');
    if (showInfoEl) currentConfig.showInfo = showInfoEl.checked;

    // НОВОЕ: Сохранение настройки ключа
    const saveKeyEl = document.querySelector('input[name="saveKeyInHistory"]');
    if (saveKeyEl) currentConfig.saveKeyInHistory = saveKeyEl.checked;

    // НОВОЕ: Сохранение настройки очистки логов
    const logCleanupEl = document.getElementById('logCleanupSelect');
    if (logCleanupEl) currentConfig.logCleanupHours = parseInt(logCleanupEl.value);
    
    const pinataJwtEl = document.getElementById('pinataJWTInput');
    if (pinataJwtEl) currentConfig.pinataJWT = pinataJwtEl.value;
    
    const ipfsGatewayEl = document.getElementById('ipfsGatewaySelect');
    if (ipfsGatewayEl) currentConfig.ipfsGateway = ipfsGatewayEl.value;

    const proxyTypeEl = document.getElementById('proxyTypeSelect');
    if (proxyTypeEl) currentConfig.proxyType = proxyTypeEl.value;
    
    const proxyHostEl = document.getElementById('proxyHostInput');
    if (proxyHostEl) currentConfig.proxyHost = proxyHostEl.value;
    
    const proxyPortEl = document.getElementById('proxyPortInput');
    if (proxyPortEl) currentConfig.proxyPort = proxyPortEl.value;
    
    const proxyUserEl = document.getElementById('proxyUserInput');
    if (proxyUserEl) currentConfig.proxyUser = proxyUserEl.value;
    
    const proxyPassEl = document.getElementById('proxyPassInput');
    if (proxyPassEl) currentConfig.proxyPass = proxyPassEl.value;

    const ocrEnabledEl = document.querySelector('input[name="ocrEnabled"]');
    if (ocrEnabledEl) currentConfig.ocrEnabled = ocrEnabledEl.checked;
    
    const ocrModelEl = document.getElementById('ocrModelSelect');
    if (ocrModelEl) currentConfig.ocrModel = ocrModelEl.value;

    return currentConfig;
}

export function updatePublishUIVisibility(storageType) {
    const publishGroup = document.querySelector('.publish-group');
    const btnPublishOptions = document.getElementById('btn-publish-options');
    const btnPublish = document.getElementById('btn-publish');
    
    if (!publishGroup) return;

    // Все опции в меню
    const optDefault = document.querySelector('.publish-option[data-mode="default"]');
    const optPassword = document.querySelector('.publish-option[data-mode="password"]');
    const opt1View = document.querySelector('.publish-option[data-mode="1view"]');
    const opt1Hour = document.querySelector('.publish-option[data-mode="1hour"]');
    const opt24Hours = document.querySelector('.publish-option[data-mode="24hours"]');
    const opt7Days = document.querySelector('.publish-option[data-mode="7days"]');
    const optDirect = document.querySelector('.publish-option[data-mode="directlink"]'); // НОВОЕ

    if (storageType === 'ipfs') {
        // Для IPFS: показываем кнопку публикации и стрелочку
        publishGroup.style.display = 'flex';
        if (btnPublishOptions) btnPublishOptions.style.display = 'flex';
        if (btnPublish) btnPublish.title = "Опубликовать в IPFS (Зашифровано)";
        
        // Показываем "Без ограничений", "Запросить пароль" и "Прямую ссылку"
        if (optDefault) optDefault.style.display = 'flex';
        if (optPassword) optPassword.style.display = 'flex';
        if (optDirect) optDirect.style.display = 'flex'; // НОВОЕ
        
        // Прячем все остальные (время жизни), так как в IPFS они не работают
        if (opt1View) opt1View.style.display = 'none';
        if (opt1Hour) opt1Hour.style.display = 'none';
        if (opt24Hours) opt24Hours.style.display = 'none';
        if (opt7Days) opt7Days.style.display = 'none';

        // Если сейчас выбрана скрытая опция (например, юзер переключил хранилище с сервера на IPFS), 
        // переключаемся на "Без ограничений"
        const activeOpt = document.querySelector('.publish-option.active');
        if (activeOpt && activeOpt.style.display === 'none') {
            document.querySelectorAll('.publish-option').forEach(o => o.classList.remove('active'));
            if (optDefault) optDefault.classList.add('active');
            const publishModeIcon = document.getElementById('publish-mode-icon');
            if (publishModeIcon) publishModeIcon.innerText = optDefault.dataset.icon;
        }

    } else if (storageType === 'server') {
        // Для Сервера: показываем кнопку и стрелочку
        publishGroup.style.display = 'flex';
        if (btnPublishOptions) btnPublishOptions.style.display = 'flex';
        if (btnPublish) btnPublish.title = "Опубликовать на сервер";
        
        // Показываем все пункты меню, кроме прямой ссылки и пароля (пароль пока только для IPFS)
        if (optDefault) optDefault.style.display = 'flex';
        if (optPassword) optPassword.style.display = 'none'; 
        if (optDirect) optDirect.style.display = 'none'; // НОВОЕ: Прячем прямую ссылку для сервера
        if (opt1View) opt1View.style.display = 'flex';
        if (opt1Hour) opt1Hour.style.display = 'flex';
        if (opt24Hours) opt24Hours.style.display = 'flex';
        if (opt7Days) opt7Days.style.display = 'flex';

        // Сбрасываем активную опцию, если она была скрыта
        const activeOpt = document.querySelector('.publish-option.active');
        if (activeOpt && activeOpt.style.display === 'none') {
            document.querySelectorAll('.publish-option').forEach(o => o.classList.remove('active'));
            if (optDefault) optDefault.classList.add('active');
            const publishModeIcon = document.getElementById('publish-mode-icon');
            if (publishModeIcon) publishModeIcon.innerText = optDefault.dataset.icon;
        }

    } else {
        // Для Локально, Bastyon, FTP: прячем всё
        publishGroup.style.display = 'none';
    }
}

export async function centerModalOnPrimaryScreen(modalEl) {
    let centerX = window.innerWidth / 2;
    let centerY = window.innerHeight / 2;
    
    const canvasContainer = document.querySelector('.canvas-container');
    if (canvasContainer) {
        const rect = canvasContainer.getBoundingClientRect();
        centerX = rect.left + (rect.width / 2);
        centerY = rect.top + (rect.height / 2);
    }
    
    const content = modalEl.querySelector('.modal-content');
    if (content) {
        content.style.left = centerX + 'px';
        content.style.top = centerY + 'px';
    }
}

export async function centerModalAboveToolbar(modalEl) {
    const toolbar = document.getElementById('toolbar');
    if (!toolbar) {
        return centerModalOnPrimaryScreen(modalEl);
    }
    
    const tbRect = toolbar.getBoundingClientRect();
    let left = tbRect.left + (tbRect.width / 2);
    let top = tbRect.top - 120;
    
    if (top < 120) {
        top = tbRect.bottom + 120;
    }
    
    const content = modalEl.querySelector('.modal-content');
    if (content) {
        content.style.left = left + 'px';
        content.style.top = top + 'px';
    }
}