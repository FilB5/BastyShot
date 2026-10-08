package main

import (
    "bytes"
    "context"
    "crypto/aes"
    "crypto/cipher"
    "crypto/rand"
    "crypto/sha256"
    "encoding/base64"
    "encoding/hex"
    "encoding/json"
    "fmt"
    "io"
    "mime/multipart"
    "net"
    "net/http"
    "net/url"
    "os"
    "path/filepath"
    "strings"
    "time"

    wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"
    "golang.org/x/crypto/pbkdf2"
    "golang.org/x/net/proxy"
)

// НОВОЕ: Структура для управления отменой загрузки
var ipfsCancel context.CancelFunc = nil



// buildTransport создает настроенный транспорт для HTTP/SOCKS5 прокси
func buildTransport(useProxy bool, proxyType, host, port, user, pass string) *http.Transport {
    transport := &http.Transport{}
    if !useProxy || host == "" || port == "" {
        return transport
    }

    if proxyType == "socks5" {
        var auth *proxy.Auth
        if user != "" {
            auth = &proxy.Auth{User: user, Password: pass}
        }
        dialer, err := proxy.SOCKS5("tcp", fmt.Sprintf("%s:%s", host, port), auth, proxy.Direct)
        if err == nil {
            if contextDialer, ok := dialer.(proxy.ContextDialer); ok {
                transport.DialContext = contextDialer.DialContext
            } else {
                transport.DialContext = func(ctx context.Context, network, addr string) (net.Conn, error) {
                    return dialer.Dial(network, addr)
                }
            }
        }
    } else {
        proxyUrlStr := fmt.Sprintf("http://%s:%s", host, port)
        if user != "" {
            proxyUrlStr = fmt.Sprintf("http://%s:%s@%s:%s", user, pass, host, port)
        }
        proxyUrl, err := url.Parse(proxyUrlStr)
        if err == nil {
            transport.Proxy = http.ProxyURL(proxyUrl)
        }
    }

    return transport
}

