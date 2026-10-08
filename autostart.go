package main

import (
    "golang.org/x/sys/windows/registry"
    "os"
)

const autostartKey = `Software\Microsoft\Windows\CurrentVersion\Run`
const autostartVal = "BastyShot"

// ToggleAutostart включает или выключает автозапуск через Реестр Windows
func (a *App) ToggleAutostart(enable bool) error {
    execPath, err := os.Executable()
    if err != nil {
        return err
    }

    key, _, err := registry.CreateKey(registry.CURRENT_USER, autostartKey, registry.SET_VALUE|registry.QUERY_VALUE)
    if err != nil {
        return err
    }
    defer key.Close()

    if enable {
        // Добавляем путь к exe в реестр
        return key.SetStringValue(autostartVal, execPath)
    } else {
        // Удаляем ключ
        return key.DeleteValue(autostartVal)
    }
}