package main

import (
    "fmt"
    "time"
    "github.com/getlantern/systray"
    wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

func (a *App) onTrayReady() {
    systray.SetIcon(trayIcon)
    systray.SetTitle("BastyShot")
    systray.SetTooltip("BastyShot")

    mFragment := systray.AddMenuItem("Быстрый фрагмент", "Сделать скриншот фрагмента")
    mScreen := systray.AddMenuItem("Экран", "Скриншот всего экрана")
    systray.AddSeparator()
    mPanel := systray.AddMenuItem("Показать панель", "Открыть интерфейс")
    mHistory := systray.AddMenuItem("История", "Открыть историю")
    mSettings := systray.AddMenuItem("Настройки", "Открыть настройки")
    systray.AddSeparator()
    mQuit := systray.AddMenuItem("Выход", "Выйти из программы")

    go func() {
        defer func() {
            if r := recover(); r != nil {
                a.LogToFile("Tray listener panicked: " + fmt.Sprintf("%v", r))
            }
        }()

        for {
            select {
            case <-mFragment.ClickedCh:
                wailsRuntime.EventsEmit(a.ctx, "start_capture")
            case <-mScreen.ClickedCh:
                wailsRuntime.EventsEmit(a.ctx, "start_full_capture")
            case <-mPanel.ClickedCh:
                a.ShowPanel()
                wailsRuntime.EventsEmit(a.ctx, "show_panel_ui")
            case <-mHistory.ClickedCh:
                a.OpenHistoryWindow()
                wailsRuntime.EventsEmit(a.ctx, "show_history_ui")
            case <-mSettings.ClickedCh:
                a.OpenSettings()
                wailsRuntime.EventsEmit(a.ctx, "show_settings_ui")
            case <-mQuit.ClickedCh:
                isQuitting = true
                systray.Quit()
                return
            }
        }
    }()

    // НОВОЕ: Пульс для иконки трея (защита от исчезновения в Windows)
    go func() {
        for {
            time.Sleep(10 * time.Second)
            systray.SetIcon(trayIcon)
            systray.SetTooltip("BastyShot")
        }
    }()
}

func (a *App) onTrayExit() {
    isQuitting = true // ВАЖНО: Сообщаем программе, что мы реально выходим
    if instanceListener != nil {
        instanceListener.Close() // НОВОЕ: Закрываем порт, чтобы не зависал
    }
    wailsRuntime.Quit(a.ctx)
}