// PublishToIPFS шифрует скриншот (или грузит сырым) и отправляет в Pinata
func (a *App) PublishToIPFS(base64Data string, password string, useShortLink bool, isDirectLink bool, thumbnail string) (string, error) {
    a.LogToFile("IPFS: Шаг 1 - Очистка base64")
    data := strings.Replace(base64Data, "data:image/png;base64,", "", 1)
    imgBytes, err := base64.StdEncoding.DecodeString(data)
    if err != nil {
        return "", err
    }

    // Сохранение локальной копии
    var localCopyPath string = ""
    if a.config.LocalCopy {
        timestamp := time.Now().Format("2006-01-02_15-04-05")
        filename := fmt.Sprintf("screen_ipfs_%s.png", timestamp)
        localCopyPath = filepath.Join(a.config.SavePath, filename)
        if writeErr := os.WriteFile(localCopyPath, imgBytes, 0644); writeErr == nil {
            a.LogToFile("IPFS: Локальная копия сохранена: " + localCopyPath)
        } else {
            localCopyPath = ""
        }
    }

    // НОВОЕ: Определяем режим для истории
    mode := "encrypted"
    if isDirectLink {
        mode = "direct"
    } else if password != "" {
        mode = "password"
    }

    // --- РЕЖИМ ПРЯМОЙ ССЫЛКИ (БЕЗ ШИФРОВАНИЯ) ---
    if isDirectLink {
        a.LogToFile("IPFS: Режим прямой ссылки - загрузка сырого PNG")
        wailsRuntime.EventsEmit(a.ctx, "ipfs:status", "⬆️ Загрузка в IPFS...")

        transport := buildTransport(a.config.UseProxy, a.config.ProxyType, a.config.ProxyHost, a.config.ProxyPort, a.config.ProxyUser, a.config.ProxyPass)
        body := &bytes.Buffer{}
        writer := multipart.NewWriter(body)
        
        fileName := generateRandomName()
        part, err := writer.CreateFormFile("file", fileName)
        if err != nil {
            return "", err
        }
        _, err = part.Write(imgBytes)
        if err != nil {
            return "", err
        }
        writer.Close()

        ctx, cancel := context.WithCancel(context.Background())
        ipfsCancel = cancel
        defer func() { ipfsCancel = nil }()

        req, _ := http.NewRequestWithContext(ctx, "POST", "https://api.pinata.cloud/pinning/pinFileToIPFS", body)
        req.Header.Set("Content-Type", writer.FormDataContentType())

        jwt := a.config.PinataJWT
        if jwt == "" {
            return "", fmt.Errorf("API ключ Pinata не указан в настройках")
        }
        req.Header.Set("Authorization", "Bearer "+jwt)

        client := &http.Client{Transport: transport, Timeout: 60 * time.Second}
        resp, err := client.Do(req)
        if err != nil {
            a.LogToFile("IPFS: Ошибка/Таймаут HTTP запроса - " + err.Error())
            if ctx.Err() == context.Canceled {
                return "", fmt.Errorf("Загрузка отменена пользователем")
            }
            return "", fmt.Errorf("Ошибка сети. Проверьте VPN или Прокси.")
        }
        defer resp.Body.Close()

        if resp.StatusCode != 200 {
            respBody, _ := io.ReadAll(resp.Body)
            return "", fmt.Errorf("Ошибка Pinata: %s", string(respBody))
        }

        var resultDirect map[string]interface{}
        json.NewDecoder(resp.Body).Decode(&resultDirect)
        cidDirect, ok := resultDirect["IpfsHash"].(string)
        if !ok {
            return "", fmt.Errorf("failed to parse Pinata response")
        }

        gateway := a.config.IPFSGateway
        if gateway == "" {
            gateway = "https://dweb.link/ipfs/"
        }
        gateway = strings.TrimRight(gateway, "/") + "/"

        urlDirect := fmt.Sprintf("%s%s?filename=%s", gateway, cidDirect, fileName)
        a.LogToFile("IPFS: Прямая ссылка сгенерирована: " + urlDirect)
        a.SaveIPFSHistory(urlDirect, localCopyPath, thumbnail, mode)
        return urlDirect, nil
    }
    // --- КОНЕЦ БЛОКА ПРЯМОЙ ССЫЛКИ ---

    wailsRuntime.EventsEmit(a.ctx, "ipfs:status", "🔒 Метаданные удалены")
    time.Sleep(500 * time.Millisecond)

    a.LogToFile("IPFS: Шаг 2 - Генерация ключей")
    key := make([]byte, 32)
    if _, err := rand.Read(key); err != nil {
        return "", err
    }
    nonce := make([]byte, 12)
    if _, err := rand.Read(nonce); err != nil {
        return "", err
    }

    isShort := "false"
    saltB64 := ""
    if password != "" && useShortLink {
        a.LogToFile("IPFS: Режим короткой ссылки - вывод ключа из пароля (PBKDF2)")
        isShort = "true"
        salt := make([]byte, 16)
        rand.Read(salt)
        saltB64 = base64.StdEncoding.EncodeToString(salt)
        key = pbkdf2.Key([]byte(password), salt, 100000, 32, sha256.New)
    }

    wailsRuntime.EventsEmit(a.ctx, "ipfs:status", "⏳ Шифрование данных...")
    time.Sleep(500 * time.Millisecond)

    a.LogToFile("IPFS: Шаг 3 - Шифрование данных")
    block, err := aes.NewCipher(key)
    if err != nil {
        return "", err
    }
    gcm, err := cipher.NewGCM(block)
    if err != nil {
        return "", err
    }
    ciphertext := gcm.Seal(nil, nonce, imgBytes, nil)

    imgNonceB64 := base64.StdEncoding.EncodeToString(nonce)
    imgCtB64 := base64.StdEncoding.EncodeToString(ciphertext)

    // Формируем суффикс ссылки с ключом
    urlSuffix := ""
    isPwd := "false"
    pwdHash := ""
    isHybrid := "false"
    keyNonceB64 := ""

    if password != "" {
        // НОВОЕ: Режим Key Wrapping (Двойная защита)
        isHybrid = "true"
        
        // 1. Генерируем соль для пароля
        salt := make([]byte, 16)
        rand.Read(salt)
        saltB64 = base64.StdEncoding.EncodeToString(salt)
        
        // 2. Делаем ключ из пароля (PBKDF2)
        pwdKey := pbkdf2.Key([]byte(password), salt, 100000, 32, sha256.New)
        
        // 3. Шифруем случайный ключ картинки ключом от пароля
        keyBlock, errKey := aes.NewCipher(pwdKey)
        if errKey != nil {
            return "", errKey
        }
        keyGcm, errGcm := cipher.NewGCM(keyBlock)
        if errGcm != nil {
            return "", errGcm
        }
        keyNonce := make([]byte, 12)
        rand.Read(keyNonce)
        encryptedImgKey := keyGcm.Seal(nil, keyNonce, key, nil)
        
        // 4. Кладем зашифрованный ключ в ссылку
        keyNonceB64 = base64.StdEncoding.EncodeToString(keyNonce)
        encKeyB64 := base64.URLEncoding.EncodeToString(encryptedImgKey)
        urlSuffix = "#" + encKeyB64
        
    } else if password == "" {
        // Без пароля: ключ в ссылке, страница открывается сразу
        keyB64 := base64.URLEncoding.EncodeToString(key)
        urlSuffix = "#" + keyB64
    }

    a.LogToFile("IPFS: Шаг 4 - Формирование HTML")
    htmlTemplate := `<!DOCTYPE html>
<html>
<head>
    <title>BastyShot</title>
    <meta charset="UTF-8">
    <style>
        body { margin:0; padding:0; background:#0f172a; color:#fff; display:flex; justify-content:center; align-items:center; height:100vh; flex-direction:column; font-family: sans-serif; overflow: hidden; }
        img { max-width: 100%; max-height: 100vh; display: none; }
        .loader { color: #94a3b8; font-size: 14px; }
        .pwd-box { text-align: center; background: #1e293b; padding: 40px; border-radius: 12px; box-shadow: 0 4px 15px rgba(0,0,0,0.3); display: none; }
        input { padding: 10px; border-radius: 6px; border: 1px solid #475569; background: #0f172a; color: #fff; margin-right: 5px; width: 200px; font-size: 16px;}
        button { padding: 10px 15px; border-radius: 6px; border: none; background: #2563eb; color: #fff; cursor: pointer; font-size: 16px; font-weight: 600;}
        button:hover { background: #1d4ed8; }
        .error { color: #ef4444; margin-top: 15px; display: none; }
        h3 { margin-bottom: 20px; color: #f8fafc; }
    </style>
</head>
<body>
    <img id="img" />
    <div id="loader" class="loader">Decrypting...</div>
    
    <div id="pwd-box" class="pwd-box">
        <h3>Введите пароль для просмотра</h3>
        <div style="display:flex;">
            <input type="password" id="pwd-input" placeholder="Пароль" autofocus>
            <button id="pwd-btn">Открыть</button>
        </div>
        <div id="pwd-error" class="error">Неверный пароль</div>
    </div>

    <script>
    const IMG_NONCE = "{{IMG_NONCE}}";
    const IMG_CT = "{{IMG_CT}}";
    const IS_PWD = {{IS_PWD}};
    const PWD_HASH = "{{PWD_HASH}}";
    const IS_SHORT = {{IS_SHORT}};
    const SALT = "{{SALT}}";
    const IS_HYBRID = {{IS_HYBRID}};
    const KEY_NONCE = "{{KEY_NONCE}}";

    function b64ToBytes(b64) { return Uint8Array.from(atob(b64), c => c.charCodeAt(0)); }

    async function showImage(imgBytes) {
        const blob = new Blob([imgBytes], {type: 'image/png'});
        document.getElementById('img').src = URL.createObjectURL(blob);
        document.getElementById('img').style.display = 'block';
        document.getElementById('loader').style.display = 'none';
        document.getElementById('pwd-box').style.display = 'none';
    }

    async function decryptWithKey(keyBytes) {
        const ck = await crypto.subtle.importKey('raw', keyBytes, {name:'AES-GCM'}, false, ['decrypt']);
        return await crypto.subtle.decrypt({name:'AES-GCM', iv: b64ToBytes(IMG_NONCE)}, ck, b64ToBytes(IMG_CT));
    }

    async function decryptDirect() {
        try {
            const keyHash = window.location.hash.substring(1);
            if(!keyHash) throw new Error("No key");
            let base64 = keyHash.replace(/-/g, '+').replace(/_/g, '/');
            while (base64.length % 4) base64 += '=';
            const imgBytes = await decryptWithKey(b64ToBytes(base64));
            await showImage(imgBytes);
        } catch(e) {
            document.getElementById('loader').innerText = "Decryption failed";
        }
    }

    async function verifyAndDecrypt() {
        const pwd = document.getElementById('pwd-input').value;
        const enc = new TextEncoder();
        
        try {
            if (IS_HYBRID) {
                // НОВОЕ: Двойная защита. Сначала выводим ключ из пароля, 
                // потом расшифровываем ключ картинки из ссылки, потом расшифровываем саму картинку
                const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(pwd), {name:'PBKDF2'}, false, ['deriveKey']);
                const passKey = await crypto.subtle.deriveKey(
                    {name:'PBKDF2', salt: b64ToBytes(SALT), iterations: 100000, hash:'SHA-256'},
                    keyMaterial, {name:'AES-GCM', length: 256}, false, ['decrypt']
                );
                
                // Берем зашифрованный ключ из ссылки (#)
                const encKeyHash = window.location.hash.substring(1);
                if(!encKeyHash) throw new Error("No key in link");
                let encBase64 = encKeyHash.replace(/-/g, '+').replace(/_/g, '/');
                while (encBase64.length % 4) encBase64 += '=';
                
                // Расшифровываем ключ картинки
                const decryptedImgKey = await crypto.subtle.decrypt(
                    {name:'AES-GCM', iv: b64ToBytes(KEY_NONCE)}, 
                    passKey, 
                    b64ToBytes(encBase64)
                );
                
                // Расшифровываем саму картинку
                const imgBytes = await decryptWithKey(decryptedImgKey);
                await showImage(imgBytes);
                
            } else if (IS_SHORT) {
                const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(pwd), {name:'PBKDF2'}, false, ['deriveKey']);
                const passKey = await crypto.subtle.deriveKey(
                    {name:'PBKDF2', salt: b64ToBytes(SALT), iterations: 100000, hash:'SHA-256'},
                    keyMaterial, {name:'AES-GCM', length: 256}, false, ['decrypt']
                );
                const imgBytes = await crypto.subtle.decrypt({name:'AES-GCM', iv: b64ToBytes(IMG_NONCE)}, passKey, b64ToBytes(IMG_CT));
                await showImage(imgBytes);
            } else if (IS_PWD) {
                const hashBuffer = await crypto.subtle.digest('SHA-256', enc.encode(pwd));
                const hashHex = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
                if (hashHex !== PWD_HASH) {
                    document.getElementById('pwd-error').style.display = 'block';
                    return;
                }
                await decryptDirect();
            }
        } catch(e) {
            document.getElementById('pwd-error').style.display = 'block';
        }
    }

    window.onload = () => {
        if (IS_PWD || IS_SHORT || IS_HYBRID) {
            document.getElementById('loader').style.display = 'none';
            document.getElementById('pwd-box').style.display = 'block';
            document.getElementById('pwd-btn').onclick = verifyAndDecrypt;
            document.getElementById('pwd-input').addEventListener('keypress', (e) => {
                if (e.key === 'Enter') verifyAndDecrypt();
            });
        } else {
            decryptDirect();
        }
    };
    </script>
</body>
</html>`

    htmlString := strings.Replace(htmlTemplate, "{{IMG_NONCE}}", imgNonceB64, 1)
    htmlString = strings.Replace(htmlString, "{{IMG_CT}}", imgCtB64, 1)
    htmlString = strings.Replace(htmlString, "{{IS_PWD}}", isPwd, 1)
    htmlString = strings.Replace(htmlString, "{{PWD_HASH}}", pwdHash, 1)
    htmlString = strings.Replace(htmlString, "{{IS_SHORT}}", isShort, 1)
    htmlString = strings.Replace(htmlString, "{{SALT}}", saltB64, 1)

    htmlString = strings.Replace(htmlString, "{{IS_HYBRID}}", isHybrid, 1)
    htmlString = strings.Replace(htmlString, "{{KEY_NONCE}}", keyNonceB64, 1)

    wailsRuntime.EventsEmit(a.ctx, "ipfs:status", "⬆️ Загрузка в IPFS...")
    a.LogToFile("IPFS: Шаг 5 - Отправка запроса в Pinata")

    transport := buildTransport(a.config.UseProxy, a.config.ProxyType, a.config.ProxyHost, a.config.ProxyPort, a.config.ProxyUser, a.config.ProxyPass)

    body := &bytes.Buffer{}
    writer := multipart.NewWriter(body)
    htmlFileName := generateRandomHTMLName()
    part, err := writer.CreateFormFile("file", htmlFileName)
    if err != nil {
        return "", err
    }
    _, err = part.Write([]byte(htmlString))
    if err != nil {
        return "", err
    }
    writer.Close()

    ctx, cancel := context.WithCancel(context.Background())
    ipfsCancel = cancel
    defer func() { ipfsCancel = nil }()

    req, _ := http.NewRequestWithContext(ctx, "POST", "https://api.pinata.cloud/pinning/pinFileToIPFS", body)
    req.Header.Set("Content-Type", writer.FormDataContentType())

    jwt := a.config.PinataJWT
    if jwt == "" {
        return "", fmt.Errorf("API ключ Pinata не указан в настройках")
    }
    req.Header.Set("Authorization", "Bearer "+jwt)

    client := &http.Client{Transport: transport, Timeout: 60 * time.Second}
    resp, err := client.Do(req)
    if err != nil {
        a.LogToFile("IPFS: Ошибка/Таймаут HTTP запроса - " + err.Error())
        if ctx.Err() == context.Canceled {
            return "", fmt.Errorf("Загрузка отменена пользователем")
        }
        return "", fmt.Errorf("Ошибка сети. Проверьте VPN или Прокси.")
    }
    defer resp.Body.Close()
    a.LogToFile(fmt.Sprintf("IPFS: Pinata ответила статусом %d", resp.StatusCode))

    if resp.StatusCode != 200 {
        respBody, _ := io.ReadAll(resp.Body)
        return "", fmt.Errorf("Ошибка Pinata: %s", string(respBody))
    }

    var result map[string]interface{}
    json.NewDecoder(resp.Body).Decode(&result)
    cid, ok := result["IpfsHash"].(string)
    if !ok {
        return "", fmt.Errorf("failed to parse Pinata response")
    }

    gateway := a.config.IPFSGateway
    if gateway == "" {
        gateway = "https://dweb.link/ipfs/"
    }
    gateway = strings.TrimRight(gateway, "/") + "/"

    url := fmt.Sprintf("%s%s%s", gateway, cid, urlSuffix)
    a.LogToFile("IPFS: Ссылка сгенерирована: " + url)

    a.SaveIPFSHistory(url, localCopyPath, thumbnail, mode)

    return url, nil
}

