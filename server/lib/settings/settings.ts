import { readFileSync, statSync } from 'node:fs';
import { BlockList, isIP } from 'node:net';
import { isAbsolute, join } from 'node:path';

import { parseUserFeatureRestrictions, type UserFeatureRestrictions } from '../core/feature_restriction';
import { type IPPattern, parseIPPattern } from '../core/ip_pattern';
import { type UserAvatarProviderType } from '../core/types';
import * as errs from '../errs/index';
import { AllLanguages } from '../locales/index';
import { IniFile } from './ini';

const ebkWorkDirEnvName = 'EBK_WORK_DIR';
const ebkConfigItemValueEnvNamePrefix = 'EBK';
const ebkConfigItemFilePathEnvNamePrefix = 'EBKCFP';
const defaultConfigPath = '/conf/ezbookkeeping.ini';
const defaultRootUrl = '%(protocol)s://%(domain)s:%(http_port)s/';

export type SystemMode = 'development' | 'production';
export const MODE_DEVELOPMENT: SystemMode = 'development';
export const MODE_PRODUCTION: SystemMode = 'production';

export type Scheme = 'http' | 'https' | 'socket';
export const SCHEME_HTTP: Scheme = 'http';
export const SCHEME_HTTPS: Scheme = 'https';
export const SCHEME_SOCKET: Scheme = 'socket';

export type Level = 'debug' | 'info' | 'warn' | 'error';

export const MySqlDbType = 'mysql';
export const PostgresDbType = 'postgres';
export const Sqlite3DbType = 'sqlite3';

export const LocalFileSystemObjectStorageType = 'local_filesystem';
export const S3StorageType = 's3';
export const MinIOStorageType = 'minio';
export const WebDAVStorageType = 'webdav';

export const OpenAILLMProvider = 'openai';
export const OpenAICompatibleLLMProvider = 'openai_compatible';
export const OpenAIResponsesCompatibleLLMProvider = 'openai_responses_compatible';
export const AnthropicLLMProvider = 'anthropic';
export const AnthropicCompatibleLLMProvider = 'anthropic_compatible';
export const OpenRouterLLMProvider = 'openrouter';
export const OllamaLLMProvider = 'ollama';
export const LMStudioLLMProvider = 'lm_studio';
export const GoogleAILLMProvider = 'google_ai';

const allLLMProviders = [OpenAILLMProvider, OpenAICompatibleLLMProvider, OpenAIResponsesCompatibleLLMProvider, AnthropicLLMProvider, AnthropicCompatibleLLMProvider, OpenRouterLLMProvider, OllamaLLMProvider, LMStudioLLMProvider, GoogleAILLMProvider];

export type LLMThinkingLevel = '' | 'off' | 'on' | 'low' | 'medium' | 'high' | 'xhigh';
export const LLMThinkingDefault: LLMThinkingLevel = '';
export const LLMThinkingDisabled: LLMThinkingLevel = 'off';
export const LLMThinkingEnabled: LLMThinkingLevel = 'on';
export const LLMThinkingLow: LLMThinkingLevel = 'low';
export const LLMThinkingMedium: LLMThinkingLevel = 'medium';
export const LLMThinkingHigh: LLMThinkingLevel = 'high';
export const LLMThinkingXHigh: LLMThinkingLevel = 'xhigh';

const allLLMThinkingLevels: LLMThinkingLevel[] = ['', 'off', 'on', 'low', 'medium', 'high', 'xhigh'];

export const InternalUuidGeneratorType = 'internal';
export const InMemoryDuplicateCheckerType = 'in_memory';

export const OAuth2UserIdentifierEmail = 'email';
export const OAuth2UserIdentifierUsername = 'username';

export const OAuth2ProviderOIDC = 'oidc';
export const OAuth2ProviderNextcloud = 'nextcloud';
export const OAuth2ProviderGitea = 'gitea';
export const OAuth2ProviderGithub = 'github';

export const OpenStreetMapProvider = 'openstreetmap';
export const OpenStreetMapHumanitarianStyleProvider = 'openstreetmap_humanitarian';
export const OpenTopoMapProvider = 'opentopomap';
export const OPNVKarteMapProvider = 'opnvkarte';
export const CyclOSMMapProvider = 'cyclosm';
export const CartoDBMapProvider = 'cartodb';
export const TomTomMapProvider = 'tomtom';
export const TianDiTuProvider = 'tianditu';
export const GoogleMapProvider = 'googlemap';
export const BaiduMapProvider = 'baidumap';
export const AmapProvider = 'amap';
export const CustomProvider = 'custom';

const allMapProviders = ['', OpenStreetMapProvider, OpenStreetMapHumanitarianStyleProvider, OpenTopoMapProvider, OPNVKarteMapProvider, CyclOSMMapProvider, CartoDBMapProvider, TomTomMapProvider, TianDiTuProvider, GoogleMapProvider, BaiduMapProvider, AmapProvider, CustomProvider];

export const AmapSecurityVerificationInternalProxyMethod = 'internal_proxy';
export const AmapSecurityVerificationExternalProxyMethod = 'external_proxy';
export const AmapSecurityVerificationPlainTextMethod = 'plain_text';

export const CentralBankOfArgentinaDataSource = 'central_bank_of_argentina';
export const BankOfCanadaDataSource = 'bank_of_canada';
export const CzechNationalBankDataSource = 'czech_national_bank';
export const DanmarksNationalbankDataSource = 'danmarks_national_bank';
export const EuroCentralBankDataSource = 'euro_central_bank';
export const NationalBankOfGeorgiaDataSource = 'national_bank_of_georgia';
export const CentralBankOfHungaryDataSource = 'central_bank_of_hungary';
export const BankOfIsraelDataSource = 'bank_of_israel';
export const NationalBankOfKazakhstanDataSource = 'national_bank_of_kazakhstan';
export const CentralBankOfMyanmarDataSource = 'central_bank_of_myanmar';
export const NorgesBankDataSource = 'norges_bank';
export const NationalBankOfPolandDataSource = 'national_bank_of_poland';
export const NationalBankOfRomaniaDataSource = 'national_bank_of_romania';
export const BankOfRussiaDataSource = 'bank_of_russia';
export const SwissNationalBankDataSource = 'swiss_national_bank';
export const NationalBankOfUkraineDataSource = 'national_bank_of_ukraine';
export const CentralBankOfUzbekistanDataSource = 'central_bank_of_uzbekistan';
export const UserCustomExchangeRatesDataSource = 'user_custom';

const allExchangeRatesDataSources = [
    CentralBankOfArgentinaDataSource, BankOfCanadaDataSource, CzechNationalBankDataSource, DanmarksNationalbankDataSource,
    EuroCentralBankDataSource, NationalBankOfGeorgiaDataSource, CentralBankOfHungaryDataSource, BankOfIsraelDataSource,
    NationalBankOfKazakhstanDataSource, CentralBankOfMyanmarDataSource, NorgesBankDataSource, NationalBankOfPolandDataSource,
    NationalBankOfRomaniaDataSource, BankOfRussiaDataSource, SwissNationalBankDataSource, NationalBankOfUkraineDataSource,
    CentralBankOfUzbekistanDataSource, UserCustomExchangeRatesDataSource,
];

