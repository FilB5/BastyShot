package main

import (
    "context"
    "fmt"
    "os"
    "path/filepath"
    "time"

    "github.com/getlantern/systray"
    "github.com/kbinani/screenshot"
    wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"
    "golang.design/x/clipboard"
)

type App struct {
    ctx          context.Context
    savePath     string
    lastFilePath string
    config       Config
    configPath   string
}

var firstLoad = true

func NewApp() *App {
    execPath, _ := os.Executable()
    execDir := filepath.Dir(execPath)
    
    defaultSavePath := filepath.Join(execDir, "Screenshots")
    os.MkdirAll(defaultSavePath, 0755)

    configPath := filepath.Join(execDir, "config.json")
    config := loadConfig(configPath, defaultSavePath)

    return &App{
        savePath:   config.SavePath,
        config:     config,
        configPath: configPath,
    }
}

func (a *App) startup(ctx context.Context) {
    a.ctx = ctx
    clipboard.Init()
    go systray.Run(a.onTrayReady, a.onTrayExit)

    // НОВОЕ: Запускаем фоновый таймер очистки логов
    go a.startLogCleaner()
}

func (a *App) domReady(ctx context.Context) {
    if firstLoad {
        wailsRuntime.WindowHide(a.ctx)
        firstLoad = false
    }
}


// --- УПРАВЛЕНИЕ ОКНАМИ ---

func (a *App) HideWindow() { wailsRuntime.WindowHide(a.ctx) }

func (a *App) ShowPanel() {
    bounds := screenshot.GetDisplayBounds(0)
    x := bounds.Min.X + bounds.Dx() - 260
    y := bounds.Min.Y + bounds.Dy() - 360

    // 1. Задаем размер и позицию ДО показа окна
    wailsRuntime.WindowSetSize(a.ctx, 240, 280)
    wailsRuntime.WindowSetPosition(a.ctx, x, y)
    
    // 2. Показываем окно (оно появится сразу в нужном месте)
    wailsRuntime.WindowShow(a.ctx)
    
    // 3. Дублируем позицию сразу после показа (защита от багов Windows/WebView2)
    wailsRuntime.WindowSetPosition(a.ctx, x, y)
    wailsRuntime.WindowSetAlwaysOnTop(a.ctx, true)
}

func (a *App) OpenSettings() {
    // НОВОЕ: Обязательно снимаем "поверх всех окон", иначе диалог выбор папки может крашнуть программу
    wailsRuntime.WindowSetAlwaysOnTop(a.ctx, false)

    wailsRuntime.WindowSetSize(a.ctx, 750, 550)
    wailsRuntime.WindowCenter(a.ctx)
    wailsRuntime.WindowShow(a.ctx)
}

func (a *App) CloseSettings() { wailsRuntime.WindowHide(a.ctx) }

func (a *App) CloseOverlay() {
    wailsRuntime.WindowSetAlwaysOnTop(a.ctx, false)
    wailsRuntime.WindowSetSize(a.ctx, 240, 280)
    wailsRuntime.WindowHide(a.ctx)
}

// Превращает окно в маленький тост (уведомление) на главном мониторе
func (a *App) ShowPublishToast() {
    wailsRuntime.WindowSetAlwaysOnTop(a.ctx, true)
    
    // НОВОЕ: Сначала прячем окно, чтобы Windows не глючил при смене размера
    wailsRuntime.WindowHide(a.ctx)
    
    // Берем границы главного монитора (индекс 0)
    bounds := screenshot.GetDisplayBounds(0)
    x := bounds.Min.X + bounds.Dx() - 320
    y := bounds.Min.Y + bounds.Dy() - 280
    
    // Устанавливаем позицию и размер, пока окно скрыто
    wailsRuntime.WindowSetPosition(a.ctx, x, y)
    wailsRuntime.WindowSetSize(a.ctx, 300, 200)
    
    // Показываем окно уже в нужном месте и нужного размера
    wailsRuntime.WindowShow(a.ctx)
}

// Возвращает окно в стандартный режим и прячет в трей
func (a *App) HidePublishToast() {
    wailsRuntime.WindowSetAlwaysOnTop(a.ctx, false)
    wailsRuntime.WindowSetSize(a.ctx, 240, 280)
    wailsRuntime.WindowHide(a.ctx)
}

// Открытие большого окна истории
func (a *App) OpenHistoryWindow() {
    wailsRuntime.WindowSetAlwaysOnTop(a.ctx, false) // НОВОЕ
    wailsRuntime.WindowSetSize(a.ctx, 900, 600)
    wailsRuntime.WindowCenter(a.ctx)
    wailsRuntime.WindowShow(a.ctx)
}

// Закрытие окна истории и сворачивание в трей
func (a *App) CloseHistoryWindow() {
    wailsRuntime.WindowSetSize(a.ctx, 240, 280)
    wailsRuntime.WindowHide(a.ctx)
}

func (a *App) GetLastFilePath() string { return a.lastFilePath }

// --- ЛОГИРОВАНИЕ ---

// LogToFile записывает сообщение из фронтенда в файл логов
func (a *App) LogToFile(message string) {
    logPath := filepath.Join(filepath.Dir(a.configPath), "bastyshot.log")
    f, err := os.OpenFile(logPath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
    if err != nil {
        return
    }
    defer f.Close()
    
    timestamp := time.Now().Format("2006-01-02 15:04:05")
    logEntry := fmt.Sprintf("[%s] %s\n", timestamp, message)
    f.WriteString(logEntry)
}

// НОВАЯ ФУНКЦИЯ: Фоновая очистка логов
func (a *App) startLogCleaner() {
    // Проверяем каждые 10 минут
    ticker := time.NewTicker(10 * time.Minute)
    defer ticker.Stop()

    for range ticker.C {
        // Если настройка 0 или меньше — функция отключена
        if a.config.LogCleanupHours <= 0 {
            continue
        }

        now := time.Now().Unix()
        // Переводим часы в секунды
        intervalSeconds := int64(a.config.LogCleanupHours) * 3600

        // Если прошло достаточно времени
        if now - a.config.LastLogCleanup > intervalSeconds {
            logPath := filepath.Join(filepath.Dir(a.configPath), "bastyshot.log")
            
            // Очищаем файл (открываем с флагом O_TRUNC)
            f, err := os.OpenFile(logPath, os.O_TRUNC|os.O_CREATE|os.O_WRONLY, 0644)
            if err == nil {
                f.WriteString(fmt.Sprintf("[%s] Логи автоматически очищены (таймер: %d ч.)\n", time.Now().Format("2006-01-02 15:04:05"), a.config.LogCleanupHours))
                f.Close()
            }

            // Обновляем время последней очистки
            a.config.LastLogCleanup = now
            a.SaveConfig(a.config)
        }
    }
}