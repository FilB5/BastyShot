package main

import (
    "encoding/json"
    "fmt"
    "io"
    "net/http"
    "net/url"
    "strings"
    "time"

    wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// TranslateBlock переводит текст, используя Google, затем Lingva, затем MyMemory
func (a *App) TranslateBlock(text string, sourceLang string, targetLang string) ([]string, error) {
    if text == "" {
        return nil, nil
    }

    // 1. Пытаемся использовать Google
    wailsRuntime.EventsEmit(a.ctx, "translate:engine", "Google")
    translations, err := a.translateGoogle(text, sourceLang, targetLang)
    if err == nil {
        return translations, nil
    }

    // 2. Если Google заблокировал, пробуем Lingva
    a.LogToFile("Translate: Google failed, trying Lingva...")
    wailsRuntime.EventsEmit(a.ctx, "translate:engine", "Lingva")
    translations, err = a.translateLingva(text, sourceLang, targetLang)
    if err == nil {
        return translations, nil
    }

    // 3. Если Lingva тоже упал, используем MyMemory
    a.LogToFile("Translate: Lingva failed, falling back to MyMemory...")
    wailsRuntime.EventsEmit(a.ctx, "translate:engine", "MyMemory")
    return a.translateMyMemoryBlock(text, sourceLang, targetLang)
}

// translateGoogle использует неофициальный API Google Translate
func (a *App) translateGoogle(text string, sourceLang string, targetLang string) ([]string, error) {
    // НОВОЕ: Снизили таймаут до 10 секунд
    client := a.getHTTPClient(10 * time.Second) // или 30 * time.Second для MyMemory

    apiUrl := fmt.Sprintf("https://translate.googleapis.com/translate_a/single?client=gtx&sl=%s&tl=%s&dt=t&q=%s",
        sourceLang, targetLang, url.QueryEscape(text))

        req, _ := http.NewRequest("GET", apiUrl, nil)
        // НОВОЕ: Полные заголовки как у настоящего Chrome
        req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        req.Header.Set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8")
        req.Header.Set("Accept-Language", "en-US,en;q=0.5")
        req.Header.Set("Connection", "keep-alive")

    resp, err := client.Do(req)
    if err != nil {
        return nil, fmt.Errorf("сеть: %v", err)
    }
    defer resp.Body.Close()

    bodyBytes, _ := io.ReadAll(resp.Body)

    if resp.StatusCode != 200 {
        return nil, fmt.Errorf("Google API статус %d", resp.StatusCode)
    }

    var result []interface{}
    if err := json.Unmarshal(bodyBytes, &result); err != nil {
        return nil, fmt.Errorf("разбор JSON: %v", err)
    }

    var translations []string
    if len(result) > 0 {
        if innerArray, ok := result[0].([]interface{}); ok {
            for _, item := range innerArray {
                if itemArray, ok := item.([]interface{}); ok && len(itemArray) > 0 {
                    if str, ok := itemArray[0].(string); ok {
                        translations = append(translations, str)
                    }
                }
            }
        }
    }

    if len(translations) == 0 {
        return nil, fmt.Errorf("пустой перевод")
    }

    return translations, nil
}

// translateLingva переводит весь текст через Lingva API (скрапер Google Translate)
func (a *App) translateLingva(text string, sourceLang string, targetLang string) ([]string, error) {
    // Снизили таймаут до 5 секунд (чтобы быстро прыгать на MyMemory если сервер мертв)
    client := a.getHTTPClient(5 * time.Second)

    // Список серверов Lingva
    instances := []string{
        "https://lingva.ml/api/v1",
        "https://translate.plausibility.moe/api/v1",
        "https://lingva.lunar.icu/api/v1",
    }

    var translatedText string
    var lastErr error

    // Пробуем каждый сервер с целым текстом
    for _, instance := range instances {
        apiUrl := fmt.Sprintf("%s/%s/%s/%s", instance, sourceLang, targetLang, url.QueryEscape(text))
        
        req, _ := http.NewRequest("GET", apiUrl, nil)
        req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)")

        resp, err := client.Do(req)
        if err != nil {
            lastErr = err
            continue
        }

        bodyBytes, _ := io.ReadAll(resp.Body)
        resp.Body.Close()

        if resp.StatusCode != 200 {
            lastErr = fmt.Errorf("статус %d", resp.StatusCode)
            continue
        }

        var result struct {
            Translation string `json:"translation"`
        }
        if err := json.Unmarshal(bodyBytes, &result); err != nil {
            lastErr = err
            continue
        }

        translatedText = result.Translation
        lastErr = nil
        break
    }

    if lastErr != nil {
        return nil, fmt.Errorf("Lingva недоступен: %v", lastErr)
    }

    // НОВОЕ: Если Lingva вернул тот же текст (не перевел), считаем это ошибкой
    if strings.TrimSpace(translatedText) == strings.TrimSpace(text) {
        return nil, fmt.Errorf("Lingva вернул текст без перевода")
    }

    // Lingva возвращает один большой текст, разбиваем его по строкам
    return strings.Split(translatedText, "\n"), nil
}


// translateMyMemoryBlock переводит построчно через MyMemory API
func (a *App) translateMyMemoryBlock(text string, sourceLang string, targetLang string) ([]string, error) {
    // НОВОЕ: Таймаут 8 секунд на строку
    client := a.getHTTPClient(8 * time.Second)

    lines := strings.Split(text, "\n")
    var translations []string

    for i, line := range lines {
        line = strings.TrimSpace(line)
        if line == "" {
            translations = append(translations, "")
            continue
        }

        apiUrl := fmt.Sprintf("https://api.mymemory.translated.net/get?q=%s&langpair=%s|%s",
            url.QueryEscape(line), sourceLang, targetLang)

        req, _ := http.NewRequest("GET", apiUrl, nil)
        req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)")

        resp, err := client.Do(req)
        if err != nil {
            // НОВОЕ: Если MyMemory не отвечает на первой строке, сразу возвращаем общую ошибку
            if i == 0 {
                return nil, fmt.Errorf("Все переводчики недоступны (Google, Lingva, MyMemory заблокированы или нет сети)")
            }
            return nil, fmt.Errorf("сеть MyMemory: %v", err)
        }

        bodyBytes, _ := io.ReadAll(resp.Body)
        resp.Body.Close()

        if resp.StatusCode != 200 {
            return nil, fmt.Errorf("MyMemory API статус %d", resp.StatusCode)
        }

        var result struct {
            ResponseData struct {
                TranslatedText string `json:"translatedText"`
            } `json:"responseData"`
        }
        if err := json.Unmarshal(bodyBytes, &result); err != nil {
            return nil, fmt.Errorf("разбор JSON MyMemory: %v", err)
        }

        translations = append(translations, result.ResponseData.TranslatedText)
    }

    // НОВОЕ: Если мы дошли сюда, значит все API упали
    if len(translations) == 0 {
        return nil, fmt.Errorf("Все переводчики недоступны (Google, Lingva, MyMemory)")
    }

    return translations, nil
}

// TranslateText переводит одну строку (оставляем для совместимости)
func (a *App) TranslateText(text string, sourceLang string, targetLang string) (string, error) {
    arr, err := a.TranslateBlock(text, sourceLang, targetLang)
    if err != nil {
        return "", err
    }
    if len(arr) > 0 {
        return arr[0], nil
    }
    return "", nil
}