const defaultHttpAddr = '0.0.0.0';
const defaultHttpPort = 8080;
const defaultDomain = 'localhost';

const defaultDatabaseHost = '127.0.0.1:3306';
const defaultDatabaseName = 'ezbookkeeping';
const defaultDatabaseMaxIdleConn = 2;
const defaultDatabaseMaxOpenConn = 0;
const defaultDatabaseConnMaxLifetime = 14400;

const defaultLogMode = 'console';
const defaultLogFileMaxSize = 104857600; // 100 MB
const defaultLogFileMaxDays = 7; // days

const defaultWebDAVRequestTimeout = 10000; // 10 seconds

const defaultAIRecognitionPictureMaxSize = 10485760; // 10MB
const defaultAnthropicLargeLanguageModelAPIMaximumTokens = 1024;
const defaultAnthropicLargeLanguageModelThinkingBudget = 1024;
const defaultLargeLanguageModelAPIRequestTimeout = 60000; // 60 seconds

const defaultInMemoryDuplicateCheckerCleanupInterval = 60; // 1 minutes
const defaultDuplicateSubmissionsInterval = 300; // 5 minutes

const defaultSecretKey = 'ezbookkeeping';
const defaultTrustedProxyIPs = '10.0.0.0/8,169.254.0.0/16,127.0.0.0/8,172.16.0.0/12,192.168.0.0/16';
const defaultTokenExpiredTime = 2592000; // 30 days
const defaultTokenMinRefreshInterval = 86400; // 1 day
const defaultTemporaryTokenExpiredTime = 300; // 5 minutes
const defaultEmailVerifyTokenExpiredTime = 3600; // 60 minutes
const defaultPasswordResetTokenExpiredTime = 3600; // 60 minutes
const defaultMaxFailuresPerIpPerMinute = 5;
const defaultMaxFailuresPerUserPerMinute = 5;

const defaultOAuth2StateExpiredTime = 300; // 5 minutes
const defaultOAuth2RequestTimeout = 10000; // 10 seconds

const defaultUserCustomIconFileMaxSize = 1048576; // 1MB
const defaultTransactionPictureFileMaxSize = 10485760; // 10MB
const defaultUserAvatarFileMaxSize = 1048576; // 1MB

const defaultImportFileMaxSize = 10485760; // 10MB

const defaultExchangeRatesDataRequestTimeout = 10000; // 10 seconds

export interface DatabaseConfig {
    databaseType: string;
    databaseHost: string;
    databaseName: string;
    databaseUser: string;
    databasePassword: string;
    databaseSSLMode: string;
    databasePath: string;
    maxIdleConnection: number;
    maxOpenConnection: number;
    connectionMaxLifeTime: number;
}

export interface SMTPConfig {
    smtpHost: string;
    smtpUser: string;
    smtpPasswd: string;
    smtpSkipTLSVerify: boolean;
    fromAddress: string;
}

export interface S3Config {
    endpoint: string;
    region: string;
    accessKeyID: string;
    secretAccessKey: string;
    sessionToken: string;
    useSSL: boolean;
    skipTLSVerify: boolean;
    usePathStyle: boolean;
    bucket: string;
    rootPath: string;
}

export interface MinIOConfig {
    endpoint: string;
    location: string;
    accessKeyID: string;
    secretAccessKey: string;
    useSSL: boolean;
    skipTLSVerify: boolean;
    bucket: string;
    rootPath: string;
}

export interface WebDAVConfig {
    url: string;
    username: string;
    password: string;
    rootPath: string;
    requestTimeout: number;
    proxy: string;
    skipTLSVerify: boolean;
}

export interface LLMConfig {
    llmProvider: string;
    enableThinking: LLMThinkingLevel;
    openAIAPIKey: string;
    openAIModelID: string;
    openAICompatibleBaseURL: string;
    openAICompatibleAPIKey: string;
    openAICompatibleModelID: string;
    anthropicAPIKey: string;
    anthropicModelID: string;
    anthropicMaxTokens: number;
    anthropicThinkingBudgetTokens: number;
    anthropicCompatibleBaseURL: string;
    anthropicCompatibleAPIVersion: string;
    anthropicCompatibleAPIKey: string;
    anthropicCompatibleModelID: string;
    anthropicCompatibleMaxTokens: number;
    anthropicCompatibleThinkingBudgetTokens: number;
    openRouterAPIKey: string;
    openRouterModelID: string;
    ollamaServerURL: string;
    ollamaModelID: string;
    lmStudioServerURL: string;
    lmStudioToken: string;
    lmStudioModelID: string;
    googleAIAPIKey: string;
    googleAIModelID: string;
    largeLanguageModelAPIRequestTimeout: number;
    largeLanguageModelAPIProxy: string;
    largeLanguageModelAPISkipTLSVerify: boolean;
}

export interface MultiLanguageContentConfig {
    enabled: boolean;
    defaultContent: string;
    multiLanguageContent: Record<string, string>;
}

export interface CIDR {
    text: string;
    address: string;
    prefix: number;
    family: 'ipv4' | 'ipv6';
}

export interface Config {
    // Global
    mode: SystemMode;
    workingPath: string;

    // Server
    protocol: Scheme;
    httpAddr: string;
    httpPort: number;
    domain: string;
    rootUrl: string;
    certFile: string;
    certKeyFile: string;
    unixSocketPath: string;
    enableRequestLog: boolean;
    enableRequestIdHeader: boolean;

    // MCP
    enableMCPServer: boolean;
    mcpAllowedRemoteIPs: IPPattern[] | null;

    // Database
    databaseConfig: DatabaseConfig;
    enableQueryLog: boolean;
    autoUpdateDatabase: boolean;

    // Mail
    enableSMTP: boolean;
    smtpConfig: SMTPConfig;

    // Log
    logModes: string[];
    enableConsoleLog: boolean;
    enableFileLog: boolean;
    enableDebugLog: boolean;
    logLevel: Level;
    fileLogPath: string;
    requestFileLogPath: string;
    queryFileLogPath: string;
    logFileRotate: boolean;
    logFileMaxSize: number;
    logFileMaxDays: number;

    // Storage
    storageType: string;
    localFileSystemPath: string;
    s3Config: S3Config;
    minIOConfig: MinIOConfig;
    webDAVConfig: WebDAVConfig;

    // Large Language Model
    transactionFromAITextRecognition: boolean;
    transactionFromAIImageRecognition: boolean;
    maxAIRecognitionPictureFileSize: number;
    textRecognitionLLMConfig: LLMConfig;
    receiptImageRecognitionLLMConfig: LLMConfig;

    // Uuid
    uuidGeneratorType: string;
    uuidServerId: number;

