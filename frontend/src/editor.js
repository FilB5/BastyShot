import { wails } from './api.js';
import { showToast, centerModalOnPrimaryScreen, centerModalAboveToolbar } from './ui.js';
import Tesseract from 'tesseract.js';
import { runOCR, runTranslation } from './ocr.js';

let fabricCanvas = null;
let activeShape = null;
let editorBgCanvas = null; 
let currentSize = 3;
let currentTool = 'select';
let history = [];
let historyIndex = -1;
let currentRect = { left: 0, top: 0, width: 0, height: 0 };
let isSaved = false;

async function logMsg(msg) {
    try {
        if (wails && wails.LogToFile) await wails.LogToFile(String(msg));
    } catch(e) { console.error("Log error:", e); }
}

function hexToRgba(hex, alpha) {
    let r = 0, g = 0, b = 0;
    if (hex.length == 7) {
        r = parseInt(hex.slice(1, 3), 16);
        g = parseInt(hex.slice(3, 5), 16);
        b = parseInt(hex.slice(5, 7), 16);
    }
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function saveHistory() {
    if (!fabricCanvas) return;
    history = history.slice(0, historyIndex + 1);
    history.push(JSON.stringify(fabricCanvas.toJSON()));
    historyIndex++;
    if (history.length > 50) {
        history.shift();
        historyIndex--;
    }
    updateHistoryButtons();
}


export function getFabricCanvas() {
    return fabricCanvas;
}


export function undo() {
    if (historyIndex > 0) {
        historyIndex--;
        fabricCanvas.loadFromJSON(history[historyIndex], () => {
            fabricCanvas.renderAll();
            updateHistoryButtons();
            updateObjectSelectable(); 
        });
    }
}

export function redo() {
    if (historyIndex < history.length - 1) {
        historyIndex++;
        fabricCanvas.loadFromJSON(history[historyIndex], () => {
            fabricCanvas.renderAll();
            updateHistoryButtons();
            updateObjectSelectable();
        });
    }
}

function updateHistoryButtons() {
    const undoBtn = document.getElementById('undoBtn');
    const redoBtn = document.getElementById('redoBtn');
    if (undoBtn) undoBtn.disabled = historyIndex <= 0;
    if (redoBtn) redoBtn.disabled = historyIndex >= history.length - 1;
}

function updateObjectSelectable() {
    if (!fabricCanvas) return;
    let isSelectable = (currentTool === 'select');
    fabricCanvas.forEachObject(obj => {
        obj.selectable = isSelectable;
        obj.evented = isSelectable;
    });
    fabricCanvas.discardActiveObject();
    fabricCanvas.renderAll();
}

document.addEventListener('keydown', (e) => {
    // НОВОЕ: Если открыто модальное окно (например, с распознанным текстом), ESC закрывает его
    const confirmModal = document.getElementById('confirm-modal');
    if (confirmModal && confirmModal.classList.contains('active')) {
        if (e.key === 'Escape') {
            // Симулируем клик по кнопке "Отмена", чтобы корректно вызвался cleanup
            document.getElementById('modal-cancel').click();
            e.stopPropagation();
        }
        return;
    }

    // Если редактор еще не открыт (мы в режиме выделения области)
    if (!fabricCanvas) {
        if (e.key === 'Escape') {
            const overlay = document.getElementById('overlay-ui');
            // Если оверлей активен, выходим из режима выделения
            if (overlay && overlay.style.display === 'block') {
                cancelCapture();
            }
        }
        return;
    }
    
    const activeObject = fabricCanvas.getActiveObject();
    
    if (activeObject && activeObject.isEditing) {
        if (e.key === 'Escape' || e.key === 'Enter') {
            activeObject.exitEditing();
            e.stopPropagation();
        }
        return; 
    }

    if (e.key === 'Delete' || e.key === 'Backspace') {
        if (activeObject) {
            e.preventDefault(); 
            fabricCanvas.remove(activeObject);
            fabricCanvas.discardActiveObject();
            fabricCanvas.renderAll();
            saveHistory();
        }
    }
    
    if (e.key === 'Escape') {
        cancelCapture();
    }
});

export function updateEditorPosition(left, top, width, height) {
    if (!fabricCanvas) return;
    const dx = currentRect.left - left;
    const dy = currentRect.top - top;
    if (dx !== 0 || dy !== 0) {
        fabricCanvas.forEachObject(obj => {
            obj.set({ left: obj.left + dx, top: obj.top + dy });
            obj.setCoords();
        });
    }
    currentRect = { left: left, top: top, width: width, height: height };
    const container = document.querySelector('.canvas-container');
    if (container) {
        container.style.left = left + 'px';
        container.style.top = top + 'px';
    }
    fabricCanvas.setDimensions({ width: width, height: height });
    
    const img = document.getElementById('bg-screenshot');
    const bgCanvas = document.createElement('canvas');
    bgCanvas.width = width;
    bgCanvas.height = height;
    const bgCtx = bgCanvas.getContext('2d');
    
    const imgW = img.clientWidth > 0 ? img.clientWidth : (img.naturalWidth || width);
    const imgH = img.clientHeight > 0 ? img.clientHeight : (img.naturalHeight || height);
    const scaleX = img.naturalWidth / imgW;
    const scaleY = img.naturalHeight / imgH;
    
    bgCtx.drawImage(img, left * scaleX, top * scaleY, width * scaleX, height * scaleY, 0, 0, width, height);
    editorBgCanvas = bgCanvas;
    
    fabric.Image.fromURL(bgCanvas.toDataURL(), (bgImg) => {
        fabricCanvas.setBackgroundImage(bgImg, fabricCanvas.renderAll.bind(fabricCanvas), { scaleX: 1, scaleY: 1 });
    });
}

export function initEditor(rect) {
    try {
        // НОВОЕ: Скрываем рамку фокуса, так как редактор открыт

        const captureBorder = document.getElementById('capture-border');
        if (captureBorder) captureBorder.style.display = 'none';

        // НОВОЕ: Скрываем OCR и Перевод в режиме полного экрана
        const isFullScreen = (rect.width === window.innerWidth && rect.height === window.innerHeight);
        const btnOcr = document.getElementById('btn-ocr');
        const btnTranslate = document.getElementById('btn-translate');
        if (btnOcr) btnOcr.style.display = isFullScreen ? 'none' : 'flex';
        if (btnTranslate) btnTranslate.style.display = isFullScreen ? 'none' : 'flex';

        logMsg("initEditor: Start. Rect: " + JSON.stringify(rect));

        // НОВОЕ: Если канвас уже существует (пользователь сделал новое выделение),
        // мы не уничтожаем его, а просто обновляем позицию и размер.
        // Это сохраняет все предыдущие переводы и наложения!
        if (fabricCanvas) {
            logMsg("initEditor: Canvas already exists. Updating position.");
            updateEditorPosition(rect.left, rect.top, rect.width, rect.height);
            
            // Показываем тулбар снова
            document.getElementById('toolbar').style.display = 'flex';
            document.getElementById('status-text').style.display = 'none';
            return;
        }


        if (rect.width < 10 || rect.height < 10) return;

        currentRect = rect;
        isSaved = false; 
        
        const selBox = document.getElementById('selection-box');
        selBox.style.left = rect.left + 'px';
        selBox.style.top = rect.top + 'px';
        selBox.style.width = rect.width + 'px';
        selBox.style.height = rect.height + 'px';
        selBox.classList.add('adjusted');
        
        document.getElementById('status-text').style.display = 'none';
        document.getElementById('toolbar').style.display = 'flex';
        
        const toolbar = document.getElementById('toolbar');
        const TOOLBAR_POS_KEY = 'bastyshot_toolbar_pos';
        toolbar.style.transform = 'translateX(-50%)';
        toolbar.style.left = '50%';
        toolbar.style.top = '15px';
        toolbar.style.bottom = 'auto';
        const savedPos = localStorage.getItem(TOOLBAR_POS_KEY);
        if (savedPos) {
            try {
                const pos = JSON.parse(savedPos);
                requestAnimationFrame(() => {
                    const tbWidth = toolbar.offsetWidth || 500;
                    const tbHeight = toolbar.offsetHeight || 50;
                    if (pos.x < 0 || pos.y < 0 || pos.x + tbWidth > window.innerWidth || pos.y + tbHeight > window.innerHeight) {
                        toolbar.style.transform = 'translateX(-50%)';
                        toolbar.style.left = '50%';
                        toolbar.style.top = '15px';
                        toolbar.style.bottom = 'auto';
                    } else {
                        toolbar.style.transform = 'none';
                        toolbar.style.left = pos.x + 'px';
                        toolbar.style.top = pos.y + 'px';
                    }
                });
            } catch(e) {}
        }

        if (fabricCanvas) {
            fabricCanvas.dispose();
            fabricCanvas = null;
        }
        const oldContainer = document.querySelector('.canvas-container');
        if (oldContainer) oldContainer.remove();
        
        const overlayUi = document.getElementById('overlay-ui');
        let canvasEl = document.getElementById('editor-canvas');
        if (!canvasEl) {
            canvasEl = document.createElement('canvas');
            canvasEl.id = 'editor-canvas';
            overlayUi.appendChild(canvasEl);
        }

        fabricCanvas = new fabric.Canvas('editor-canvas', {
            backgroundColor: 'rgba(0,0,0,0)',
            selection: false,
            preserveObjectStacking: true,
            width: rect.width,
            height: rect.height
        });

        const container = document.querySelector('.canvas-container');
        if (container) {
            container.style.position = 'absolute';
            container.style.left = rect.left + 'px';
            container.style.top = rect.top + 'px';
            container.style.zIndex = '20';
            container.style.pointerEvents = 'auto';
            container.style.setProperty('--wails-draggable', 'no-drag');
        }

        const upperCanvas = document.querySelector('.upper-canvas');
        const lowerCanvas = document.querySelector('.lower-canvas');
        if (upperCanvas) {
            upperCanvas.style.pointerEvents = 'auto';
            upperCanvas.style.setProperty('--wails-draggable', 'no-drag');
        }
        if (lowerCanvas) {
            lowerCanvas.style.pointerEvents = 'auto';
            lowerCanvas.style.setProperty('--wails-draggable', 'no-drag');
        }

        const img = document.getElementById('bg-screenshot');
        const bgCanvas = document.createElement('canvas');
        bgCanvas.width = rect.width;
        bgCanvas.height = rect.height;
        const bgCtx = bgCanvas.getContext('2d');
        
        const imgW = img.clientWidth > 0 ? img.clientWidth : (img.naturalWidth || rect.width);
        const imgH = img.clientHeight > 0 ? img.clientHeight : (img.naturalHeight || rect.height);
        const scaleX = img.naturalWidth / imgW;
        const scaleY = img.naturalHeight / imgH;
        
        bgCtx.drawImage(img, rect.left * scaleX, rect.top * scaleY, rect.width * scaleX, rect.height * scaleY, 0, 0, rect.width, rect.height);
        editorBgCanvas = bgCanvas;
        
        fabric.Image.fromURL(bgCanvas.toDataURL(), (bgImg) => {
            fabricCanvas.setBackgroundImage(bgImg, fabricCanvas.renderAll.bind(fabricCanvas), { scaleX: 1, scaleY: 1 });
            if (history.length === 0) saveHistory();
        });

        let isDown = false;
        let origX, origY;
        let numberCounter = 1; 

        fabricCanvas.on('mouse:down', (o) => {
            isDown = true;
            const pointer = fabricCanvas.getPointer(o.e);
            origX = pointer.x;
            origY = pointer.y;
            const color = document.getElementById('colorPicker').value;

            if (currentTool === 'arrow' || currentTool === 'line') {
                activeShape = new fabric.Line([origX, origY, origX, origY], {
                    stroke: color, strokeWidth: currentSize, strokeLineCap: 'round', selectable: false, evented: false
                });
                fabricCanvas.add(activeShape);
            } else if (currentTool === 'rect') {
                activeShape = new fabric.Rect({
                    left: origX, top: origY, originX: 'left', originY: 'top', width: 0, height: 0,
                    fill: 'transparent', stroke: color, strokeWidth: currentSize, selectable: false, evented: false
                });
                fabricCanvas.add(activeShape);
            } else if (currentTool === 'oval') {
                activeShape = new fabric.Ellipse({
                    left: origX, top: origY, originX: 'left', originY: 'top', rx: 0, ry: 0,
                    fill: 'transparent', stroke: color, strokeWidth: currentSize, selectable: false, evented: false
                });
                fabricCanvas.add(activeShape);
            } else if (currentTool === 'blur' || currentTool === 'mosaic') {
                activeShape = new fabric.Rect({
                    left: origX, top: origY, fill: 'rgba(255,255,255,0.3)', stroke: '#000', strokeWidth: 1,
                    strokeDashArray: [5, 5], originX: 'left', originY: 'top', selectable: false, evented: false
                });
                fabricCanvas.add(activeShape);
            } else if (currentTool === 'text') {
                const text = new fabric.IText('Текст', {
                    left: origX, top: origY, fontFamily: 'Segoe UI', fontSize: 16, fill: color,
                    selectable: true, evented: true
                });
                fabricCanvas.add(text);
                fabricCanvas.setActiveObject(text);
                text.enterEditing();
                text.selectAll();
                saveHistory();
                isDown = false; 
            } else if (currentTool === 'number') {
                const circle = new fabric.Circle({ radius: 15, fill: color, originX: 'center', originY: 'center' });
                const numText = new fabric.Text(String(numberCounter), {
                    fontSize: 16, fill: '#fff', fontFamily: 'Segoe UI', originX: 'center', originY: 'center', fontWeight: 'bold'
                });
                const group = new fabric.Group([circle, numText], {
                    left: origX - 15, top: origY - 15, selectable: true, evented: true
                });
                fabricCanvas.add(group);
                numberCounter++;
                saveHistory();
                isDown = false; 
            }
        });

        fabricCanvas.on('mouse:move', (o) => {
            if (!isDown) return;
            const pointer = fabricCanvas.getPointer(o.e);

            if ((currentTool === 'arrow' || currentTool === 'line') && activeShape) {
                activeShape.set({ x2: pointer.x, y2: pointer.y });
            } else if (currentTool === 'rect' && activeShape) {
                let w = pointer.x - origX;
                let h = pointer.y - origY;
                if (w < 0) { activeShape.set({ left: pointer.x, width: -w }); } else { activeShape.set({ width: w }); }
                if (h < 0) { activeShape.set({ top: pointer.y, height: -h }); } else { activeShape.set({ height: h }); }
            } else if (currentTool === 'oval' && activeShape) {
                let w = pointer.x - origX;
                let h = pointer.y - origY;
                if (w < 0) { activeShape.set({ left: pointer.x, rx: Math.abs(w)/2 }); } else { activeShape.set({ rx: w/2 }); }
                if (h < 0) { activeShape.set({ top: pointer.y, ry: Math.abs(h)/2 }); } else { activeShape.set({ ry: h/2 }); }
            } else if ((currentTool === 'blur' || currentTool === 'mosaic') && activeShape) {
                if (pointer.x < origX) activeShape.set({ left: pointer.x });
                if (pointer.y < origY) activeShape.set({ top: pointer.y });
                activeShape.set({ width: Math.abs(pointer.x - origX), height: Math.abs(pointer.y - origY) });
            }
            fabricCanvas.renderAll();
        });

        fabricCanvas.on('mouse:up', (o) => {
            if (!isDown) return;
            isDown = false;

            if (currentTool === 'arrow' && activeShape) {
                const x1 = activeShape.x1, y1 = activeShape.y1, x2 = activeShape.x2, y2 = activeShape.y2;
                fabricCanvas.remove(activeShape); 

                const color = document.getElementById('colorPicker').value;
                const headlen = currentSize * 3 + 6;
                const dx = x2 - x1;
                const dy = y2 - y1;
                const lineLength = Math.sqrt(dx * dx + dy * dy);
                const angleDeg = Math.atan2(dy, dx) * 180 / Math.PI;
                const midX = (x1 + x2) / 2;
                const midY = (y1 + y2) / 2;

                const line = new fabric.Line([-lineLength / 2, 0, lineLength / 2, 0], {
                    stroke: color, strokeWidth: currentSize, strokeLineCap: 'round', left: midX, top: midY,
                    originX: 'center', originY: 'center', angle: angleDeg
                });

                const triangle = new fabric.Triangle({
                    left: x2, top: y2, originX: 'center', originY: 'center', angle: angleDeg + 90,
                    width: headlen, height: headlen * 1.5, fill: color
                });

                const arrowGroup = new fabric.Group([line, triangle], { selectable: false, evented: false });
                fabricCanvas.add(arrowGroup);
                saveHistory(); 
            } else if (currentTool === 'line' && activeShape) {
                activeShape.set({ selectable: false, evented: false });
                saveHistory();
            } else if (currentTool === 'rect' && activeShape) {
                activeShape.set({ selectable: false, evented: false });
                
                // НОВОЕ: Логирование параметров квадрата
                logMsg(`Rect drawn: left=${activeShape.left.toFixed(1)}, top=${activeShape.top.toFixed(1)}, width=${activeShape.width.toFixed(1)}, height=${activeShape.height.toFixed(1)}, stroke=${activeShape.stroke}, strokeWidth=${activeShape.strokeWidth}`);
                
                saveHistory();

            } else if (currentTool === 'oval' && activeShape) {
                activeShape.set({ selectable: false, evented: false });
                saveHistory();
            } else if ((currentTool === 'blur' || currentTool === 'mosaic') && activeShape) {
                const left = Math.max(0, Math.round(activeShape.left));
                const top = Math.max(0, Math.round(activeShape.top));
                const width = Math.min(editorBgCanvas.width - left, Math.round(activeShape.width));
                const height = Math.min(editorBgCanvas.height - top, Math.round(activeShape.height));
                fabricCanvas.remove(activeShape); 
                
                if (width > 2 && height > 2 && editorBgCanvas) {
                    const tempCanvas = document.createElement('canvas');
                    tempCanvas.width = width;
                    tempCanvas.height = height;
                    const tempCtx = tempCanvas.getContext('2d');
                    tempCtx.drawImage(editorBgCanvas, left, top, width, height, 0, 0, width, height);
                    
                    fabric.Image.fromURL(tempCanvas.toDataURL(), (editedImg) => {
                        editedImg.set({ 
                            left: left, top: top, originX: 'left', originY: 'top', 
                            selectable: false, evented: false, hoverCursor: 'move'
                        });
                        
                        if (currentTool === 'blur') {
                            const blurAmount = 0.9; 
                            const blurFilter = new fabric.Image.filters.Blur();
                            blurFilter.blur = blurAmount;
                            editedImg.filters.push(blurFilter);
                            editedImg.applyFilters();
                            editedImg.isBlur = true;
                            editedImg.blurAmount = blurAmount; 
                        } else if (currentTool === 'mosaic') {
                            const blockSize = Math.max(4, currentSize * 2); 
                            const pixelFilter = new fabric.Image.filters.Pixelate({ blocksize: blockSize });
                            editedImg.filters.push(pixelFilter);
                            editedImg.applyFilters();
                            editedImg.isMosaic = true;
                            editedImg.blockSize = blockSize;
                        }
                        
                        fabricCanvas.add(editedImg);
                        fabricCanvas.sendObjectToBack(editedImg);
                        fabricCanvas.renderAll();
                        saveHistory(); 
                    });
                }
            }
            activeShape = null;
        });

        fabricCanvas.on('object:moving', (e) => {
            const obj = e.target;
            if (obj && (obj.isBlur || obj.isMosaic)) {
                obj.set({ opacity: 0.7 });
                let w = obj.getScaledWidth();
                let h = obj.getScaledHeight();
                obj.set({
                    left: Math.max(0, Math.min(obj.left, currentRect.width - w)),
                    top: Math.max(0, Math.min(obj.top, currentRect.height - h))
                });
            }
        });

        fabricCanvas.on('object:scaling', (e) => {
            const obj = e.target;
            if (obj && (obj.isBlur || obj.isMosaic)) {
                if (obj.left < 0) obj.set({ left: 0 });
                if (obj.top < 0) obj.set({ top: 0 });
                
                let maxW = currentRect.width - obj.left;
                let maxH = currentRect.height - obj.top;
                
                if (obj.getScaledWidth() > maxW) obj.set({ scaleX: maxW / obj.width });
                if (obj.getScaledHeight() > maxH) obj.set({ scaleY: maxH / obj.height });
            }
        });

        fabricCanvas.on('object:modified', (e) => {
            const obj = e.target;
            if (obj && (obj.isBlur || obj.isMosaic) && editorBgCanvas) {
                obj.set({ opacity: 1 });
                let l = Math.max(0, Math.min(Math.round(obj.left), currentRect.width - 3));
                let t = Math.max(0, Math.min(Math.round(obj.top), currentRect.height - 3));
                let w = Math.max(3, Math.min(Math.round(obj.getScaledWidth()), currentRect.width - l));
                let h = Math.max(3, Math.min(Math.round(obj.getScaledHeight()), currentRect.height - t));

                const tempCanvas = document.createElement('canvas');
                tempCanvas.width = w;
                tempCanvas.height = h;
                const tempCtx = tempCanvas.getContext('2d');
                tempCtx.drawImage(editorBgCanvas, l, t, w, h, 0, 0, w, h);
                
                obj.setSrc(tempCanvas.toDataURL(), () => {
                    if (obj.isBlur) {
                        const oldBlurAmount = obj.blurAmount || 0.9;
                        const blurFilter = new fabric.Image.filters.Blur();
                        blurFilter.blur = oldBlurAmount;
                        obj.filters = [blurFilter];
                        obj.blurAmount = oldBlurAmount;
                    } else if (obj.isMosaic) {
                        const oldBlockSize = obj.blockSize || 10;
                        const pixelFilter = new fabric.Image.filters.Pixelate({ blocksize: oldBlockSize });
                        obj.filters = [pixelFilter];
                        obj.blockSize = oldBlockSize;
                    }
                    
                    obj.applyFilters();
                    obj.set({ scaleX: 1, scaleY: 1, width: w, height: h, left: l, top: t });
                    
                    fabricCanvas.sendObjectToBack(obj);
                    fabricCanvas.renderAll();
                    saveHistory();
                });
            }
        });

        fabricCanvas.on('path:created', () => {
            if (fabricCanvas.getActiveObject()) {
                fabricCanvas.getActiveObject().set({ selectable: false, evented: false });
                fabricCanvas.discardActiveObject();
            }
            saveHistory();
        });

        setTool('draw');
    } catch(e) {
        logMsg("initEditor ERROR: " + e.message);
        alert("Ошибка инициализации редактора: " + e.message);
    }
}

export function setTool(tool) {
    currentTool = tool;
    if (!fabricCanvas) return;
    
    fabricCanvas.isDrawingMode = false;
    fabricCanvas.selection = false;
    fabricCanvas.defaultCursor = 'crosshair';
    fabricCanvas.hoverCursor = 'crosshair';
    
    document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
    
    const toolBtn = document.querySelector(`.tool-btn[data-tool="${tool}"]`);
    if (toolBtn) toolBtn.classList.add('active');
    
    if (tool === 'draw') {
        fabricCanvas.isDrawingMode = true;
        if (!fabricCanvas.freeDrawingBrush) {
            fabricCanvas.freeDrawingBrush = new fabric.PencilBrush(fabricCanvas);
        }
        fabricCanvas.freeDrawingBrush.color = document.getElementById('colorPicker').value;
        fabricCanvas.freeDrawingBrush.width = currentSize;
    } else if (tool === 'marker') {
        fabricCanvas.isDrawingMode = true;
        if (!fabricCanvas.freeDrawingBrush) {
            fabricCanvas.freeDrawingBrush = new fabric.PencilBrush(fabricCanvas);
        }
        fabricCanvas.freeDrawingBrush.color = hexToRgba(document.getElementById('colorPicker').value, 0.4);
        fabricCanvas.freeDrawingBrush.width = currentSize * 2; 
    } else if (tool === 'text') {
        fabricCanvas.defaultCursor = 'text';
        fabricCanvas.hoverCursor = 'text';
    } else if (tool === 'select') {
        fabricCanvas.selection = true;
        fabricCanvas.defaultCursor = 'default';
        fabricCanvas.hoverCursor = 'move';
    }
    
    updateObjectSelectable();
}

export async function saveEditedImage() {
    if (!fabricCanvas) return;
    const dataUrl = fabricCanvas.toDataURL({ format: 'png', multiplier: 1 });
    
    // НОВОЕ: Генерируем миниатюру для галереи
    const thumbUrl = fabricCanvas.toDataURL({ format: 'jpeg', quality: 0.5, multiplier: 0.1 });
    
    let filename = await wails.SaveCroppedImage(dataUrl, thumbUrl);
    showToast("Скриншот сохранен:\n" + filename);
    isSaved = true; 
    setTimeout(() => { cancelCapture(); }, 1500);
}

export async function copyEditedImage() {
    if (!fabricCanvas) return;
    const dataUrl = fabricCanvas.toDataURL({ format: 'png', multiplier: 1 });
    await wails.CopyImageToClipboard(dataUrl);
    
    const btn = document.querySelector('[title="Копировать"]');
    if (btn) {
        const originalBg = btn.style.background;
        btn.style.background = '#10b981';
        setTimeout(() => { btn.style.background = originalBg; }, 1000);
    }
    
    showToast("Скриншот скопирован в буфер обмена!");
    isSaved = true; 
}

function showPasswordPrompt() {
    return new Promise((resolve) => {
        const modal = document.getElementById('password-prompt-modal');
        const input = document.getElementById('pwd-input-field');
        const error = document.getElementById('pwd-prompt-error');
        const shortLinkCheck = document.getElementById('short-link-check');
        const okBtn = document.getElementById('pwd-prompt-ok');
        const cancelBtn = document.getElementById('pwd-prompt-cancel');

        input.value = '';
        error.style.display = 'none';
        shortLinkCheck.checked = false;
        
        centerModalAboveToolbar(modal).then(() => {
            modal.classList.add('active');
            setTimeout(() => input.focus(), 100);
        });

        const cleanup = () => {
            modal.classList.remove('active');
            okBtn.removeEventListener('click', onOk);
            cancelBtn.removeEventListener('click', onCancel);
            input.removeEventListener('keypress', onKeypress);
        };

        const onOk = () => {
            if (input.value === "") {
                error.style.display = 'block';
                return;
            }
            cleanup();
            resolve({ password: input.value, useShortLink: shortLinkCheck.checked });
        };

        const onCancel = () => {
            cleanup();
            resolve(null);
        };

        const onKeypress = (e) => {
            if (e.key === 'Enter') onOk();
        };

        okBtn.addEventListener('click', onOk);
        cancelBtn.addEventListener('click', onCancel);
        input.addEventListener('keypress', onKeypress);
    });
}


function showDirectLinkWarning() {
    return new Promise((resolve) => {
        const modal = document.getElementById('direct-link-warning-modal');
        const okBtn = document.getElementById('dl-warning-ok');
        const cancelBtn = document.getElementById('dl-warning-cancel');
        
        centerModalOnPrimaryScreen(modal).then(() => modal.classList.add('active'));
        
        const cleanup = () => {
            modal.classList.remove('active');
            okBtn.removeEventListener('click', onOk);
            cancelBtn.removeEventListener('click', onCancel);
        };
        
        const onOk = () => { cleanup(); resolve(true); };
        const onCancel = () => { cleanup(); resolve(false); };
        
        okBtn.addEventListener('click', onOk);
        cancelBtn.addEventListener('click', onCancel);
    });
}


let lastPublishPayload = null;

export async function publishImage() { 
    if (!fabricCanvas) {
        showToast("Ошибка: Канвас не найден!");
        return;
    }
    
    const activeOpt = document.querySelector('.publish-option.active');
    let currentMode = activeOpt ? activeOpt.dataset.mode : 'default';
    let password = "";
    let useShortLink = false;
    let isDirectLink = false; // НОВОЕ
    
    // НОВОЕ: Если выбран режим прямой ссылки
    if (currentMode === 'directlink') {
        const proceed = await showDirectLinkWarning();
        if (!proceed) return; // Пользователь нажал "Отмена"
        
        isDirectLink = true;
    } else if (currentMode === 'password') {
        const pwdResult = await showPasswordPrompt();
        if (pwdResult === null) return;
        password = pwdResult.password;
        useShortLink = pwdResult.useShortLink;
    }
    
    // 1. Получаем картинку до закрытия редактора
    const dataUrl = fabricCanvas.toDataURL({ format: 'png', multiplier: 1 });
    
    // НОВОЕ: Генерируем маленькую миниатюру (JPEG, масштаб 10%, качество 50%)
    const thumbUrl = fabricCanvas.toDataURL({ format: 'jpeg', quality: 0.5, multiplier: 0.1 });
    
    // Сохраняем данные для возможного повтора
    lastPublishPayload = { dataUrl, password, useShortLink, isDirectLink, thumbnail: thumbUrl };
    
    // 2. Очищаем редактор вручную
    if (fabricCanvas) {
        fabricCanvas.dispose(); 
        fabricCanvas = null; 
    }
    const container = document.querySelector('.canvas-container');
    if (container) container.remove();
    document.getElementById('toolbar').style.display = 'none';
    document.getElementById('overlay-ui').style.display = 'none';
    document.getElementById('bg-screenshot').src = "";
    document.getElementById('panel-ui').style.display = 'none';
    
    await new Promise(r => setTimeout(r, 100));
    
    // 3. Запускаем публикацию
    await executePublish(lastPublishPayload);
}

async function executePublish(payload) {
    let cfg = await wails.GetConfig();
    const showUploadUI = cfg.showUpload !== false; // Показ процесса загрузки
    const showInfoUI = cfg.showInfo !== false;     // Показ инфо-окна после загрузки

    const toastUI = document.getElementById('publish-toast-ui');
    const toastLoading = document.getElementById('toast-loading');
    const toastSuccess = document.getElementById('toast-success');
    const toastError = document.getElementById('toast-error');
    
    window.currentPublishLink = ""; 

    // 1. Управление окном во время загрузки
        if (showUploadUI) {
            window.toastDesiredVisible = true;
            
            // НОВОЕ: Сначала показываем UI (спиннер), ПОТОМ вызываем Go для изменения размера окна!
            toastUI.style.display = 'flex';
            toastLoading.style.display = 'flex';
            toastSuccess.style.display = 'none';
            toastError.style.display = 'none';
            document.getElementById('toast-hide-success').checked = cfg.toastHideSuccess || false;
            document.getElementById('toast-hide-error').checked = cfg.toastHideError || false;

            if (!window.isSettingsOpen) {
                await wails.ShowPublishToast();
            }
        } else {
            window.toastDesiredVisible = false;
            await wails.HidePublishToast();
        }

    try {
        const link = await wails.PublishToIPFS(payload.dataUrl, payload.password, payload.useShortLink, payload.isDirectLink, payload.thumbnail);
        
        if (wails.ClipboardSetText) {
            await wails.ClipboardSetText(link);
        }
        window.currentPublishLink = link;
        isSaved = true;
        
        // 2. Если в настройках включено "Выводить информационное окно"
        if (showInfoUI) {
            window.toastDesiredVisible = true;
            if (!window.isSettingsOpen) {
                await wails.ShowPublishToast();
            }
            toastLoading.style.display = 'none';
            toastError.style.display = 'none';
            toastSuccess.style.display = 'flex';
            toastUI.style.display = 'flex';
            document.getElementById('toast-hide-success').checked = cfg.toastHideSuccess || false;
        } else {
            window.toastDesiredVisible = false;
            await wails.HidePublishToast();
            showToast("✅ Ссылка скопирована в буфер!");
        }
        
    } catch (e) {
        console.error("Publish: Ошибка загрузки:", e);
        window.currentPublishLink = "";
        
        let errMsg = e.message || e.toString();
        
        // Если это отмена — просто выходим
        if (errMsg.includes("отменена")) {
            window.toastDesiredVisible = false;
            await wails.HidePublishToast();
            return; 
        }

        // Анализируем ошибку и делаем понятный текст
        let displayError = "❌ Ошибка загрузки";
        if (errMsg.includes("API ключ")) {
            displayError = "🔑 Ошибка: Неверный API ключ Pinata.\nПроверьте настройки IPFS.";
        } else if (errMsg.includes("Ошибка сети") || errMsg.includes("context") || errMsg.includes("timeout") || errMsg.includes("Прокси")) {
            displayError = "🌐 Нет связи с сервером.\nПроверьте интернет или VPN.";
        } else if (errMsg.includes("Ошибка Pinata")) {
            displayError = "⚠️ Сервер Pinata отклонил запрос.\n" + errMsg;
        } else {
            displayError = "❌ Ошибка: " + errMsg;
        }

        // Обработка показа окна ошибки
        if (cfg.toastHideError) {
            window.toastDesiredVisible = false;
            await wails.HidePublishToast();
            showToast(displayError);
        } else {
            window.toastDesiredVisible = true;
            if (!window.isSettingsOpen) {
                await wails.ShowPublishToast();
            }
            toastLoading.style.display = 'none'; 
            toastSuccess.style.display = 'none';
            toastError.style.display = 'flex';
            toastUI.style.display = 'flex';
            
            // Вставляем расшифрованный текст ошибки
            document.getElementById('toast-error-text').innerText = displayError;
            
            document.getElementById('toast-hide-error').checked = cfg.toastHideError || false;
        }
    }
}

async function closePublishToast() {
    window.toastDesiredVisible = false;
    document.getElementById('publish-toast-ui').style.display = 'none';
    document.getElementById('panel-ui').style.display = 'none';
    await wails.HidePublishToast();
}


// --- Обработчики для кнопок в тосте ---
document.addEventListener('DOMContentLoaded', () => {
    // ... существующие обработчики ...

    // Кнопка "Открыть" в тосте
    document.getElementById('toast-btn-open')?.addEventListener('click', () => {
        if (window.currentPublishLink) {
            wails.BrowserOpenURL(window.currentPublishLink);
        }
    });

    // Кнопка "Отмена" при загрузке
    document.getElementById('toast-btn-cancel-loading')?.addEventListener('click', async () => {
        // 1. Просим Go прервать сетевой запрос
        await wails.CancelIPFSUpload();
        // 2. Закрываем тост
        await closePublishToast();
        // 3. Показываем уведомление
        showToast("🚫 Загрузка отменена");
    });


    // Кнопка "Копировать" в тосте
    document.getElementById('toast-btn-copy')?.addEventListener('click', async () => {
        if (window.currentPublishLink) {
            await wails.ClipboardSetText(window.currentPublishLink);
            
            // Анимация кнопки (меняем текст и цвет на 1.5 секунды)
            const btn = document.getElementById('toast-btn-copy');
            const originalText = btn.innerText;
            btn.innerText = "Скопировано!";
            btn.style.background = "#10b981"; // Зеленый
            btn.style.color = "#ffffff";
            
            setTimeout(() => {
                btn.innerText = originalText;
                btn.style.background = ""; // Возврат к стандартному цвету
                btn.style.color = "";
            }, 1500);
        }
    });


    // Кнопка "Повторить" при ошибке
    document.getElementById('toast-btn-retry')?.addEventListener('click', () => {
        if (lastPublishPayload) {
            executePublish(lastPublishPayload);
        }
    });

    // Кнопка "Отмена" при ошибке
    document.getElementById('toast-btn-error-cancel')?.addEventListener('click', () => {
        closePublishToast();
    });

    // Сохранение галочки "Не показывать при успехе"
    document.getElementById('toast-hide-success')?.addEventListener('change', async (e) => {
        let cfg = await wails.GetConfig();
        cfg.toastHideSuccess = e.target.checked;
        await wails.SaveConfig(cfg);
    });

    // Сохранение галочки "Не показывать ошибки"
    document.getElementById('toast-hide-error')?.addEventListener('change', async (e) => {
        let cfg = await wails.GetConfig();
        cfg.toastHideError = e.target.checked;
        await wails.SaveConfig(cfg);
    });

    // Кнопка закрытия тоста (успех)
    document.getElementById('toast-btn-close')?.addEventListener('click', async () => {
        document.getElementById('publish-toast-ui').style.display = 'none';
        await wails.HidePublishToast();
        // Возвращаем главную панель
        document.getElementById('panel-ui').style.display = 'flex';
    });

    // Кнопка закрытия тоста (ошибка)
    document.getElementById('toast-btn-error-close')?.addEventListener('click', async () => {
        document.getElementById('publish-toast-ui').style.display = 'none';
        await wails.HidePublishToast();
        document.getElementById('panel-ui').style.display = 'flex';
    });
});









export async function cancelCapture() {
    if (fabricCanvas) { 
        const hasObjects = fabricCanvas.getObjects().length > 0;
        const skipWarning = localStorage.getItem('skip_exit_warning') === 'true';
        
        if (!isSaved && hasObjects && !skipWarning) {
            showConfirmModal("Выйти из режима редактирования?", "Все несохраненные изменения будут потеряны.", () => {
                destroyEditor();
            });
            return; 
        }
    }
    destroyEditor();
}

function destroyEditor() {
    // НОВОЕ: Останавливаем таймер перевода, если он работал
    if (window.translateTimer) clearInterval(window.translateTimer);
    
    const captureBorder = document.getElementById('capture-border');
    if (captureBorder) captureBorder.style.display = 'none';

    if (fabricCanvas) {
        fabricCanvas.dispose(); 
        fabricCanvas = null; 
    }
    const container = document.querySelector('.canvas-container');
    if (container) container.remove();
    
    document.getElementById('toolbar').style.display = 'none';
    document.getElementById('overlay-ui').style.display = 'none';
    
    // НОВОЕ: Прячем панель, чтобы она не растянулась на весь экран, пока окно схлопывается
    document.getElementById('panel-ui').style.display = 'none';
    document.body.style.opacity = '0'; 
    
    document.getElementById('bg-screenshot').src = "";
    
    const pubOverlay = document.getElementById('publishing-overlay');
    if (pubOverlay) pubOverlay.classList.remove('active');
    
    const selBox = document.getElementById('selection-box');
    selBox.style.display = 'none';
    selBox.classList.remove('adjusted');
    document.querySelectorAll('.dim-area').forEach(el => el.style.display = 'none');
    
    // Когда Go-бэкенд уменьшит окно, мы вернем прозрачность и покажем панель
    wails.CloseOverlay().then(() => {
        document.getElementById('panel-ui').style.display = 'flex';
        document.body.style.opacity = '1';
    });
    
    history = [];
    historyIndex = -1;
    updateHistoryButtons();
}

function showConfirmModal(title, message, onConfirm) {
    const modal = document.getElementById('confirm-modal');
    const modalTitle = document.getElementById('modal-title');
    const modalText = document.getElementById('modal-text');
    const btnCancel = document.getElementById('modal-cancel');
    const btnExit = document.getElementById('modal-exit');
    const chkDontShow = document.getElementById('modal-dont-show');

    modalTitle.innerText = title;
    modalText.innerText = message;
    chkDontShow.checked = false; 
    
    centerModalOnPrimaryScreen(modal).then(() => {
        modal.classList.add('active');

        const cleanup = () => {
            modal.classList.remove('active');
            btnCancel.removeEventListener('click', onCancel);
            btnExit.removeEventListener('click', onExit);
        };

        const onCancel = () => cleanup();
        const onExit = () => {
            if (chkDontShow.checked) {
                localStorage.setItem('skip_exit_warning', 'true');
            }
            cleanup();
            onConfirm();
        };
        
        btnExit.addEventListener('click', onExit);
        btnCancel.addEventListener('click', onCancel);
    });
}

document.addEventListener('DOMContentLoaded', () => {
    const sizeSlider = document.getElementById('sizeSlider');
    const colorPicker = document.getElementById('colorPicker');

    if (sizeSlider) {
        sizeSlider.addEventListener('input', (e) => { 
            currentSize = parseInt(e.target.value);
            if (fabricCanvas && fabricCanvas.isDrawingMode) {
                if (currentTool === 'marker') {
                    fabricCanvas.freeDrawingBrush.width = currentSize * 2;
                } else {
                    fabricCanvas.freeDrawingBrush.width = currentSize; 
                }
            }
        });
    }
    
    if (colorPicker) {
        colorPicker.addEventListener('input', (e) => { 
            if (fabricCanvas && fabricCanvas.isDrawingMode) {
                if (currentTool === 'marker') {
                    fabricCanvas.freeDrawingBrush.color = hexToRgba(e.target.value, 0.4);
                } else {
                    fabricCanvas.freeDrawingBrush.color = e.target.value; 
                }
            }
        });
    }
});