// TestIPFSConnection проверяет валидность API ключа Pinata
func (a *App) TestIPFSConnection(jwt string) (string, error) {
    transport := buildTransport(a.config.UseProxy, a.config.ProxyType, a.config.ProxyHost, a.config.ProxyPort, a.config.ProxyUser, a.config.ProxyPass)

    req, _ := http.NewRequest("GET", "https://api.pinata.cloud/data/testAuthentication", nil)
    req.Header.Set("Authorization", "Bearer "+jwt)

    client := &http.Client{Transport: transport, Timeout: 10 * time.Second}
    resp, err := client.Do(req)
    if err != nil {
        return "", fmt.Errorf("Сеть недоступна. Проверьте VPN/Прокси.")
    }
    defer resp.Body.Close()

    if resp.StatusCode != 200 {
        return "", fmt.Errorf("Неверный API ключ (статус %d)", resp.StatusCode)
    }

    return "Успешно подключено!", nil
}

// TestProxy проверяет работоспособность прокси
func (a *App) TestProxy(proxyType, host, port, user, pass string) (string, error) {
    if host == "" || port == "" {
        return "", fmt.Errorf("Хост и порт обязательны")
    }

    transport := buildTransport(true, proxyType, host, port, user, pass)
    client := &http.Client{
        Transport: transport,
        Timeout:   10 * time.Second,
    }

    resp, err := client.Get("https://api.pinata.cloud/data/testAuthentication")
    if err != nil {
        return "", fmt.Errorf("Прокси не работает: %v", err)
    }
    defer resp.Body.Close()

    if resp.StatusCode == 200 {
        return "✅ Прокси работает! Pinata доступна.", nil
    }

    return "", fmt.Errorf("Прокси ответил ошибкой (статус %d)", resp.StatusCode)
}