    // Duplicate Checker
    duplicateCheckerType: string;
    inMemoryDuplicateCheckerCleanupInterval: number;
    enableDuplicateSubmissionsCheck: boolean;
    duplicateSubmissionsInterval: number;

    // Cron
    enableRemoveExpiredTokens: boolean;
    enableCreateScheduledTransaction: boolean;

    // Secret
    secretKeyNoSet: boolean;
    secretKey: string;
    trustedProxyIPs: CIDR[] | null;
    trustedProxyTextualIPs: string[] | null;
    trustedProxyBlockList: BlockList | null;
    tokenExpiredTime: number;
    tokenMinRefreshInterval: number;
    temporaryTokenExpiredTime: number;
    emailVerifyTokenExpiredTime: number;
    passwordResetTokenExpiredTime: number;
    enableAPIToken: boolean;
    apiTokenAllowedRemoteIPs: IPPattern[] | null;
    maxFailuresPerIpPerMinute: number;
    maxFailuresPerUserPerMinute: number;

    // Auth
    enableInternalAuth: boolean;
    enableOAuth2Login: boolean;
    enableTwoFactor: boolean;
    enableUserForgetPassword: boolean;
    forgetPasswordRequireVerifyEmail: boolean;
    oauth2ClientID: string;
    oauth2ClientSecret: string;
    oauth2UsePKCE: boolean;
    oauth2UserIdentifier: string;
    oauth2AutoRegister: boolean;
    oauth2Provider: string;
    oauth2StateExpiredTime: number;
    oauth2RequestTimeout: number;
    oauth2Proxy: string;
    oauth2SkipTLSVerify: boolean;
    oauth2OIDCProviderIssuerURL: string;
    oauth2OIDCProviderCheckIssuerURL: boolean;
    oauth2OIDCCustomDisplayNameConfig: MultiLanguageContentConfig;
    oauth2NextcloudBaseUrl: string;
    oauth2GiteaBaseUrl: string;

    // User
    enableUserRegister: boolean;
    enableUserVerifyEmail: boolean;
    enableUserForceVerifyEmail: boolean;
    enableUserCustomIcon: boolean;
    maxUserCustomIconFileSize: number;
    enableTransactionPictures: boolean;
    maxTransactionPictureFileSize: number;
    enableScheduledTransaction: boolean;
    avatarProvider: UserAvatarProviderType;
    maxAvatarFileSize: number;
    defaultFeatureRestrictions: UserFeatureRestrictions;

    // Data
    enableDataExport: boolean;
    enableDataImport: boolean;
    maxImportFileSize: number;

    // Tip
    loginPageTips: MultiLanguageContentConfig;

    // Notification
    afterRegisterNotification: MultiLanguageContentConfig;
    afterLoginNotification: MultiLanguageContentConfig;
    afterOpenNotification: MultiLanguageContentConfig;

    // Map
    mapProvider: string;
    enableMapDataFetchProxy: boolean;
    mapProxy: string;
    tomTomMapAPIKey: string;
    tianDiTuAPIKey: string;
    googleMapAPIKey: string;
    baiduMapAK: string;
    amapApplicationKey: string;
    amapSecurityVerificationMethod: string;
    amapApplicationSecret: string;
    amapApiExternalProxyUrl: string;
    customMapTileServerTileLayerUrl: string;
    customMapTileServerAnnotationLayerUrl: string;
    customMapTileServerMinZoomLevel: number;
    customMapTileServerMaxZoomLevel: number;
    customMapTileServerDefaultZoomLevel: number;

    // Exchange Rates
    exchangeRatesDataSource: string;
    exchangeRatesRequestTimeout: number;
    exchangeRatesRequestTimeoutExceedDefaultValue: boolean;
    exchangeRatesProxy: string;
    exchangeRatesSkipTLSVerify: boolean;
}

// ConfigContainer contains the current setting config
class ConfigContainer {
    private current: Config | null = null;

    public getCurrentConfig(): Config {
        if (!this.current) {
            throw new Error('config is not loaded');
        }

        return this.current;
    }

    public setCurrentConfig(config: Config): void {
        this.current = config;
    }
}

export const Container = new ConfigContainer();

export function setCurrentConfig(config: Config): void {
    Container.setCurrentConfig(config);
}

// loadConfiguration loads setting config from given config file path
export function loadConfiguration(configFilePath: string): Config {
    const cfgFile = IniFile.load(configFilePath);
    const reader = new ConfigReader(cfgFile);
    const config = {} as Config;

    config.workingPath = getWorkingPath();

    loadGlobalConfiguration(config, reader, 'global');
    loadServerConfiguration(config, reader, 'server');
    loadMCPServerConfiguration(config, reader, 'mcp');
    loadDatabaseConfiguration(config, reader, 'database');
    loadMailConfiguration(config, reader, 'mail');
    loadLogConfiguration(config, reader, 'log');
    loadStorageConfiguration(config, reader, 'storage');
    loadLLMGlobalConfiguration(config, reader, 'llm');
    config.textRecognitionLLMConfig = loadLLMConfiguration(reader, 'llm_text_recognition');
    config.receiptImageRecognitionLLMConfig = loadLLMConfiguration(reader, 'llm_image_recognition');
    loadUuidConfiguration(config, reader, 'uuid');
    loadDuplicateCheckerConfiguration(config, reader, 'duplicate_checker');
    loadCronConfiguration(config, reader, 'cron');
    loadSecurityConfiguration(config, reader, 'security');
    loadAuthConfiguration(config, reader, 'auth');
    loadUserConfiguration(config, reader, 'user');
    loadDataConfiguration(config, reader, 'data');
    loadTipConfiguration(config, reader, 'tip');
    loadNotificationConfiguration(config, reader, 'notification');
    loadMapConfiguration(config, reader, 'map');
    loadExchangeRatesConfiguration(config, reader, 'exchange_rates');

    return config;
}

// getDefaultConfigFilePath returns the default config file path
export function getDefaultConfigFilePath(): string {
    const workingPath = getWorkingPath();
    const cfgFilePath = join(workingPath, defaultConfigPath);
    statSync(cfgFilePath);
    return cfgFilePath;
}

function loadGlobalConfiguration(config: Config, reader: ConfigReader, sectionName: string): void {
    const mode = reader.getString(sectionName, 'mode');

    if (mode === 'production') {
        config.mode = MODE_PRODUCTION;
    } else if (mode === 'development') {
        config.mode = MODE_DEVELOPMENT;
    } else {
        throw errs.ErrInvalidServerMode;
    }
}

