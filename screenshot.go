package main

import (
    "bytes"
    "encoding/base64"
    "fmt"
    "image"
    "image/png"
    "os"
    "path/filepath"
    "strings" // ДОБАВЛЕН ИМПОРТ strings
    "time"

    "github.com/kbinani/screenshot"
    wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"
    "golang.design/x/clipboard"
)

func getCombinedBounds() image.Rectangle {
    n := screenshot.NumActiveDisplays()
    if n == 0 {
        return image.Rect(0, 0, 0, 0)
    }
    bounds := screenshot.GetDisplayBounds(0)
    for i := 1; i < n; i++ {
        b := screenshot.GetDisplayBounds(i)
        minX := bounds.Min.X
        if b.Min.X < minX {
            minX = b.Min.X
        }
        minY := bounds.Min.Y
        if b.Min.Y < minY {
            minY = b.Min.Y
        }
        maxX := bounds.Max.X
        if b.Max.X > maxX {
            maxX = b.Max.X
        }
        maxY := bounds.Max.Y
        if b.Max.Y > maxY {
            maxY = b.Max.Y
        }
        bounds = image.Rect(minX, minY, maxX, maxY)
    }
    return bounds
}

func (a *App) CaptureScreen() (string, error) {
    wailsRuntime.WindowHide(a.ctx)
    time.Sleep(500 * time.Millisecond) // Увеличили задержку, чтобы меню трея успело скрыться

    var bounds image.Rectangle

    // Если выбрано -1, захватываем все мониторы (старое поведение)
    if a.config.MonitorIndex < 0 {
        bounds = getCombinedBounds()
    } else {
        // Иначе захватываем конкретный монитор
        n := screenshot.NumActiveDisplays()
        if a.config.MonitorIndex >= n {
            bounds = screenshot.GetDisplayBounds(0)
        } else {
            bounds = screenshot.GetDisplayBounds(a.config.MonitorIndex)
        }
    }

    img, err := screenshot.CaptureRect(bounds)
    if err != nil {
        return "", err
    }

    buf := encodePNG(img)
    imgBase64 := base64.StdEncoding.EncodeToString(buf)

    wailsRuntime.WindowSetSize(a.ctx, bounds.Dx(), bounds.Dy())
    wailsRuntime.WindowSetPosition(a.ctx, bounds.Min.X, bounds.Min.Y)
    wailsRuntime.WindowShow(a.ctx)
    wailsRuntime.WindowSetAlwaysOnTop(a.ctx, true)

    return "data:image/png;base64," + imgBase64, nil
}

func (a *App) DoFullScreenshot() (string, error) {
    wailsRuntime.WindowHide(a.ctx)
    time.Sleep(500 * time.Millisecond)

    bounds := getCombinedBounds()
    img, err := screenshot.CaptureRect(bounds)
    if err != nil {
        return "", err
    }

    timestamp := time.Now().Format("2006-01-02_15-04-05")
    filename := fmt.Sprintf("screen_full_%s.png", timestamp)
    fullPath := filepath.Join(a.savePath, filename)

    f, _ := os.Create(fullPath)
    defer f.Close()
    png.Encode(f, img)

    a.lastFilePath = fullPath
    return filename, nil
}

// НОВАЯ ВСПОМОГАТЕЛЬНАЯ ФУНКЦИЯ: Безопасно удаляет Data URI prefix
func stripBase64Prefix(base64Data string) string {
    // Ищем запятую, которая отделяет заголовок (data:image/png;base64) от самих данных
    if idx := strings.Index(base64Data, ","); idx != -1 {
        return base64Data[idx+1:]
    }
    // Если запятой нет, возвращаем как есть (на случай, если прилетят чистые данные)
    return base64Data
}

func (a *App) SaveCroppedImage(base64Data string, thumbBase64 string) (string, error) {
    data := strings.TrimPrefix(base64Data, "data:image/png;base64,")
    data = strings.TrimPrefix(data, "data:image/jpeg;base64,")
    data = strings.TrimPrefix(data, "data:image/webp;base64,")

    imgBytes, err := base64.StdEncoding.DecodeString(data)
    if err != nil {
        return "", err
    }

    timestamp := time.Now().Format("2006-01-02_15-04-05")
    filename := fmt.Sprintf("screen_frag_%s.png", timestamp)
    fullPath := filepath.Join(a.savePath, filename)

    err = os.WriteFile(fullPath, imgBytes, 0644)
    if err != nil {
        return "", err
    }

    // НОВОЕ: Сохраняем миниатюру, если она передана
    if thumbBase64 != "" {
        thumbData := strings.TrimPrefix(thumbBase64, "data:image/jpeg;base64,")
        thumbBytes, err := base64.StdEncoding.DecodeString(thumbData)
        if err == nil {
            // НОВОЕ: Формат screen_frag_123_thumb.jpg
            baseName := strings.TrimSuffix(filename, ".png")
            thumbFilename := baseName + "_thumb.jpg"
            thumbPath := filepath.Join(a.savePath, thumbFilename)
            os.WriteFile(thumbPath, thumbBytes, 0644)
        }
    }

    a.lastFilePath = fullPath
    return filename, nil
}

func (a *App) CopyImageToClipboard(base64Data string) error {
    // ИСПОЛЬЗУЕМ БЕЗОПАСНОЕ УДАЛЕНИЕ ПРЕФИКСА
    data := stripBase64Prefix(base64Data)

    imgBytes, err := base64.StdEncoding.DecodeString(data)
    if err != nil {
        return err
    }

    clipboard.Write(a.ctx, clipboard.FmtImage, imgBytes)
    return nil
}

func encodePNG(img *image.RGBA) []byte {
    var buf bytes.Buffer
    png.Encode(&buf, img)
    return buf.Bytes()
}

func (a *App) GetMonitors() []string {
    n := screenshot.NumActiveDisplays()
    monitors := []string{"Все мониторы"}
    for i := 0; i < n; i++ {
        monitors = append(monitors, fmt.Sprintf("Монитор %d", i+1))
    }
    return monitors
}