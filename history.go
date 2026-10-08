package main

import (
    "crypto/sha256"
    "encoding/hex"
    "encoding/json"
    "image"
    "image/jpeg"
    "image/png"
    "os"
    "path/filepath"
    "strings"
    "time"

    "golang.org/x/image/draw"
)

// LocalScreenshot описывает один локальный файл
type LocalScreenshot struct {
    Name string `json:"name"`
    Date string `json:"date"`
}

// IPFSRecord описывает одну сохраненную ссылку
type IPFSRecord struct {
    ID        string `json:"id"`
    Link      string `json:"link"`
    Date      string `json:"date"`
    LocalPath string `json:"localPath"`
    Thumbnail string `json:"thumbnail"` // НОВОЕ ПОЛЕ
    Mode      string `json:"mode"` // НОВОЕ: "direct", "encrypted", "password"
}


// GetLocalScreenshots возвращает список локальных PNG файлов с датами и авто-генерирует миниатюры
func (a *App) GetLocalScreenshots() ([]LocalScreenshot, error) {
    files, err := os.ReadDir(a.savePath)
    if err != nil {
        return nil, err
    }

    var screenshots []LocalScreenshot
    var thumbFiles = make(map[string]bool)

    // 1. Собираем все существующие миниатюры (заканчиваются на _thumb.jpg)
    for _, f := range files {
        if strings.HasSuffix(f.Name(), "_thumb.jpg") {
            thumbFiles[f.Name()] = true
        }
    }

    // 2. Обрабатываем оригиналы
    for _, f := range files {
        // Пропускаем миниатюры
        if strings.HasSuffix(f.Name(), "_thumb.jpg") {
            continue
        }
        // Берем только PNG
        if !strings.HasSuffix(strings.ToLower(f.Name()), ".png") {
            continue
        }

        // Формируем имя миниатюры: оригинал.png -> оригинал_thumb.jpg
        baseName := strings.TrimSuffix(f.Name(), ".png")
        thumbName := baseName + "_thumb.jpg"

        // Если миниатюры нет, генерируем
        if !thumbFiles[thumbName] {
            srcPath := filepath.Join(a.savePath, f.Name())
            dstPath := filepath.Join(a.savePath, thumbName)
            generateThumbnail(srcPath, dstPath)
        }

        info, _ := f.Info()
        screenshots = append(screenshots, LocalScreenshot{
            Name: f.Name(),
            Date: info.ModTime().Format("2006-01-02 15:04"),
        })
    }

    // 3. Чистим "осиротевшие" миниатюры (если оригинал удален)
    for _, f := range files {
        if strings.HasSuffix(f.Name(), "_thumb.jpg") {
            // Имя оригинала = удалить _thumb.jpg и добавить .png
            origName := strings.TrimSuffix(f.Name(), "_thumb.jpg") + ".png"
            if _, err := os.Stat(filepath.Join(a.savePath, origName)); os.IsNotExist(err) {
                os.Remove(filepath.Join(a.savePath, f.Name()))
            }
        }
    }

    return screenshots, nil
}

// generateThumbnail Генерация миниатюры (ширина 200px, JPEG 50% качества)
func generateThumbnail(srcPath, dstPath string) {
    file, err := os.Open(srcPath)
    if err != nil {
        return
    }
    defer file.Close()

    img, err := png.Decode(file)
    if err != nil {
        return
    }

    bounds := img.Bounds()
    w, h := bounds.Dx(), bounds.Dy()
    
    newW := 200
    newH := int(float64(h) * (200.0 / float64(w)))
    if newH < 1 {
        newH = 1
    }

    dst := image.NewRGBA(image.Rect(0, 0, newW, newH))
    draw.BiLinear.Scale(dst, dst.Bounds(), img, bounds, draw.Over, nil)

    out, err := os.Create(dstPath)
    if err != nil {
        return
    }
    defer out.Close()

    jpeg.Encode(out, dst, &jpeg.Options{Quality: 50})
}



// GetLocalScreenshotPath возвращает полный путь к локальному файлу (для отображения)
func (a *App) GetLocalScreenshotPath(filename string) string {
    return filepath.Join(a.savePath, filename)
}

// DeleteLocalScreenshot удаляет локальный файл
func (a *App) DeleteLocalScreenshot(filename string) error {
    return os.Remove(filepath.Join(a.savePath, filename))
}

// OpenLocalScreenshot открывает локальный файл в системном просмотрщике
func (a *App) OpenLocalScreenshot(filename string) {
    openPath(filepath.Join(a.savePath, filename))
}

// GetIPFSHistory читает историю загрузок из history.json
func (a *App) GetIPFSHistory() ([]IPFSRecord, error) {
    historyPath := filepath.Join(filepath.Dir(a.configPath), "history.json")
    var records []IPFSRecord

    if _, err := os.Stat(historyPath); os.IsNotExist(err) {
        return records, nil
    }

    data, err := os.ReadFile(historyPath)
    if err != nil {
        return nil, err
    }
    json.Unmarshal(data, &records)
    return records, nil
}

// SaveIPFSHistory добавляет новую ссылку в историю
func (a *App) SaveIPFSHistory(link, localPath, thumbnail, mode string) error {
    records, _ := a.GetIPFSHistory()
    
    h := sha256.Sum256([]byte(link))
    id := hex.EncodeToString(h[:8])
    
    // НОВОЕ: Если в настройках отключено сохранение ключа, обрезаем ссылку
    linkToSave := link
    if !a.config.SaveKeyInHistory {
        linkToSave = strings.Split(link, "#")[0] // Оставляем только CID
    }
    
    newRecord := IPFSRecord{
        ID:        id,
        Link:      linkToSave, // НОВОЕ: Сохраняем обрезанную ссылку
        Date:      time.Now().Format("2006-01-02 15:04"),
        LocalPath: localPath,
        Thumbnail: thumbnail,
        Mode:      mode,
    }
    
    // Добавляем в начало списка
    records = append([]IPFSRecord{newRecord}, records...)
    
    historyPath := filepath.Join(filepath.Dir(a.configPath), "history.json")
    data, _ := json.MarshalIndent(records, "", "  ")
    return os.WriteFile(historyPath, data, 0644)
}

// DeleteIPFSHistory удаляет ссылку из истории
func (a *App) DeleteIPFSHistory(id string) error {
    records, _ := a.GetIPFSHistory()
    var updated []IPFSRecord

        for _, r := range records {
            if r.ID != id {
                updated = append(updated, r)
            } else {
                // Удаляем локальный файл-копию, если он был
                if r.LocalPath != "" {
                    os.Remove(r.LocalPath)
                }
                // НОВОЕ: Удаляем файл с серверов Pinata
                a.UnpinFromIPFS(r.Link)
            }
        }

    historyPath := filepath.Join(filepath.Dir(a.configPath), "history.json")
    data, _ := json.MarshalIndent(updated, "", "  ")
    return os.WriteFile(historyPath, data, 0644)
}