function loadServerConfiguration(config: Config, reader: ConfigReader, sectionName: string): void {
    const protocol = reader.getString(sectionName, 'protocol');

    config.httpAddr = '';
    config.httpPort = 0;
    config.certFile = '';
    config.certKeyFile = '';
    config.unixSocketPath = '';

    if (protocol === 'http') {
        config.protocol = SCHEME_HTTP;
        config.httpAddr = reader.getString(sectionName, 'http_addr', defaultHttpAddr);
        config.httpPort = reader.getUint(sectionName, 'http_port', 16, defaultHttpPort);
    } else if (protocol === 'https') {
        config.protocol = SCHEME_HTTPS;
        config.httpAddr = reader.getString(sectionName, 'http_addr', defaultHttpAddr);
        config.httpPort = reader.getUint(sectionName, 'http_port', 16, defaultHttpPort);
        config.certFile = reader.getString(sectionName, 'cert_file');
        config.certKeyFile = reader.getString(sectionName, 'cert_key_file');
    } else if (protocol === 'socket') {
        config.protocol = SCHEME_SOCKET;
        config.unixSocketPath = reader.getString(sectionName, 'unix_socket');
    } else {
        throw errs.ErrInvalidProtocol;
    }

    config.domain = reader.getString(sectionName, 'domain', defaultDomain);

    config.rootUrl = reader.getString(sectionName, 'root_url', defaultRootUrl);
    config.rootUrl = config.rootUrl.replaceAll('%(protocol)s', config.protocol);
    config.rootUrl = config.rootUrl.replaceAll('%(domain)s', config.domain);
    config.rootUrl = config.rootUrl.replaceAll('%(http_port)s', String(config.httpPort));

    if (!config.rootUrl.endsWith('/')) {
        config.rootUrl += '/';
    }

    config.enableRequestLog = reader.getBool(sectionName, 'log_request', false);
    config.enableRequestIdHeader = reader.getBool(sectionName, 'request_id_header', true);
}

function loadMCPServerConfiguration(config: Config, reader: ConfigReader, sectionName: string): void {
    config.enableMCPServer = reader.getBool(sectionName, 'enable_mcp', false);
    config.mcpAllowedRemoteIPs = getIPPatterns(reader, sectionName, 'mcp_allowed_remote_ips', '');
}

function loadDatabaseConfiguration(config: Config, reader: ConfigReader, sectionName: string): void {
    const dbConfig = {} as DatabaseConfig;

    dbConfig.databaseType = reader.getString(sectionName, 'type', MySqlDbType);

    if (dbConfig.databaseType !== MySqlDbType && dbConfig.databaseType !== PostgresDbType && dbConfig.databaseType !== Sqlite3DbType) {
        throw errs.ErrDatabaseTypeInvalid;
    }

    dbConfig.databaseHost = reader.getString(sectionName, 'host', defaultDatabaseHost);
    dbConfig.databaseName = reader.getString(sectionName, 'name', defaultDatabaseName);
    dbConfig.databaseUser = reader.getString(sectionName, 'user');
    dbConfig.databasePassword = reader.getString(sectionName, 'passwd');
    dbConfig.databaseSSLMode = '';
    dbConfig.databasePath = '';

    if (dbConfig.databaseType === PostgresDbType) {
        dbConfig.databaseSSLMode = reader.getString(sectionName, 'ssl_mode');
    }

    if (dbConfig.databaseType === Sqlite3DbType) {
        const staticDBPath = reader.getString(sectionName, 'db_path');
        dbConfig.databasePath = getFinalPath(config.workingPath, staticDBPath)[0];
    }

    dbConfig.maxIdleConnection = reader.getUint(sectionName, 'max_idle_conn', 16, defaultDatabaseMaxIdleConn);
    dbConfig.maxOpenConnection = reader.getUint(sectionName, 'max_open_conn', 16, defaultDatabaseMaxOpenConn);
    dbConfig.connectionMaxLifeTime = reader.getUint(sectionName, 'conn_max_lifetime', 32, defaultDatabaseConnMaxLifetime);

    config.databaseConfig = dbConfig;
    config.enableQueryLog = reader.getBool(sectionName, 'log_query', false);
    config.autoUpdateDatabase = reader.getBool(sectionName, 'auto_update_database', true);
}

function loadMailConfiguration(config: Config, reader: ConfigReader, sectionName: string): void {
    config.enableSMTP = reader.getBool(sectionName, 'enable_smtp', false);
    config.smtpConfig = {
        smtpHost: reader.getString(sectionName, 'smtp_host'),
        smtpUser: reader.getString(sectionName, 'smtp_user'),
        smtpPasswd: reader.getString(sectionName, 'smtp_passwd'),
        smtpSkipTLSVerify: reader.getBool(sectionName, 'smtp_skip_tls_verify', false),
        fromAddress: reader.getString(sectionName, 'from_address'),
    };
}

function loadLogConfiguration(config: Config, reader: ConfigReader, sectionName: string): void {
    config.logModes = reader.getString(sectionName, 'mode', defaultLogMode).split(' ');
    config.enableConsoleLog = false;
    config.enableFileLog = false;

    for (const logMode of config.logModes) {
        if (logMode === 'console') {
            config.enableConsoleLog = true;
        } else if (logMode === 'file') {
            config.enableFileLog = true;
        } else {
            throw errs.ErrInvalidLogMode;
        }
    }

    config.logLevel = getLogLevel(reader.getString(sectionName, 'level'));
    config.enableDebugLog = config.logLevel === 'debug';
    config.fileLogPath = '';
    config.requestFileLogPath = '';
    config.queryFileLogPath = '';
    config.logFileRotate = false;
    config.logFileMaxSize = 0;
    config.logFileMaxDays = 0;

    if (config.enableFileLog) {
        const fileLogPath = reader.getString(sectionName, 'log_path');
        config.fileLogPath = getFinalPath(config.workingPath, fileLogPath)[0];

        const requestFileLogPath = reader.getString(sectionName, 'request_log_path');

        if (requestFileLogPath !== '') {
            config.requestFileLogPath = getFinalPath(config.workingPath, requestFileLogPath)[0];
        }

        const queryFileLogPath = reader.getString(sectionName, 'query_log_path');

        if (queryFileLogPath !== '') {
            config.queryFileLogPath = getFinalPath(config.workingPath, queryFileLogPath)[0];
        }

        config.logFileRotate = reader.getBool(sectionName, 'log_file_rotate', false);
        config.logFileMaxSize = reader.getUint(sectionName, 'log_file_max_size', 32, defaultLogFileMaxSize);
        config.logFileMaxDays = reader.getUint(sectionName, 'log_file_max_days', 32, defaultLogFileMaxDays);
    }
}

