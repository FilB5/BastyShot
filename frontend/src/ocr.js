import { wails } from './api.js';
import { showToast, centerModalOnPrimaryScreen } from './ui.js';
import Tesseract from 'tesseract.js';

export async function runOCR(fabricCanvas) {
    if (!fabricCanvas) {
        showToast("Ошибка: Канвас не найден!");
        return;
    }
    
    const pubOverlay = document.getElementById('publishing-overlay');
    const pubText = document.getElementById('publish-status-text');
    const pubSpinner = document.getElementById('publish-spinner');
    
    if (pubOverlay) {
        if (pubText) {
            pubText.innerText = "Шаг 1: Проверка словарей (Английский)...";
            pubText.classList.remove('error', 'success');
        }
        if (pubSpinner) pubSpinner.style.display = 'block';
        pubOverlay.classList.add('active');
    }

    try {
        await wails.EnsureTessDataExists('eng');
        await wails.EnsureTessDataExists('rus');

        if (pubText) pubText.innerText = "Шаг 2: Запуск движка распознавания...";
        const dataUrl = fabricCanvas.toDataURL({ format: 'png', multiplier: 1 });
        
        const worker = await Tesseract.createWorker('eng+rus', 1, {
            langPath: '/tessdata',
            logger: m => {
                console.log("Tesseract:", m);
                if (pubText && m.status === 'recognizing text') {
                    pubText.innerText = "Распознавание текста... " + Math.round(m.progress * 100) + "%";
                }
            }
        });
        
        const ret = await worker.recognize(dataUrl);
        await worker.terminate();
        
        const recognizedText = ret.data.text.trim();
        
        if (recognizedText === "") {
            showToast("Текст не найден на скриншоте");
        } else {
            showOCRResultModal(recognizedText);
        }
    } catch (e) {
        console.error("OCR Полная ошибка:", e);
        showToast("❌ Ошибка распознавания: " + e.message);
    } finally {
        if (pubOverlay) pubOverlay.classList.remove('active');
    }
}

function showOCRResultModal(text) {
    const modal = document.getElementById('confirm-modal');
    const modalContent = modal.querySelector('.modal-content');
    const modalTitle = document.getElementById('modal-title');
    const modalText = document.getElementById('modal-text');
    const chkDontShow = document.getElementById('modal-dont-show');
    const btnCancel = document.getElementById('modal-cancel');
    const btnExit = document.getElementById('modal-exit');

    modalTitle.innerText = "Распознанный текст";
    
    modalTitle.style.display = 'flex';
    modalTitle.style.alignItems = 'center';
    modalTitle.style.justifyContent = 'center';
    modalTitle.style.margin = '-24px -24px 16px -24px';
    modalTitle.style.padding = '12px 24px';
    modalTitle.style.borderBottom = '1px solid var(--border)';
    modalTitle.style.borderRadius = '12px 12px 0 0';
    modalTitle.style.background = 'var(--bg-main)';
    modalTitle.style.cursor = 'move';
    modalTitle.style.userSelect = 'none';
    modalTitle.style.flexShrink = '0';

    modalContent.style.display = 'flex';
    modalContent.style.flexDirection = 'column';
    modalContent.style.resize = 'both';
    modalContent.style.overflow = 'hidden';
    modalContent.style.minWidth = '320px';
    modalContent.style.minHeight = '200px';

    chkDontShow.parentElement.style.display = 'none';
    btnExit.innerText = "Копировать";
    btnExit.className = "btn";
    
    modalText.outerHTML = `<textarea id="modal-text" class="form-input" style="flex: 1; width: 100%; margin-bottom: 16px; resize: none; box-sizing: border-box;">${text}</textarea>`;
    
    const modalActions = modalContent.querySelector('.modal-actions');
    if (modalActions) modalActions.style.flexShrink = '0';

    let isDragging = false;
    let startX = 0, startY = 0;
    let initialLeft = 0, initialTop = 0;

    const onMouseDown = (e) => {
        isDragging = true;
        const rect = modalContent.getBoundingClientRect();
        initialLeft = rect.left;
        initialTop = rect.top;
        modalContent.style.position = 'absolute';
        modalContent.style.left = initialLeft + 'px';
        modalContent.style.top = initialTop + 'px';
        modalContent.style.transform = 'none';
        
        startX = e.clientX;
        startY = e.clientY;
        e.preventDefault();
    };

    const onMouseMove = (e) => {
        if (!isDragging) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        modalContent.style.left = (initialLeft + dx) + 'px';
        modalContent.style.top = (initialTop + dy) + 'px';
    };

    const onMouseUp = () => {
        isDragging = false;
    };

    modalTitle.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);

    const cleanup = () => {
        modal.classList.remove('active');
        btnCancel.removeEventListener('click', onCancel);
        btnExit.removeEventListener('click', onCopy);
        modalTitle.removeEventListener('mousedown', onMouseDown);
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        
        const currentText = document.getElementById('modal-text');
        currentText.outerHTML = `<p id="modal-text">Выйти из режима редактирования? Все несохраненные изменения будут потеряны.</p>`;
        chkDontShow.parentElement.style.display = 'flex';
        btnExit.innerText = "Выйти";
        btnExit.className = "btn btn-danger";
        
        modalTitle.style = '';
        modalContent.style.display = '';
        modalContent.style.flexDirection = '';
        modalContent.style.resize = '';
        modalContent.style.overflow = '';
        modalContent.style.minWidth = '';
        modalContent.style.minHeight = '';
        modalContent.style.width = '';   // <--- ДОБАВИТЬ ЭТО
        modalContent.style.height = '';  // <--- ДОБАВИТЬ ЭТО
        modalContent.style.position = '';
        modalContent.style.left = '';
        modalContent.style.top = '';
        modalContent.style.transform = '';
        if (modalActions) modalActions.style.flexShrink = '';
    };

    const onCancel = () => cleanup();
    const onCopy = () => {
        const textarea = document.getElementById('modal-text');
        wails.ClipboardSetText(textarea.value);
        showToast("✅ Текст скопирован в буфер обмена!");
        cleanup();
    };

    btnCancel.addEventListener('click', onCancel);
    btnExit.addEventListener('click', onCopy);
    
    if (typeof centerModalOnPrimaryScreen === 'function') {
        centerModalOnPrimaryScreen(modal).then(() => {
            modal.classList.add('active');
            requestAnimationFrame(() => {
                const rect = modalContent.getBoundingClientRect();
                modalContent.style.position = 'absolute';
                modalContent.style.left = rect.left + 'px';
                modalContent.style.top = rect.top + 'px';
                modalContent.style.transform = 'none';
            });
        });
    } else {
        modal.classList.add('active');
        requestAnimationFrame(() => {
            const rect = modalContent.getBoundingClientRect();
            modalContent.style.position = 'absolute';
            modalContent.style.left = rect.left + 'px';
            modalContent.style.top = rect.top + 'px';
            modalContent.style.transform = 'none';
        });
    }
}

