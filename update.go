package main

import (
    "encoding/json"
    "fmt"
    "net/http"
    "time"
)



// НОВОЕ: Адрес репозитория на GitHub. Замени на свой, когда создашь репозиторий!
const GitHubRepo = "yourusername/bastyshot"

// GitHubRelease структура для парсинга ответа от GitHub API
type GitHubRelease struct {
    TagName string `json:"tag_name"`
    HTMLURL string `json:"html_url"`
}

func (a *App) CheckForUpdates() (string, string, error) {
    client := a.getHTTPClient(10 * time.Second)
    url := fmt.Sprintf("https://api.github.com/repos/%s/releases/latest", GitHubRepo)
    
    req, _ := http.NewRequest("GET", url, nil)
    req.Header.Set("User-Agent", "BastyShot-Updater")

    resp, err := client.Do(req)
    if err != nil {
        return AppVersion, "", fmt.Errorf("нет соединения с GitHub")
    }
    defer resp.Body.Close()

    if resp.StatusCode == 404 {
        return AppVersion, "", fmt.Errorf("репозиторий не найден (возможно, приватный)")
    }
    if resp.StatusCode != 200 {
        return AppVersion, "", fmt.Errorf("ошибка сервера GitHub")
    }

    var release GitHubRelease
    json.NewDecoder(resp.Body).Decode(&release)

    if release.TagName != "" && release.TagName != AppVersion {
        return AppVersion, release.HTMLURL, nil
    }
    
    return AppVersion, "", nil
}