function loadStorageConfiguration(config: Config, reader: ConfigReader, sectionName: string): void {
    const storageType = reader.getString(sectionName, 'type');

    if (storageType === LocalFileSystemObjectStorageType || storageType === S3StorageType || storageType === MinIOStorageType || storageType === WebDAVStorageType) {
        config.storageType = storageType;
    } else {
        throw errs.ErrInvalidStorageType;
    }

    const localFileSystemRootPath = reader.getString(sectionName, 'local_filesystem_path');
    const [finalLocalFileSystemRootPath, err] = getFinalPath(config.workingPath, localFileSystemRootPath);
    config.localFileSystemPath = finalLocalFileSystemRootPath;

    if (config.storageType === LocalFileSystemObjectStorageType && err) {
        throw errs.ErrInvalidLocalFileSystemStoragePath;
    }

    config.s3Config = {
        endpoint: reader.getString(sectionName, 's3_endpoint'),
        region: reader.getString(sectionName, 's3_region'),
        accessKeyID: reader.getString(sectionName, 's3_access_key_id'),
        secretAccessKey: reader.getString(sectionName, 's3_secret_access_key'),
        sessionToken: reader.getString(sectionName, 's3_session_token'),
        useSSL: reader.getBool(sectionName, 's3_use_ssl', false),
        skipTLSVerify: reader.getBool(sectionName, 's3_skip_tls_verify', false),
        usePathStyle: reader.getBool(sectionName, 's3_use_path_style', false),
        bucket: reader.getString(sectionName, 's3_bucket'),
        rootPath: reader.getString(sectionName, 's3_root_path'),
    };

    config.minIOConfig = {
        endpoint: reader.getString(sectionName, 'minio_endpoint'),
        location: reader.getString(sectionName, 'minio_location'),
        accessKeyID: reader.getString(sectionName, 'minio_access_key_id'),
        secretAccessKey: reader.getString(sectionName, 'minio_secret_access_key'),
        useSSL: reader.getBool(sectionName, 'minio_use_ssl', false),
        skipTLSVerify: reader.getBool(sectionName, 'minio_skip_tls_verify', false),
        bucket: reader.getString(sectionName, 'minio_bucket'),
        rootPath: reader.getString(sectionName, 'minio_root_path'),
    };

    config.webDAVConfig = {
        url: reader.getString(sectionName, 'webdav_url'),
        username: reader.getString(sectionName, 'webdav_username'),
        password: reader.getString(sectionName, 'webdav_password'),
        rootPath: reader.getString(sectionName, 'webdav_root_path'),
        requestTimeout: reader.getUint(sectionName, 'webdav_request_timeout', 32, defaultWebDAVRequestTimeout),
        proxy: reader.getString(sectionName, 'webdav_proxy', 'system'),
        skipTLSVerify: reader.getBool(sectionName, 'webdav_skip_tls_verify', false),
    };
}

function loadLLMGlobalConfiguration(config: Config, reader: ConfigReader, sectionName: string): void {
    config.transactionFromAITextRecognition = reader.getBool(sectionName, 'transaction_from_ai_text_recognition', false);
    config.transactionFromAIImageRecognition = reader.getBool(sectionName, 'transaction_from_ai_image_recognition', false);
    config.maxAIRecognitionPictureFileSize = reader.getUint(sectionName, 'max_ai_recognition_picture_size', 32, defaultAIRecognitionPictureMaxSize);
}

function loadLLMConfiguration(reader: ConfigReader, sectionName: string): LLMConfig {
    const llmProvider = reader.getString(sectionName, 'llm_provider');

    if (llmProvider !== '' && !allLLMProviders.includes(llmProvider)) {
        throw errs.ErrInvalidLLMProvider;
    }

    const thinkingLevel = reader.getString(sectionName, 'enable_thinking') as LLMThinkingLevel;

    if (!allLLMThinkingLevels.includes(thinkingLevel)) {
        throw errs.ErrInvalidLLMThinkingLevel;
    }

    return {
        llmProvider: llmProvider,
        enableThinking: thinkingLevel,
        openAIAPIKey: reader.getString(sectionName, 'openai_api_key'),
        openAIModelID: reader.getString(sectionName, 'openai_model_id'),
        openAICompatibleBaseURL: reader.getString(sectionName, 'openai_compatible_base_url'),
        openAICompatibleAPIKey: reader.getString(sectionName, 'openai_compatible_api_key'),
        openAICompatibleModelID: reader.getString(sectionName, 'openai_compatible_model_id'),
        anthropicAPIKey: reader.getString(sectionName, 'anthropic_api_key'),
        anthropicModelID: reader.getString(sectionName, 'anthropic_model_id'),
        anthropicMaxTokens: reader.getUint(sectionName, 'anthropic_max_tokens', 32, defaultAnthropicLargeLanguageModelAPIMaximumTokens),
        anthropicThinkingBudgetTokens: reader.getUint(sectionName, 'anthropic_thinking_budget_tokens', 32, defaultAnthropicLargeLanguageModelThinkingBudget),
        anthropicCompatibleBaseURL: reader.getString(sectionName, 'anthropic_compatible_base_url'),
        anthropicCompatibleAPIVersion: reader.getString(sectionName, 'anthropic_compatible_api_version'),
        anthropicCompatibleAPIKey: reader.getString(sectionName, 'anthropic_compatible_api_key'),
        anthropicCompatibleModelID: reader.getString(sectionName, 'anthropic_compatible_model_id'),
        anthropicCompatibleMaxTokens: reader.getUint(sectionName, 'anthropic_compatible_max_tokens', 32, defaultAnthropicLargeLanguageModelAPIMaximumTokens),
        anthropicCompatibleThinkingBudgetTokens: reader.getUint(sectionName, 'anthropic_compatible_thinking_budget_tokens', 32, defaultAnthropicLargeLanguageModelThinkingBudget),
        openRouterAPIKey: reader.getString(sectionName, 'openrouter_api_key'),
        openRouterModelID: reader.getString(sectionName, 'openrouter_model_id'),
        ollamaServerURL: reader.getString(sectionName, 'ollama_server_url'),
        ollamaModelID: reader.getString(sectionName, 'ollama_model_id'),
        lmStudioServerURL: reader.getString(sectionName, 'lm_studio_server_url'),
        lmStudioToken: reader.getString(sectionName, 'lm_studio_token'),
        lmStudioModelID: reader.getString(sectionName, 'lm_studio_model_id'),
        googleAIAPIKey: reader.getString(sectionName, 'google_ai_api_key'),
        googleAIModelID: reader.getString(sectionName, 'google_ai_model_id'),
        largeLanguageModelAPIProxy: reader.getString(sectionName, 'proxy', 'system'),
        largeLanguageModelAPIRequestTimeout: reader.getUint(sectionName, 'request_timeout', 32, defaultLargeLanguageModelAPIRequestTimeout),
        largeLanguageModelAPISkipTLSVerify: reader.getBool(sectionName, 'skip_tls_verify', false),
    };
}

function loadUuidConfiguration(config: Config, reader: ConfigReader, sectionName: string): void {
    if (reader.getString(sectionName, 'generator_type') === InternalUuidGeneratorType) {
        config.uuidGeneratorType = InternalUuidGeneratorType;
    } else {
        throw errs.ErrInvalidUuidMode;
    }

    config.uuidServerId = reader.getUint(sectionName, 'server_id', 8, 0);
}

