package main

import (
    "encoding/json"
    "os"
    "os/exec"
    "runtime"
    "strings"
    "time"

    "github.com/ncruces/zenity" // НОВЫЙ ИМПОРТ
    wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

type Config struct {
    SavePath     string `json:"savePath"`
    ImageFormat  string `json:"imageFormat"`
    Hotkey       string `json:"hotkey"`
    HotkeyFull   string `json:"hotkeyFull"`
    Username     string `json:"username"`
    LicenseKey   string `json:"licenseKey"`
    StorageType  string `json:"storageType"`
    Quality      string `json:"quality"`
    MonitorIndex int    `json:"monitorIndex"`
    AutoStart    bool   `json:"autoStart"`
    UseProxy     bool   `json:"useProxy"`
    LocalCopy    bool   `json:"localCopy"`
    ShowUpload   bool   `json:"showUpload"`
    ShowInfo     bool   `json:"showInfo"`
    PinataJWT    string `json:"pinataJWT"`
    IPFSGateway  string `json:"ipfsGateway"`
    ProxyHost    string `json:"proxyHost"`
    ProxyPort    string `json:"proxyPort"`
    ProxyUser    string `json:"proxyUser"`
    ProxyPass    string `json:"proxyPass"`
    ProxyType    string `json:"proxyType"`
    OcrEnabled  bool   `json:"ocrEnabled"`
    OcrModel    string `json:"ocrModel"` // "fast" или "best"
    ToastHideSuccess bool   `json:"toastHideSuccess"`
    ToastHideError   bool   `json:"toastHideError"`
    SaveKeyInHistory bool `json:"saveKeyInHistory"` // НОВОЕ
    WarnOnTranslate bool `json:"warnOnTranslate"` // НОВОЕ

    // НОВЫЕ ПОЛЯ ДЛЯ ЛОГОВ
    LogCleanupHours int   `json:"logCleanupHours"`
    LastLogCleanup  int64 `json:"lastLogCleanup"`
}

type UserAccount struct {
    Address      string `json:"address"`
    IsPro        bool   `json:"isPro"`
    StorageUsed  int64  `json:"storageUsed"`
    StorageLimit int64  `json:"storageLimit"`
    ExpiryDate   string `json:"expiryDate"`
}

func loadConfig(configPath, defaultSavePath string) Config {
    config := Config{
        SavePath:     defaultSavePath,
        ImageFormat:  "png",
        Hotkey:       "Ctrl+Shift+S",
        HotkeyFull:   "Ctrl+Shift+F",
        StorageType:  "local",
        Quality:      "med",
        MonitorIndex: -1,
        LocalCopy:    true,
        ShowUpload:   true,
        ShowInfo:     true,
        PinataJWT:    "",
        IPFSGateway:  "https://dweb.link/ipfs/",
        ProxyHost:    "",
        ProxyPort:    "",
        ProxyUser:    "",
        ProxyPass:    "",
        ProxyType:    "http", // По умолчанию HTTP
        OcrEnabled:  true,
        OcrModel:    "fast",
        ToastHideSuccess: false,
        ToastHideError:   false,
        SaveKeyInHistory: true, // НОВОЕ: По умолчанию сохраняем ключ
        WarnOnTranslate: true, // НОВОЕ: По умолчанию предупреждаем
        // НОВЫЕ ДЕФОЛТЫ
        LogCleanupHours: 0, // 0 означает "никогда не чистить"
        LastLogCleanup:  time.Now().Unix(), // Отсчет с момента установки
    }

    if data, err := os.ReadFile(configPath); err == nil {
        json.Unmarshal(data, &config)
    }

    // НОВОЕ: Если папка не существует (программу перенесли), сбрасываем путь
    if _, err := os.Stat(config.SavePath); os.IsNotExist(err) {
        config.SavePath = defaultSavePath
    }
    
    if config.SavePath == "" {
        config.SavePath = defaultSavePath
    }
    os.MkdirAll(config.SavePath, 0755)
    return config
}

func (a *App) GetConfig() Config {
    return a.config
}

func (a *App) SaveConfig(newConfig Config) error {
    a.config = newConfig
    a.savePath = newConfig.SavePath
    data, _ := json.MarshalIndent(a.config, "", "  ")
    
    // УБРАЛИ СТРОКУ go a.RegisterHotkeys()
    
    return os.WriteFile(a.configPath, data, 0644)
}

// SelectFolder использует стороннюю библиотеку для вызова системного окна
func (a *App) SelectFolder() (string, error) {
    a.LogToFile("SelectFolder: Открытие диалога через zenity (обход бага Wails)")

    // Снимаем поверх всех окон, чтобы диалог не закрылся назад в трей
    wailsRuntime.WindowSetAlwaysOnTop(a.ctx, false)

    // Вызываем системное окно Windows напрямую
    path, err := zenity.SelectFile(zenity.Directory(), zenity.Title("Выберите папку для скриншотов"))
    if err != nil {
        // Если пользователь нажал "Отмена", zenity вернет ошибку, просто игнорируем её
        if err.Error() == "dialog canceled" || err == zenity.ErrCanceled {
            return "", nil
        }
        a.LogToFile("SelectFolder: Ошибка zenity - " + err.Error())
        return "", err
    }

    a.LogToFile("SelectFolder: Выбран путь - " + path)

    if path != "" {
        a.config.SavePath = path
        a.savePath = path
        a.SaveConfig(a.config)
    }
    return path, nil
}

// --- ПРОВЕРКА ЛИЦЕНЗИИ ---

func (a *App) GetUserAccount() UserAccount {
    address := strings.TrimSpace(a.config.Username)

    if address == "" {
        return UserAccount{Address: "", IsPro: false, StorageUsed: 0, StorageLimit: 0}
    }

    // НОВОЕ: Заглушка для гранта. Запросы к GitHub (Big Tech) полностью удалены.
    // Возвращаем статус Free. Проверка Pro будет реализована через подпись PKOIN (Web3 Auth).
    return UserAccount{
        Address:      address,
        IsPro:        false,
        StorageUsed:  1048576, // 1 МБ
        StorageLimit: 10485760, // 10 МБ
        ExpiryDate:   "",
    }
}


func (a *App) BuySubscription() {
    wailsRuntime.BrowserOpenURL(a.ctx, "https://bastyon.com")
}

// --- УТИЛИТЫ ---

func (a *App) OpenHistory() {
    openPath(a.savePath)
}

func openPath(path string) {
    var cmd *exec.Cmd
    switch runtime.GOOS {
    case "windows":
        cmd = exec.Command("explorer", path)
    case "darwin":
        cmd = exec.Command("open", path)
    case "linux":
        cmd = exec.Command("xdg-open", path)
    }
    if cmd != nil {
        cmd.Start()
    }
}