// TestIPFSGateway проверяет доступность выбранного IPFS шлюза
func (a *App) TestIPFSGateway(gatewayURL string) (string, error) {
    transport := buildTransport(a.config.UseProxy, a.config.ProxyType, a.config.ProxyHost, a.config.ProxyPort, a.config.ProxyUser, a.config.ProxyPass)
    client := &http.Client{Transport: transport, Timeout: 15 * time.Second}

    if !strings.HasSuffix(gatewayURL, "/") {
        gatewayURL += "/"
    }

    testURL := gatewayURL + "bafkqaaa"

    req, err := http.NewRequest("GET", testURL, nil)
    if err != nil {
        a.LogToFile("Gateway Test: Ошибка создания запроса - " + err.Error())
        return "", fmt.Errorf("ошибка создания запроса")
    }
    
    req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
    req.Header.Set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8")
    req.Header.Set("Accept-Language", "en-US,en;q=0.5")
    req.Header.Set("Connection", "keep-alive")

    a.LogToFile("Gateway Test: Пингую URL - " + testURL)
    resp, err := client.Do(req)
    if err != nil {
        a.LogToFile("Gateway Test: Ошибка сети - " + err.Error())
        return "", fmt.Errorf("шлюз недоступен. Проверьте VPN или настройки прокси. Ошибка: %v", err)
    }
    defer resp.Body.Close()

    a.LogToFile(fmt.Sprintf("Gateway Test: Получен ответ - статус %d", resp.StatusCode))

    if resp.StatusCode == 200 || resp.StatusCode == 400 || resp.StatusCode == 404 || resp.StatusCode == 405 {
        return "✅ Шлюз работает отлично!", nil
    }

    return "", fmt.Errorf("шлюз вернул ошибку (статус %d)", resp.StatusCode)
}