function loadDuplicateCheckerConfiguration(config: Config, reader: ConfigReader, sectionName: string): void {
    if (reader.getString(sectionName, 'checker_type') === InMemoryDuplicateCheckerType) {
        config.duplicateCheckerType = InMemoryDuplicateCheckerType;
    } else {
        throw errs.ErrInvalidDuplicateCheckerType;
    }

    config.inMemoryDuplicateCheckerCleanupInterval = reader.getUint(sectionName, 'cleanup_interval', 32, defaultInMemoryDuplicateCheckerCleanupInterval);

    if (config.inMemoryDuplicateCheckerCleanupInterval < 1) {
        throw errs.ErrInvalidInMemoryDuplicateCheckerCleanupInterval;
    }

    let duplicateSubmissionsInterval = reader.getUint(sectionName, 'duplicate_submissions_interval', 32, defaultDuplicateSubmissionsInterval);
    config.enableDuplicateSubmissionsCheck = duplicateSubmissionsInterval > 0;

    if (duplicateSubmissionsInterval < 1) {
        duplicateSubmissionsInterval = defaultDuplicateSubmissionsInterval;
    }

    config.duplicateSubmissionsInterval = duplicateSubmissionsInterval;
}

function loadCronConfiguration(config: Config, reader: ConfigReader, sectionName: string): void {
    config.enableRemoveExpiredTokens = reader.getBool(sectionName, 'enable_remove_expired_tokens', false);
    config.enableCreateScheduledTransaction = reader.getBool(sectionName, 'enable_create_scheduled_transaction', false);
}

function loadSecurityConfiguration(config: Config, reader: ConfigReader, sectionName: string): void {
    config.secretKeyNoSet = !reader.isSet(sectionName, 'secret_key');
    config.secretKey = reader.getString(sectionName, 'secret_key', defaultSecretKey);

    const [cidrs, textualCidrs, blockList] = getCIDRList(reader, sectionName, 'trusted_proxy_ips', defaultTrustedProxyIPs);
    config.trustedProxyIPs = cidrs;
    config.trustedProxyTextualIPs = textualCidrs;
    config.trustedProxyBlockList = blockList;

    config.tokenExpiredTime = reader.getUint(sectionName, 'token_expired_time', 32, defaultTokenExpiredTime);

    if (config.tokenExpiredTime < 60) {
        throw errs.ErrInvalidTokenExpiredTime;
    }

    config.tokenMinRefreshInterval = reader.getUint(sectionName, 'token_min_refresh_interval', 32, defaultTokenMinRefreshInterval);

    if (config.tokenMinRefreshInterval >= config.tokenExpiredTime) {
        throw errs.ErrInvalidTokenMinRefreshInterval;
    }

    config.temporaryTokenExpiredTime = reader.getUint(sectionName, 'temporary_token_expired_time', 32, defaultTemporaryTokenExpiredTime);

    if (config.temporaryTokenExpiredTime < 60) {
        throw errs.ErrInvalidTemporaryTokenExpiredTime;
    }

    config.emailVerifyTokenExpiredTime = reader.getUint(sectionName, 'email_verify_token_expired_time', 32, defaultEmailVerifyTokenExpiredTime);

    if (config.emailVerifyTokenExpiredTime < 60) {
        throw errs.ErrInvalidEmailVerifyTokenExpiredTime;
    }

    config.passwordResetTokenExpiredTime = reader.getUint(sectionName, 'password_reset_token_expired_time', 32, defaultPasswordResetTokenExpiredTime);

    if (config.passwordResetTokenExpiredTime < 60) {
        throw errs.ErrInvalidPasswordResetTokenExpiredTime;
    }

    config.enableAPIToken = reader.getBool(sectionName, 'enable_api_token', false);
    config.apiTokenAllowedRemoteIPs = getIPPatterns(reader, sectionName, 'api_token_allowed_remote_ips', '');
    config.maxFailuresPerIpPerMinute = reader.getUint(sectionName, 'max_failures_per_ip_per_minute', 32, defaultMaxFailuresPerIpPerMinute);
    config.maxFailuresPerUserPerMinute = reader.getUint(sectionName, 'max_failures_per_user_per_minute', 32, defaultMaxFailuresPerUserPerMinute);
}

function loadAuthConfiguration(config: Config, reader: ConfigReader, sectionName: string): void {
    config.enableInternalAuth = reader.getBool(sectionName, 'enable_internal_auth', true);
    config.enableOAuth2Login = reader.getBool(sectionName, 'enable_oauth2_auth', false);
    config.enableTwoFactor = reader.getBool(sectionName, 'enable_two_factor', true);
    config.enableUserForgetPassword = reader.getBool(sectionName, 'enable_forget_password', false);
    config.forgetPasswordRequireVerifyEmail = reader.getBool(sectionName, 'forget_password_require_email_verify', false);
    config.oauth2ClientID = reader.getString(sectionName, 'oauth2_client_id');
    config.oauth2ClientSecret = reader.getString(sectionName, 'oauth2_client_secret');
    config.oauth2UsePKCE = reader.getBool(sectionName, 'oauth2_use_pkce', false);

    const oauth2UserIdentifier = reader.getString(sectionName, 'oauth2_user_identifier');

    if (oauth2UserIdentifier === OAuth2UserIdentifierEmail || oauth2UserIdentifier === OAuth2UserIdentifierUsername) {
        config.oauth2UserIdentifier = oauth2UserIdentifier;
    } else {
        throw errs.ErrInvalidOAuth2UserIdentifier;
    }

    config.oauth2AutoRegister = reader.getBool(sectionName, 'oauth2_auto_register', true);

    const oauth2Provider = reader.getString(sectionName, 'oauth2_provider');

    if (oauth2Provider === '' || oauth2Provider === OAuth2ProviderOIDC || oauth2Provider === OAuth2ProviderNextcloud || oauth2Provider === OAuth2ProviderGitea || oauth2Provider === OAuth2ProviderGithub) {
        config.oauth2Provider = oauth2Provider;
    } else {
        throw errs.ErrInvalidOAuth2Provider;
    }

    config.oauth2StateExpiredTime = reader.getUint(sectionName, 'oauth2_state_expired_time', 32, defaultOAuth2StateExpiredTime);

    if (config.oauth2StateExpiredTime < 60) {
        throw errs.ErrInvalidOAuth2StateExpiredTime;
    }

    config.oauth2Proxy = reader.getString(sectionName, 'oauth2_proxy', 'system');
    config.oauth2RequestTimeout = reader.getUint(sectionName, 'oauth2_request_timeout', 32, defaultOAuth2RequestTimeout);
    config.oauth2SkipTLSVerify = reader.getBool(sectionName, 'oauth2_skip_tls_verify', false);
    config.oauth2OIDCProviderIssuerURL = reader.getString(sectionName, 'oidc_provider_base_url');
    config.oauth2OIDCProviderCheckIssuerURL = reader.getBool(sectionName, 'oidc_provider_check_issuer_url', true);
    config.oauth2OIDCCustomDisplayNameConfig = getMultiLanguageContentConfig(reader, sectionName, 'enable_oidc_display_name', 'oidc_custom_display_name');
    config.oauth2NextcloudBaseUrl = reader.getString(sectionName, 'nextcloud_base_url');
    config.oauth2GiteaBaseUrl = reader.getString(sectionName, 'gitea_base_url');
}

