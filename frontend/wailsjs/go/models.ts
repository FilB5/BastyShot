export namespace main {
	
	export class Config {
	    savePath: string;
	    imageFormat: string;
	    hotkey: string;
	    hotkeyFull: string;
	    username: string;
	    licenseKey: string;
	    storageType: string;
	    quality: string;
	    monitorIndex: number;
	    autoStart: boolean;
	    useProxy: boolean;
	    localCopy: boolean;
	    showUpload: boolean;
	    showInfo: boolean;
	    pinataJWT: string;
	    ipfsGateway: string;
	    proxyHost: string;
	    proxyPort: string;
	    proxyUser: string;
	    proxyPass: string;
	    proxyType: string;
	    ocrEnabled: boolean;
	    ocrModel: string;
	    toastHideSuccess: boolean;
	    toastHideError: boolean;
	    saveKeyInHistory: boolean;
	    warnOnTranslate: boolean;
	    logCleanupHours: number;
	    lastLogCleanup: number;
	
	    static createFrom(source: any = {}) {
	        return new Config(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.savePath = source["savePath"];
	        this.imageFormat = source["imageFormat"];
	        this.hotkey = source["hotkey"];
	        this.hotkeyFull = source["hotkeyFull"];
	        this.username = source["username"];
	        this.licenseKey = source["licenseKey"];
	        this.storageType = source["storageType"];
	        this.quality = source["quality"];
	        this.monitorIndex = source["monitorIndex"];
	        this.autoStart = source["autoStart"];
	        this.useProxy = source["useProxy"];
	        this.localCopy = source["localCopy"];
	        this.showUpload = source["showUpload"];
	        this.showInfo = source["showInfo"];
	        this.pinataJWT = source["pinataJWT"];
	        this.ipfsGateway = source["ipfsGateway"];
	        this.proxyHost = source["proxyHost"];
	        this.proxyPort = source["proxyPort"];
	        this.proxyUser = source["proxyUser"];
	        this.proxyPass = source["proxyPass"];
	        this.proxyType = source["proxyType"];
	        this.ocrEnabled = source["ocrEnabled"];
	        this.ocrModel = source["ocrModel"];
	        this.toastHideSuccess = source["toastHideSuccess"];
	        this.toastHideError = source["toastHideError"];
	        this.saveKeyInHistory = source["saveKeyInHistory"];
	        this.warnOnTranslate = source["warnOnTranslate"];
	        this.logCleanupHours = source["logCleanupHours"];
	        this.lastLogCleanup = source["lastLogCleanup"];
	    }
	}
	export class IPFSRecord {
	    id: string;
	    link: string;
	    date: string;
	    localPath: string;
	    thumbnail: string;
	    mode: string;
	
	    static createFrom(source: any = {}) {
	        return new IPFSRecord(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.link = source["link"];
	        this.date = source["date"];
	        this.localPath = source["localPath"];
	        this.thumbnail = source["thumbnail"];
	        this.mode = source["mode"];
	    }
	}
	export class LocalScreenshot {
	    name: string;
	    date: string;
	
	    static createFrom(source: any = {}) {
	        return new LocalScreenshot(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.date = source["date"];
	    }
	}
	export class UserAccount {
	    address: string;
	    isPro: boolean;
	    storageUsed: number;
	    storageLimit: number;
	    expiryDate: string;
	
	    static createFrom(source: any = {}) {
	        return new UserAccount(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.address = source["address"];
	        this.isPro = source["isPro"];
	        this.storageUsed = source["storageUsed"];
	        this.storageLimit = source["storageLimit"];
	        this.expiryDate = source["expiryDate"];
	    }
	}

}