export async function runTranslation(fabricCanvas, saveHistoryFn) {
    if (!fabricCanvas) { return; }
    
    let cfg = await wails.GetConfig();
    if (cfg.warnOnTranslate !== false) {
        const proceed = await showTranslateWarning();
        if (!proceed) return;
    }

    if (!fabricCanvas) {
        showToast("Ошибка: Канвас не найден!");
        return;
    }
    
    if (wails.LogToFile) await wails.LogToFile("Translate: Запуск функции...");

    const pubOverlay = document.getElementById('publishing-overlay');
    const pubText = document.getElementById('publish-status-text');
    const pubSpinner = document.getElementById('publish-spinner');
    
    if (pubOverlay) {
        if (pubText) {
            pubText.innerText = "Распознавание текста...";
            pubText.classList.remove('error', 'success');
        }
        if (pubSpinner) pubSpinner.style.display = 'block';
        pubOverlay.classList.add('active');
    }

    try {
        const dataUrl = fabricCanvas.toDataURL({ format: 'png', multiplier: 3 });
        if (wails.LogToFile) await wails.LogToFile("Translate: Картинка получена (x3), запускаем Tesseract...");
        
        await wails.EnsureTessDataExists('eng');
        await wails.EnsureTessDataExists('rus');
        
        const worker = await Tesseract.createWorker('eng+rus', 1, {
            langPath: '/tessdata',
            logger: m => console.log("Tesseract:", m)
        });
        
        await worker.setParameters({
            tessedit_pageseg_mode: '3'
        });
        
        const ret = await worker.recognize(dataUrl, {}, { blocks: true, text: true });
        await worker.terminate();
        
        if (wails.LogToFile) await wails.LogToFile("Translate: Распознанный текст: " + (ret.data.text || "ПУСТО"));
        
        let lines = [];
        if (ret.data.blocks && ret.data.blocks.length > 0) {
            ret.data.blocks.forEach(block => {
                if (block.paragraphs) {
                    block.paragraphs.forEach(para => {
                        if (para.lines) {
                            lines = lines.concat(para.lines);
                        }
                    });
                }
            });
        } else if (ret.data.lines && ret.data.lines.length > 0) {
            lines = ret.data.lines;
        }
        
        if (wails.LogToFile) await wails.LogToFile("Translate: Найдено всего строк: " + lines.length);

        if (lines.length === 0) {
            showToast("Текст не найден");
            return;
        }

        if (pubText) pubText.innerText = "Перевод на русский...";

        if (window.translateTimer) clearInterval(window.translateTimer);
        
        let seconds = 0;
        window.translateTimer = setInterval(() => {
            seconds++;
            if (pubText) {
                pubText.innerText = `Перевод (${window.currentTranslateEngine || "Google"})... ${seconds} сек`;
            }
        }, 1000);

        let linesToTranslate = [];
        let validLines = [];
        
        for (const line of lines) {
            let t = line.text.trim();
            const confidence = line.confidence || 0;
            
            const letters = t.replace(/[^a-zA-Zа-яА-Я]/g, '');
            
            if (confidence > 50 && t.length > 2 && (letters.length / t.length) > 0.6) {
                if (!/[а-яА-Я]/.test(t)) {
                    t = t.replace(/^\|/g, "I ");
                    t = t.replace(/^Т /g, "I ");
                }
                
                linesToTranslate.push(t);
                validLines.push(line);
            } else {
                if (wails.LogToFile) await wails.LogToFile("Translate: Отфильтрован мусор: " + t + " (Confidence: " + confidence + ")");
            }
        }
        
        if (linesToTranslate.length === 0) {
            clearInterval(window.translateTimer);
            showToast("Чистый текст не найден (только графика)");
            return;
        }

        const blockText = linesToTranslate.join("\n");
        if (wails.LogToFile) await wails.LogToFile("Translate: Отправляем блок текста (" + linesToTranslate.length + " строк)");
        
        const translations = await wails.TranslateBlock(blockText, 'en', 'ru');
        
        if (!translations || translations.length === 0) {
            clearInterval(window.translateTimer);
            showToast("Ошибка перевода");
            return;
        }

        if (wails.LogToFile) await wails.LogToFile("Translate: Получено переводов: " + translations.length);

        for (let i = 0; i < validLines.length; i++) {
            if (!fabricCanvas) break;

            const line = validLines[i];
            const translatedText = translations[i] ? translations[i].trim() : "";
            
            if (wails.LogToFile) await wails.LogToFile("Translate: Накладываем: " + translatedText);

            if (translatedText) {
                const bbox = line.bbox;
                
                let x0 = bbox.x0 / 3;
                let y0 = bbox.y0 / 3;
                let w = (bbox.x1 - bbox.x0) / 3;
                let h = (bbox.y1 - bbox.y0) / 3;

                if (wails.LogToFile) await wails.LogToFile(`Translate: Box coords: x0=${x0.toFixed(1)}, y0=${y0.toFixed(1)}, w=${w.toFixed(1)}, h=${h.toFixed(1)}`);

                x0 -= 4; y0 -= 4; w += 8; h += 8;

                const canvasWidth = fabricCanvas.getWidth();
                const maxRightEdge = canvasWidth - 10;
                
                // НОВОЕ: Рисуем отдельные плашки для каждого слова в строке
                if (line.words && line.words.length > 0) {
                    let words = [...line.words].sort((a, b) => (a.bbox.x0 - b.bbox.x0));
                    
                    let currentPlate = null;
                    const gapThreshold = 15;

                    for (const word of words) {
                        const wx0 = word.bbox.x0 / 3;
                        let wx1 = word.bbox.x1 / 3;
                        let wy0 = word.bbox.y0 / 3;
                        let wy1 = word.bbox.y1 / 3;

                        if (!currentPlate) {
                            currentPlate = { x0: wx0, x1: wx1, y0: wy0, y1: wy1 };
                        } else {
                            if (wx0 - currentPlate.x1 < gapThreshold) {
                                currentPlate.x1 = Math.max(currentPlate.x1, wx1);
                                currentPlate.y0 = Math.min(currentPlate.y0, wy0);
                                currentPlate.y1 = Math.max(currentPlate.y1, wy1);
                            } else {
                                drawWordPlate(currentPlate, fabricCanvas);
                                currentPlate = { x0: wx0, x1: wx1, y0: wy0, y1: wy1 };
                            }
                        }
                    }
                    if (currentPlate) {
                        drawWordPlate(currentPlate, fabricCanvas);
                    }
                } else {
                    const rect = new fabric.Rect({
                        left: x0, top: y0, width: w, height: h,
                        fill: '#ffffff', originX: 'left', originY: 'top',
                        selectable: false, evented: false
                    });
                    fabricCanvas.add(rect);
                }

                let maxWidth = w - 4;
                if (maxWidth < 50) maxWidth = 50;
                
                let realHeight = h;
                if (line.words && line.words.length > 0) {
                    let totalWordH = 0;
                    for (const wd of line.words) {
                        totalWordH += (wd.bbox.y1 - wd.bbox.y0) / 3;
                    }
                    realHeight = totalWordH / line.words.length;
                }
                
                let fontSize = Math.min(Math.round(realHeight * 0.8), 32);
                if (fontSize < 12) fontSize = 12;
                
                if (wails.LogToFile) await wails.LogToFile(`Translate: Avg Word Height: ${realHeight.toFixed(1)}, FontSize: ${fontSize}`);

                let textObj = new fabric.Textbox(translatedText, {
                    left: x0 + 2,
                    top: y0 + 2,
                    width: maxWidth, 
                    fontSize: fontSize,
                    fill: '#000000',
                    textAlign: 'left',
                    fontFamily: 'Arial',
                    originX: 'left',
                    originY: 'top',
                    lineHeight: 1.1,
                    selectable: false,
                    evented: false
                });

                while (textObj.height > h && fontSize > 12) {
                    fontSize -= 1;
                    textObj.set('fontSize', fontSize);
                }

                let finalRectHeight = h;
                if (textObj.height > h) {
                    finalRectHeight = textObj.height + 4;
                } else if (textObj.height < h * 0.8 && textObj.text.split(' ').length > 1) {
                    let lineCount = Math.ceil(textObj.width / maxWidth);
                    if (lineCount > 0) {
                        let targetLineHeight = h / lineCount / fontSize;
                        if (targetLineHeight > 1.5) targetLineHeight = 1.5;
                        textObj.set('lineHeight', targetLineHeight);
                    }
                }

                let finalX = x0;
                let textWidth = textObj.width;
                if (finalX + textWidth > maxRightEdge) {
                    finalX = maxRightEdge - textWidth;
                    if (finalX < 0) finalX = 0;
                    textObj.set('left', finalX + 2);
                }

                const verticalOffset = (finalRectHeight - textObj.height) / 2;
                if (verticalOffset > 0) {
                    textObj.set('top', y0 + verticalOffset);
                }

                fabricCanvas.add(textObj);
            }
        }

        clearInterval(window.translateTimer);
        fabricCanvas.renderAll();
        if (saveHistoryFn) saveHistoryFn();
        showToast("✅ Текст переведен");
        
    } catch (e) {
        console.error("Translate Error:", e);
        if (wails.LogToFile) await wails.LogToFile("Translate ERROR: " + String(e));
        
        clearInterval(window.translateTimer);
        if (pubSpinner) pubSpinner.style.display = 'none';
        if (pubText) {
            pubText.innerText = "❌ Ошибка перевода:\n" + String(e);
            pubText.classList.add('error');
        }
        await new Promise(r => setTimeout(r, 5000));
    } finally {
        clearInterval(window.translateTimer);
        if (pubOverlay) pubOverlay.classList.remove('active');
    }
}