function loadUserConfiguration(config: Config, reader: ConfigReader, sectionName: string): void {
    config.enableUserRegister = reader.getBool(sectionName, 'enable_register', false);
    config.enableUserVerifyEmail = reader.getBool(sectionName, 'enable_email_verify', false);
    config.enableUserForceVerifyEmail = reader.getBool(sectionName, 'enable_force_email_verify', false);
    config.enableUserCustomIcon = reader.getBool(sectionName, 'enable_custom_icon', false);
    config.maxUserCustomIconFileSize = reader.getUint(sectionName, 'max_user_custom_icon_size', 32, defaultUserCustomIconFileMaxSize);
    config.enableTransactionPictures = reader.getBool(sectionName, 'enable_transaction_picture', false);
    config.maxTransactionPictureFileSize = reader.getUint(sectionName, 'max_transaction_picture_size', 32, defaultTransactionPictureFileMaxSize);
    config.enableScheduledTransaction = reader.getBool(sectionName, 'enable_scheduled_transaction', false);

    const avatarProvider = reader.getString(sectionName, 'avatar_provider');

    if (avatarProvider === 'internal' || avatarProvider === 'gravatar' || avatarProvider === '') {
        config.avatarProvider = avatarProvider;
    } else {
        throw errs.ErrInvalidAvatarProvider;
    }

    config.maxAvatarFileSize = reader.getUint(sectionName, 'max_user_avatar_size', 32, defaultUserAvatarFileMaxSize);
    config.defaultFeatureRestrictions = parseUserFeatureRestrictions(reader.getString(sectionName, 'default_feature_restrictions', ''));
}

function loadDataConfiguration(config: Config, reader: ConfigReader, sectionName: string): void {
    config.enableDataExport = reader.getBool(sectionName, 'enable_export', false);
    config.enableDataImport = reader.getBool(sectionName, 'enable_import', false);
    config.maxImportFileSize = reader.getUint(sectionName, 'max_import_file_size', 32, defaultImportFileMaxSize);
}

function loadTipConfiguration(config: Config, reader: ConfigReader, sectionName: string): void {
    config.loginPageTips = getMultiLanguageContentConfig(reader, sectionName, 'enable_tips_in_login_page', 'login_page_tips_content');
}

function loadNotificationConfiguration(config: Config, reader: ConfigReader, sectionName: string): void {
    config.afterRegisterNotification = getMultiLanguageContentConfig(reader, sectionName, 'enable_notification_after_register', 'after_register_notification_content');
    config.afterLoginNotification = getMultiLanguageContentConfig(reader, sectionName, 'enable_notification_after_login', 'after_login_notification_content');
    config.afterOpenNotification = getMultiLanguageContentConfig(reader, sectionName, 'enable_notification_after_open', 'after_open_notification_content');
}

function loadMapConfiguration(config: Config, reader: ConfigReader, sectionName: string): void {
    const mapProvider = reader.getString(sectionName, 'map_provider');

    if (allMapProviders.includes(mapProvider)) {
        config.mapProvider = mapProvider;
    } else {
        throw errs.ErrInvalidMapProvider;
    }

    config.enableMapDataFetchProxy = reader.getBool(sectionName, 'map_data_fetch_proxy', false);
    config.mapProxy = reader.getString(sectionName, 'proxy', 'system');
    config.tomTomMapAPIKey = reader.getString(sectionName, 'tomtom_map_api_key');
    config.tianDiTuAPIKey = reader.getString(sectionName, 'tianditu_map_app_key');
    config.googleMapAPIKey = reader.getString(sectionName, 'google_map_api_key');
    config.baiduMapAK = reader.getString(sectionName, 'baidu_map_ak');
    config.amapApplicationKey = reader.getString(sectionName, 'amap_application_key');

    const amapSecurityVerificationMethod = reader.getString(sectionName, 'amap_security_verification_method');

    if (amapSecurityVerificationMethod === AmapSecurityVerificationInternalProxyMethod ||
        amapSecurityVerificationMethod === AmapSecurityVerificationExternalProxyMethod ||
        amapSecurityVerificationMethod === AmapSecurityVerificationPlainTextMethod) {
        config.amapSecurityVerificationMethod = amapSecurityVerificationMethod;
    } else {
        throw errs.ErrInvalidAmapSecurityVerificationMethod;
    }

    config.amapApplicationSecret = reader.getString(sectionName, 'amap_application_secret');
    config.amapApiExternalProxyUrl = reader.getString(sectionName, 'amap_api_external_proxy_url');
    config.customMapTileServerTileLayerUrl = reader.getString(sectionName, 'custom_map_tile_server_url');
    config.customMapTileServerAnnotationLayerUrl = reader.getString(sectionName, 'custom_map_tile_server_annotation_url');
    config.customMapTileServerMinZoomLevel = reader.getUint(sectionName, 'custom_map_tile_server_min_zoom_level', 8, 1);
    config.customMapTileServerMaxZoomLevel = reader.getUint(sectionName, 'custom_map_tile_server_max_zoom_level', 8, 18);
    config.customMapTileServerDefaultZoomLevel = reader.getUint(sectionName, 'custom_map_tile_server_default_zoom_level', 8, 14);
}

function loadExchangeRatesConfiguration(config: Config, reader: ConfigReader, sectionName: string): void {
    const dataSource = reader.getString(sectionName, 'data_source');

    if (allExchangeRatesDataSources.includes(dataSource)) {
        config.exchangeRatesDataSource = dataSource;
    } else {
        throw errs.ErrInvalidExchangeRatesDataSource;
    }

    config.exchangeRatesProxy = reader.getString(sectionName, 'proxy', 'system');
    config.exchangeRatesRequestTimeout = reader.getUint(sectionName, 'request_timeout', 32, defaultExchangeRatesDataRequestTimeout);
    config.exchangeRatesRequestTimeoutExceedDefaultValue = config.exchangeRatesRequestTimeout > defaultExchangeRatesDataRequestTimeout;
    config.exchangeRatesSkipTLSVerify = reader.getBool(sectionName, 'skip_tls_verify', false);
}

function getWorkingPath(): string {
    const workingPath = process.env[ebkWorkDirEnvName];

    if (workingPath) {
        return workingPath;
    }

    return process.cwd();
}

function getFinalPath(workingPath: string, p: string): [string, Error | null] {
    if (!isAbsolute(p)) {
        p = join(workingPath, p);
    }

    try {
        statSync(p);
        return [p, null];
    } catch (err) {
        return [p, err as Error];
    }
}

