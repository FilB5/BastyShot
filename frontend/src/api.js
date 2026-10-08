import * as App from '../wailsjs/go/main/App.js';
import { EventsOn, BrowserOpenURL, ClipboardSetText, ScreenGetAll, WindowGetPosition } from '../wailsjs/runtime/runtime.js';

export const wails = {
    // Базовые функции
    SaveCroppedImage: App.SaveCroppedImage,
    CopyImageToClipboard: App.CopyImageToClipboard,
    GetConfig: App.GetConfig,
    SaveConfig: App.SaveConfig,
    CaptureScreen: App.CaptureScreen,
    CloseOverlay: App.CloseOverlay,
    OpenHistory: App.OpenHistory,
    GetUserAccount: App.GetUserAccount,
    BuySubscription: App.BuySubscription,
    SelectFolder: App.SelectFolder,
    HideWindow: App.HideWindow,
    ShowPanel: App.ShowPanel, // НОВОЕ
    OpenSettings: App.OpenSettings,
    CloseSettings: App.CloseSettings,
    LogToFile: App.LogToFile,
    GetMonitors: App.GetMonitors,
    
    // IPFS и Прокси
    PublishToIPFS: App.PublishToIPFS,
    TestIPFSConnection: App.TestIPFSConnection,
    TestProxy: App.TestProxy,
    TestIPFSGateway: App.TestIPFSGateway,
    CancelIPFSUpload: App.CancelIPFSUpload,
    CheckIPFSLink: App.CheckIPFSLink,
    CheckForUpdates: App.CheckForUpdates, // НОВОЕ
    ToggleAutostart: App.ToggleAutostart, // НОВОЕ
    
    // История скриншотов
    GetLocalScreenshots: App.GetLocalScreenshots,
    GetLocalScreenshotPath: App.GetLocalScreenshotPath,
    DeleteLocalScreenshot: App.DeleteLocalScreenshot,
    GetIPFSHistory: App.GetIPFSHistory,
    DeleteIPFSHistory: App.DeleteIPFSHistory,
    SaveIPFSHistory: App.SaveIPFSHistory,
    OpenLocalScreenshot: App.OpenLocalScreenshot,
    OpenHistoryWindow: App.OpenHistoryWindow,
    CloseHistoryWindow: App.CloseHistoryWindow,
    
    // Тосты (Окна загрузки)
    ShowPublishToast: App.ShowPublishToast,
    HidePublishToast: App.HidePublishToast,
    
    // OCR и Переводчик
    EnsureTessDataExists: App.EnsureTessDataExists,
    DeleteTessData: App.DeleteTessData,
    TranslateText: App.TranslateText, // НОВАЯ ФУНКЦИЯ
    TranslateBlock: App.TranslateBlock, // НОВОЕ
    
    // Горячие клавиши
    PauseHotkeys: App.PauseHotkeys,
    RegisterHotkeys: App.RegisterHotkeys,
    
    // Wails Runtime
    ClipboardSetText: ClipboardSetText,
    ScreenGetAll: ScreenGetAll,
    WindowGetPosition: WindowGetPosition,
    EventsOn: EventsOn,
    BrowserOpenURL: BrowserOpenURL
};