function showTranslateWarning() {
    return new Promise((resolve) => {
        const modal = document.getElementById('translate-warning-modal');
        const okBtn = document.getElementById('warn-translate-ok');
        const cancelBtn = document.getElementById('warn-translate-cancel');
        const check = document.getElementById('warn-translate-check');
        
        if (typeof centerModalOnPrimaryScreen === 'function') {
            centerModalOnPrimaryScreen(modal).then(() => modal.classList.add('active'));
        } else {
            modal.classList.add('active');
        }
        
        const cleanup = () => {
            modal.classList.remove('active');
            okBtn.removeEventListener('click', onOk);
            cancelBtn.removeEventListener('click', onCancel);
        };
        
        const onOk = async () => {
            if (check.checked) {
                let cfg = await wails.GetConfig();
                cfg.warnOnTranslate = false;
                await wails.SaveConfig(cfg);
            }
            cleanup();
            resolve(true);
        };
        
        const onCancel = () => {
            cleanup();
            resolve(false);
        };
        
        okBtn.addEventListener('click', onOk);
        cancelBtn.addEventListener('click', onCancel);
    });
}


function drawWordPlate(plate, fabricCanvas) {
    const pW = plate.x1 - plate.x0;
    const pH = plate.y1 - plate.y0;
    const wordRect = new fabric.Rect({
        left: plate.x0 - 2,
        top: plate.y0 - 2,
        width: pW + 4,
        height: pH + 4,
        fill: '#ffffff',
        originX: 'left',
        originY: 'top',
        selectable: false,
        evented: false
    });
    fabricCanvas.add(wordRect);
}