function getIPPatterns(reader: ConfigReader, sectionName: string, itemName: string, defaultValue: string): IPPattern[] | null {
    const configValue = reader.getString(sectionName, itemName, defaultValue);

    if (configValue === '') {
        return null;
    }

    const ipPatterns: IPPattern[] = [];

    for (const remoteIp of configValue.split(',')) {
        const pattern = parseIPPattern(remoteIp.trim());

        if (pattern) {
            ipPatterns.push(pattern);
        }
    }

    return ipPatterns;
}

function parseCIDR(cidr: string): CIDR {
    const slashIndex = cidr.indexOf('/');

    if (slashIndex < 0) {
        throw new Error(`invalid CIDR address: ${cidr}`);
    }

    const address = cidr.substring(0, slashIndex);
    const prefixText = cidr.substring(slashIndex + 1);
    const ipVersion = isIP(address);

    if (ipVersion === 0 || !/^\d+$/.test(prefixText)) {
        throw new Error(`invalid CIDR address: ${cidr}`);
    }

    const prefix = parseInt(prefixText, 10);

    if ((ipVersion === 4 && prefix > 32) || (ipVersion === 6 && prefix > 128)) {
        throw new Error(`invalid CIDR address: ${cidr}`);
    }

    const family = ipVersion === 4 ? 'ipv4' : 'ipv6';
    let networkAddress = address;

    if (ipVersion === 4) {
        const octets = address.split('.').map(o => parseInt(o, 10));
        let value = ((octets[0]! << 24) >>> 0) + (octets[1]! << 16) + (octets[2]! << 8) + octets[3]!;
        const mask = prefix === 0 ? 0 : (0xFFFFFFFF << (32 - prefix)) >>> 0;
        value = (value & mask) >>> 0;
        networkAddress = [value >>> 24, (value >>> 16) & 0xFF, (value >>> 8) & 0xFF, value & 0xFF].join('.');
    }

    return { text: `${networkAddress}/${prefix}`, address: networkAddress, prefix: prefix, family: family };
}

function getCIDRList(reader: ConfigReader, sectionName: string, itemName: string, defaultValue: string): [CIDR[] | null, string[] | null, BlockList | null] {
    const configValue = reader.getString(sectionName, itemName, defaultValue);

    if (configValue === '') {
        return [null, null, null];
    }

    const parsedCIDRs: CIDR[] = [];
    const textualCIDRs: string[] = [];
    const blockList = new BlockList();

    for (const item of configValue.split(',')) {
        const cidr = item.trim();

        if (cidr === '') {
            continue;
        }

        const parsed = parseCIDR(cidr);
        parsedCIDRs.push(parsed);
        textualCIDRs.push(parsed.text);
        blockList.addSubnet(parsed.address, parsed.prefix, parsed.family);
    }

    return [parsedCIDRs, textualCIDRs, blockList];
}

function getMultiLanguageContentConfig(reader: ConfigReader, sectionName: string, enableKey: string, contentKey: string): MultiLanguageContentConfig {
    const config: MultiLanguageContentConfig = {
        enabled: reader.getBool(sectionName, enableKey, false),
        defaultContent: reader.getString(sectionName, contentKey, ''),
        multiLanguageContent: {},
    };

    for (const languageTag of Object.keys(AllLanguages)) {
        const multiLanguageContentKey = contentKey + '_' + languageTag.toLowerCase().replaceAll('-', '_');
        const content = reader.getString(sectionName, multiLanguageContentKey, '');

        if (content !== '') {
            config.multiLanguageContent[languageTag] = content;
        }
    }

    return config;
}

function getLogLevel(logLevelStr: string): Level {
    if (logLevelStr === 'debug' || logLevelStr === 'info' || logLevelStr === 'warn' || logLevelStr === 'error') {
        return logLevelStr;
    }

    throw errs.ErrInvalidLogLevel;
}

// parseGoBool behaves like go strconv.ParseBool
export function parseGoBool(value: string): boolean | null {
    switch (value) {
        case '1':
        case 't':
        case 'T':
        case 'TRUE':
        case 'true':
        case 'True':
            return true;
        case '0':
        case 'f':
        case 'F':
        case 'FALSE':
        case 'false':
        case 'False':
            return false;
        default:
            return null;
    }
}

function parseGoUint(value: string, bitSize: number): number | null {
    if (!/^\+?\d+$/.test(value)) {
        return null;
    }

    const num = BigInt(value);

    if (num > (1n << BigInt(bitSize)) - 1n) {
        return null;
    }

    return Number(num);
}

// ConfigReader reads config item values from ini file, and supports overriding by environment variables
class ConfigReader {
    private readonly file: IniFile;

    public constructor(file: IniFile) {
        this.file = file;
    }

    public isSet(sectionName: string, itemName: string): boolean {
        const environmentValue = getConfigItemValueFromEnvironment(sectionName, itemName);

        if (environmentValue.length > 0) {
            return true;
        }

        if (!this.file.hasKey(sectionName, itemName)) {
            return false;
        }

        return this.file.getValue(sectionName, itemName) !== '';
    }

    public getString(sectionName: string, itemName: string, defaultValue?: string): string {
        const environmentValue = getConfigItemValueFromEnvironment(sectionName, itemName);

        if (environmentValue.length > 0) {
            return environmentValue;
        }

        const value = this.file.getValue(sectionName, itemName);

        if (value.length === 0 && defaultValue !== undefined) {
            return defaultValue;
        }

        return value;
    }

    public getUint(sectionName: string, itemName: string, bitSize: number, defaultValue: number): number {
        const environmentValue = getConfigItemValueFromEnvironment(sectionName, itemName);

        if (environmentValue.length > 0) {
            const value = parseGoUint(environmentValue, bitSize);

            if (value !== null) {
                return value;
            }
        }

        const value = parseGoUint(this.file.getValue(sectionName, itemName), bitSize);
        return value ?? defaultValue;
    }

    public getBool(sectionName: string, itemName: string, defaultValue: boolean): boolean {
        const environmentValue = getConfigItemValueFromEnvironment(sectionName, itemName);

        if (environmentValue.length > 0) {
            const value = parseGoBool(environmentValue);

            if (value !== null) {
                return value;
            }
        }

        const value = parseGoBool(this.file.getValue(sectionName, itemName));
        return value ?? defaultValue;
    }
}

function getConfigItemValueFromEnvironment(sectionName: string, itemName: string): string {
    const itemFilePathEnvironmentKey = `${ebkConfigItemFilePathEnvNamePrefix}_${sectionName.toUpperCase()}_${itemName.toUpperCase()}`;
    const itemFilePath = process.env[itemFilePathEnvironmentKey];

    if (itemFilePath) {
        try {
            return readFileSync(itemFilePath, 'utf8');
        } catch {
            // ignore and fallback to environment value
        }
    }

    const itemValueEnvironmentKey = `${ebkConfigItemValueEnvNamePrefix}_${sectionName.toUpperCase()}_${itemName.toUpperCase()}`;
    return process.env[itemValueEnvironmentKey] ?? '';
}
