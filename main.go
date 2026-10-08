package main

import (
    "context"
    "embed"
    "encoding/json" // НОВОЕ
    "fmt"
    "net"
    "net/http"
    "os"
    "path/filepath"
    "strings"
    "time"

    "github.com/wailsapp/wails/v2"
    "github.com/wailsapp/wails/v2/pkg/options"
    "github.com/wailsapp/wails/v2/pkg/options/assetserver"
    wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

//go:embed all:frontend/dist
var assets embed.FS

//go:embed build/windows/icon.ico
var trayIcon []byte

var instanceListener net.Listener
var isQuitting = false // Флаг: истинный выход из программы



// НОВОЕ: Встраиваем wails.json для чтения версии
//go:embed wails.json
var wailsConfig []byte

// НОВОЕ: Глобальная переменная версии
var AppVersion = "1.0.0"

// НОВОЕ: Автоматически парсим версию при запуске
func init() {
    var cfg struct {
        Version string `json:"version"`
    }
    if err := json.Unmarshal(wailsConfig, &cfg); err == nil && cfg.Version != "" {
        AppVersion = cfg.Version
    }
}



func main() {
    // НОВОЕ: Перехватываем любые падения (паники), чтобы писать их в лог перед закрытием
    defer func() {
        if r := recover(); r != nil {
            logPath := filepath.Join(filepath.Dir(os.Args[0]), "bastyshot.log")
            f, _ := os.OpenFile(logPath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
            if f != nil {
                defer f.Close()
                timestamp := time.Now().Format("2006-01-02 15:04:05")
                f.WriteString(fmt.Sprintf("[%s] FATAL ERROR (Crash): %v\n", timestamp, r))
            }
        }
    }()

    // --- ЗАЩИТА ОТ ДВОЙНОГО ЗАПУСКА ---
    l, err := net.Listen("tcp", "127.0.0.1:48321")
    if err != nil {
        println("BastyShot уже запущен!")
        os.Exit(0)
    }
    instanceListener = l
    defer l.Close()
    // ----------------------------------

    app := NewApp()

    err = wails.Run(&options.App{
        Title:         "BastyShot",
        Width:         240,
        Height:        280,
//        DisableResize: true,
        Frameless:     true,
        AssetServer: &assetserver.Options{
            Assets: assets,

            Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
                // Логируем все запросы от Tesseract
                println("Frontend requested:", r.URL.Path)

                if strings.HasPrefix(r.URL.Path, "/tessdata/") {
                    execPath, _ := os.Executable()
                    tessDir := filepath.Join(filepath.Dir(execPath), "tessdata")
                    fileName := filepath.Base(r.URL.Path)
                    filePath := filepath.Join(tessDir, fileName)

                    if _, err := os.Stat(filePath); err == nil {
                        println("-> Отдаем локальный файл словаря:", filePath)
                        http.ServeFile(w, r, filePath)
                        return
                    } else {
                        println("-> Файл словаря не найден на диске:", filePath)
                    }
                }

                // НОВОЕ: Отдаем локальные скриншоты для Галереи
                if strings.HasPrefix(r.URL.Path, "/screenshots/") {
                    fileName := filepath.Base(r.URL.Path)
                    filePath := filepath.Join(app.config.SavePath, fileName)
                    if _, err := os.Stat(filePath); err == nil {
                        http.ServeFile(w, r, filePath)
                        return
                    }
                }

                w.WriteHeader(http.StatusNotFound)
            }),
        },
        // ИСПРАВЛЕНО: Фон окна на 100% прозрачный. Больше никаких серых экранов!
        BackgroundColour: &options.RGBA{R: 255, G: 255, B: 255, A: 255}, // Белый фон
         OnStartup: func(ctx context.Context) {
            wailsRuntime.WindowHide(ctx) // НОВОЕ: Прячем окно сразу при старте
            app.startup(ctx)
            go app.RegisterHotkeys()
        },
        OnDomReady: app.domReady,
        OnBeforeClose: func(ctx context.Context) (prevent bool) {
            if isQuitting {
                return false // Если вышли через трей - разрешаем закрытие
            }
            wailsRuntime.WindowHide(ctx) // Прячем в трей
            return true                   // Запрещаем закрытие процесса
        },
        OnShutdown: func(ctx context.Context) {
            if instanceListener != nil {
                instanceListener.Close()
            }
        },
        Bind: []interface{}{
            app,
        },
    })

    if err != nil {
        println("Error:", err.Error())
    }
}