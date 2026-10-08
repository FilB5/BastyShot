package main

import (
    "context"
    "fmt"
    "io"
    "net/http"
    "os"
    "path/filepath"
    "time"
)

// progressReader - структура для отслеживания прогресса скачивания
type progressReader struct {
    reader      io.Reader
    total       int64
    current     int64
    logFunc     func(string)
    lastLogTime time.Time
}

// Read перехватывает чтение данных и логирует прогресс
func (pr *progressReader) Read(p []byte) (int, error) {
    n, err := pr.reader.Read(p)
    if n > 0 {
        pr.current += int64(n)
        
        // Уменьшили порог до 3 секунд для наглядности
        if time.Since(pr.lastLogTime) > 3*time.Second || pr.current == pr.total {
            if pr.total > 0 {
                percent := float64(pr.current) / float64(pr.total) * 100
                pr.logFunc(fmt.Sprintf("OCR: Прогресс скачивания - %.2f%% (%d из %d байт)", percent, pr.current, pr.total))
            } else {
                pr.logFunc(fmt.Sprintf("OCR: Прогресс скачивания - %d байт (размер неизвестен)", pr.current))
            }
            pr.lastLogTime = time.Now()
        }
    }
    return n, err
}




// DeleteTessData удаляет папку со словарями (нужно при смене модели)
func (a *App) DeleteTessData() error {
    tessDir := filepath.Join(filepath.Dir(a.configPath), "tessdata")
    os.RemoveAll(tessDir)
    a.LogToFile("OCR: Папка tessdata очищена пользователем.")
    return nil
}

// EnsureTessDataExists проверяет модель и скачивает нужные словари
func (a *App) EnsureTessDataExists(lang string) error {
    tessDir := filepath.Join(filepath.Dir(a.configPath), "tessdata")
    os.MkdirAll(tessDir, 0755)

    filePath := filepath.Join(tessDir, lang+".traineddata.gz")
    
    // Если файл уже существует, ничего не скачиваем
    if _, err := os.Stat(filePath); err == nil {
        return nil
    }

    // Определяем, какую модель качать
    model := a.config.OcrModel
    if model == "" { model = "fast" }
    
    a.LogToFile("OCR: Скачивание словаря " + lang + " (Модель: " + model + ") в папку программы...")
    
    var url string
    if model == "best" {
        url = fmt.Sprintf("https://tessdata.projectnaptha.com/4.0.0_best/%s.traineddata.gz", lang)
    } else {
        url = fmt.Sprintf("https://tessdata.projectnaptha.com/4.0.0/%s.traineddata.gz", lang)
    }
    
    // ... дальше код функции остается точно таким же (контекст, User-Agent, скачивание) ...
    
    // Создаем контекст с таймаутом 60 секунд, чтобы программа не висела вечно
    ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
    defer cancel()

    req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
    if err != nil {
        a.LogToFile("OCR: Ошибка создания запроса - " + err.Error())
        return err
    }
    
    // Добавляем User-Agent, чтобы GitHub не блокировал нас
    req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")

    client := a.getHTTPClient(60 * time.Second)
    resp, err := client.Do(req)
    if err != nil {
        a.LogToFile("OCR: Ошибка сети при скачивании словаря: " + err.Error())
        return err
    }
    defer resp.Body.Close()

    if resp.StatusCode != 200 {
        errStr := fmt.Sprintf("ошибка сервера Tesseract: статус %d", resp.StatusCode)
        a.LogToFile("OCR: " + errStr)
        return fmt.Errorf(errStr)
    }

    // Создаем файл
    out, err := os.Create(filePath)
    if err != nil {
        a.LogToFile("OCR: Ошибка создания файла на диске: " + err.Error())
        return err
    }
    defer out.Close()

    // Оборачиваем поток чтения в наш счетчик прогресса
    pr := &progressReader{
        reader:      resp.Body,
        total:       resp.ContentLength,
        logFunc:     a.LogToFile,
        lastLogTime: time.Now(),
    }

    // Копируем данные из интернета в файл (с отслеживанием прогресса)
    _, err = io.Copy(out, pr)
    if err != nil {
        a.LogToFile("OCR: Ошибка при копировании данных в файл: " + err.Error())
        return err
    }
    
    a.LogToFile(fmt.Sprintf("OCR: Словарь %s успешно скачан (%d байт).", lang, pr.total))
    return nil
}