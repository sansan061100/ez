declare interface ServerBuildInfo {
    version: string;
    commitHash: string;
    buildTime: string;
}

declare const __EZBOOKKEEPING_SERVER_BUILD_INFO__: ServerBuildInfo;