// generateRandomName генерирует рандомное имя файла для прямых ссылок (например: a1b2c3d4e5f6.png)
func generateRandomName() string {
    b := make([]byte, 6)
    rand.Read(b)
    return hex.EncodeToString(b) + ".png"
}

// generateRandomHTMLName генерирует рандомное имя файла для зашифрованных ссылок (например: a1b2c3d4e5f6.html)
func generateRandomHTMLName() string {
    b := make([]byte, 6)
    rand.Read(b)
    return hex.EncodeToString(b) + ".html"
}

// НОВАЯ ФУНКЦИЯ: Удаление файла с серверов Pinata
// UnpinFromIPFS удаляет файл с серверов Pinata
func (a *App) UnpinFromIPFS(link string) {
    if link == "" { return }
    
    // Извлекаем CID из ссылки вида https://dweb.link/ipfs/Qm...#key
    cid := link
    if idx := strings.Index(cid, "/ipfs/"); idx != -1 {
        cid = cid[idx+6:]
    }
    cid = strings.Split(cid, "/")[0] // Отрезаем имя файла
    cid = strings.Split(cid, "#")[0] // Отрезаем ключ
    cid = strings.Split(cid, "?")[0] // Отрезаем параметры
    
    if cid == "" { return }
    
    a.LogToFile("IPFS: Попытка удаления (unpin) CID: " + cid)
    
    transport := buildTransport(a.config.UseProxy, a.config.ProxyType, a.config.ProxyHost, a.config.ProxyPort, a.config.ProxyUser, a.config.ProxyPass)
    client := &http.Client{Transport: transport, Timeout: 15 * time.Second}
    
    url := "https://api.pinata.cloud/pinning/unpin/" + cid
    req, _ := http.NewRequest("DELETE", url, nil)
    
    jwt := a.config.PinataJWT
    if jwt == "" {
        a.LogToFile("IPFS Unpin Error: Нет JWT ключа")
        return
    }
    req.Header.Set("Authorization", "Bearer "+jwt)
    
    resp, err := client.Do(req)
    if err != nil {
        a.LogToFile("IPFS Unpin Error: " + err.Error())
        return
    }
    defer resp.Body.Close()
    a.LogToFile(fmt.Sprintf("IPFS Unpin: Статус %d", resp.StatusCode))
}


