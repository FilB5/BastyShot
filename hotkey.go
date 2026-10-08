package main

import (
    "fmt"
    "strings"
    "sync"

    "github.com/wailsapp/wails/v2/pkg/runtime"
    "golang.design/x/hotkey"
)

var currentHotkeys = make(map[string]*hotkey.Hotkey)
var hotkeyMutex sync.Mutex

// RegisterHotkeys регистрирует глобальные горячие клавиши из настроек
func (a *App) RegisterHotkeys() {
    hotkeyMutex.Lock()
    defer hotkeyMutex.Unlock()

    // Сначала снимаем все старые регистрации
    for key, hk := range currentHotkeys {
        hk.Unregister()
        delete(currentHotkeys, key)
    }

    // Регистрируем клавишу для фрагмента
    if a.config.Hotkey != "" {
        go a.registerSingleHotkey(a.config.Hotkey, "start_capture")
    }
    
    // НОВОЕ: Регистрируем клавишу для полного экрана
    if a.config.HotkeyFull != "" {
        go a.registerSingleHotkey(a.config.HotkeyFull, "start_full_capture")
    }
}

func (a *App) registerSingleHotkey(hotkeyStr, eventName string) {
    mods, key, err := parseHotkeyString(hotkeyStr)
    if err != nil || key == 0 {
        return
    }

    hk := hotkey.New(mods, key)
    err = hk.Register()
    if err != nil {
        return
    }

    hotkeyMutex.Lock()
    currentHotkeys[hotkeyStr] = hk
    hotkeyMutex.Unlock()

    for {
        // Ждем нажатия клавиши
        <-hk.Keydown()
        
        // ВАЖНО: Проверяем, не снята ли регистрация (защита от ложного срабатывания при PauseHotkeys)
        hotkeyMutex.Lock()
        _, ok := currentHotkeys[hotkeyStr]
        hotkeyMutex.Unlock()
        
        if !ok {
            break // Хоткей был удален (PauseHotkeys), выходим из цикла и завершаем горутину
        }
        
        runtime.EventsEmit(a.ctx, eventName)
    }
}

// Парсинг строки вида "Ctrl+Shift+S" в модификаторы и код клавиши
func parseHotkeyString(s string) ([]hotkey.Modifier, hotkey.Key, error) {
    parts := strings.Split(s, "+")
    var mods []hotkey.Modifier
    var key hotkey.Key = 0

    for _, p := range parts {
        p = strings.TrimSpace(p)
        switch strings.ToLower(p) {
        case "ctrl", "control":
            mods = append(mods, hotkey.ModCtrl)
        case "shift":
            mods = append(mods, hotkey.ModShift)
        case "alt":
            mods = append(mods, hotkey.ModAlt)
        default:
            // Если это не модификатор, значит это сама клавиша
            k, err := stringToKey(p)
            if err != nil {
                return nil, 0, err
            }
            key = k
        }
    }

    return mods, key, nil
}

func stringToKey(s string) (hotkey.Key, error) {
    s = strings.ToUpper(s)
    switch s {
    // Буквы
    case "A": return hotkey.KeyA, nil
    case "B": return hotkey.KeyB, nil
    case "C": return hotkey.KeyC, nil
    case "D": return hotkey.KeyD, nil
    case "E": return hotkey.KeyE, nil
    case "F": return hotkey.KeyF, nil
    case "G": return hotkey.KeyG, nil
    case "H": return hotkey.KeyH, nil
    case "I": return hotkey.KeyI, nil
    case "J": return hotkey.KeyJ, nil
    case "K": return hotkey.KeyK, nil
    case "L": return hotkey.KeyL, nil
    case "M": return hotkey.KeyM, nil
    case "N": return hotkey.KeyN, nil
    case "O": return hotkey.KeyO, nil
    case "P": return hotkey.KeyP, nil
    case "Q": return hotkey.KeyQ, nil
    case "R": return hotkey.KeyR, nil
    case "S": return hotkey.KeyS, nil
    case "T": return hotkey.KeyT, nil
    case "U": return hotkey.KeyU, nil
    case "V": return hotkey.KeyV, nil
    case "W": return hotkey.KeyW, nil
    case "X": return hotkey.KeyX, nil
    case "Y": return hotkey.KeyY, nil
    case "Z": return hotkey.KeyZ, nil
    
    // Цифры (верхний ряд)
    case "0": return hotkey.Key0, nil
    case "1": return hotkey.Key1, nil
    case "2": return hotkey.Key2, nil
    case "3": return hotkey.Key3, nil
    case "4": return hotkey.Key4, nil
    case "5": return hotkey.Key5, nil
    case "6": return hotkey.Key6, nil
    case "7": return hotkey.Key7, nil
    case "8": return hotkey.Key8, nil
    case "9": return hotkey.Key9, nil
    
    // F-клавиши
    case "F1": return hotkey.KeyF1, nil
    case "F2": return hotkey.KeyF2, nil
    case "F3": return hotkey.KeyF3, nil
    case "F4": return hotkey.KeyF4, nil
    case "F5": return hotkey.KeyF5, nil
    case "F6": return hotkey.KeyF6, nil
    case "F7": return hotkey.KeyF7, nil
    case "F8": return hotkey.KeyF8, nil
    case "F9": return hotkey.KeyF9, nil
    case "F10": return hotkey.KeyF10, nil
    case "F11": return hotkey.KeyF11, nil
    case "F12": return hotkey.KeyF12, nil

    // Пробел
    case "SPACE": return hotkey.KeySpace, nil
    
    default:
        // ВАЖНО: Возвращаем ошибку, если клавиша не поддерживается библиотекой
        return 0, fmt.Errorf("клавиша не поддерживается: %s", s)
    }
}

// PauseHotkeys снимает все текущие регистрации (чтобы не мешать вводу в настройках)
func (a *App) PauseHotkeys() {
    hotkeyMutex.Lock()
    defer hotkeyMutex.Unlock()
    for key, hk := range currentHotkeys {
        hk.Unregister()
        delete(currentHotkeys, key)
    }
}