// CheckIPFSLink проверяет, доступен ли файл в сети IPFS (через API Pinata)
func (a *App) CheckIPFSLink(link string) (bool, error) {
    // Извлекаем CID из ссылки
    cid := link
    if idx := strings.Index(cid, "/ipfs/"); idx != -1 {
        cid = cid[idx+6:]
    }
    cid = strings.Split(cid, "/")[0] // Отрезаем имя файла
    cid = strings.Split(cid, "#")[0] // Отрезаем ключ
    cid = strings.Split(cid, "?")[0] // Отрезаем параметры
    
    if cid == "" { return false, fmt.Errorf("CID not found") }
    
    a.LogToFile("IPFS Check: Проверяем наличие через Pinata API: " + cid)
    
    transport := buildTransport(a.config.UseProxy, a.config.ProxyType, a.config.ProxyHost, a.config.ProxyPort, a.config.ProxyUser, a.config.ProxyPass)
    client := &http.Client{Transport: transport, Timeout: 15 * time.Second}
    
    // Запрашиваем у Pinata, есть ли у нас такой пин
    url := "https://api.pinata.cloud/pinning/pinList?status=pinned&hashContains=" + cid
    req, _ := http.NewRequest("GET", url, nil)
    
    jwt := a.config.PinataJWT
    if jwt == "" {
        return false, fmt.Errorf("API ключ Pinata не указан")
    }
    req.Header.Set("Authorization", "Bearer "+jwt)
    
    resp, err := client.Do(req)
    if err != nil {
        a.LogToFile("IPFS Check Error: " + err.Error())
        return false, err
    }
    defer resp.Body.Close()
    
    if resp.StatusCode == 200 {
        var result map[string]interface{}
        json.NewDecoder(resp.Body).Decode(&result)
        count, ok := result["count"].(float64)
        if ok && count > 0 {
            a.LogToFile("IPFS Check: Файл найден на Pinata (доступен).")
            return true, nil
        }
    }
    
    a.LogToFile(fmt.Sprintf("IPFS Check: Файл не найден на Pinata. Статус %d", resp.StatusCode))
    return false, nil
}



// getHTTPClient возвращает HTTP-клиент с настройками прокси (или без них)
func (a *App) getHTTPClient(timeout time.Duration) *http.Client {
    transport := buildTransport(a.config.UseProxy, a.config.ProxyType, a.config.ProxyHost, a.config.ProxyPort, a.config.ProxyUser, a.config.ProxyPass)
    return &http.Client{
        Transport: transport,
        Timeout:   timeout,
    }
}