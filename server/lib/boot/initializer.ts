import { existsSync } from 'node:fs';

import type { BootContext } from '../core/context';
import { initializeAvatarProvider } from '../avatars/index';
import { initializeDataStore } from '../datastore/index';
import { initializeDuplicateChecker } from '../duplicatechecker/index';
import { initializeExchangeRatesDataSource } from '../exchangerates/index';
import { initializeLargeLanguageModelProvider } from '../llm/index';
import * as log from '../log/index';
import { initializeMailer } from '../mail/index';
import { type Config, getDefaultConfigFilePath, type LLMConfig, loadConfiguration, setCurrentConfig } from '../settings/settings';
import { initializeStorageContainer } from '../storage/index';
import { initializeUuidGenerator } from '../uuid/index';
import { goJsonStringify } from '../web/json';

function errMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

export interface InitializeSystemOptions {
    // custom config file path, uses the default config file path if it is empty
    configFilePath: string;
    isDisableBootLog: boolean;
}

// initializeSystem loads the configuration and initializes all the system components
export async function initializeSystem(c: BootContext, options: InitializeSystemOptions): Promise<Config> {
    let configFilePath = options.configFilePath;
    const isDisableBootLog = options.isDisableBootLog;

    const bootError = (message: string): void => {
        if (!isDisableBootLog) {
            log.bootErrorf(c, message);
        }
    };

    const bootInfo = (message: string): void => {
        if (!isDisableBootLog) {
            log.bootInfof(c, message);
        }
    };

    if (configFilePath !== '') {
        if (!existsSync(configFilePath)) {
            bootError(`[initializer.initializeSystem] cannot load configuration from custom config path ${configFilePath}, because file not exists`);
            throw new Error(`stat ${configFilePath}: no such file or directory`);
        }

        bootInfo(`[initializer.initializeSystem] will loading configuration from custom config path ${configFilePath}`);
    } else {
        try {
            configFilePath = getDefaultConfigFilePath();
        } catch (err) {
            bootError(`[initializer.initializeSystem] cannot get default configuration path, because ${errMessage(err)}`);
            throw err;
        }

        bootInfo(`[initializer.initializeSystem] will load configuration from default config path ${configFilePath}`);
    }

    let config: Config;

    try {
        config = loadConfiguration(configFilePath);
    } catch (err) {
        bootError(`[initializer.initializeSystem] cannot load configuration, because ${errMessage(err)}`);
        throw err;
    }

    if (config.secretKeyNoSet) {
        log.bootWarnf(c, '[initializer.initializeSystem] "secret_key" in config file is not set, please change it to keep your user data safe');
    }

    setCurrentConfig(config);

    const steps: [string, () => void | Promise<void>][] = [
        ['initializes data store failed', () => initializeDataStore(config)],
        ['sets logger configuration failed', () => log.setLoggerConfiguration(config, isDisableBootLog)],
        ['initializes object storage failed', () => initializeStorageContainer(config)],
        ['initializes large language model provider failed', () => initializeLargeLanguageModelProvider(config)],
        ['initializes uuid generator failed', () => initializeUuidGenerator(config)],
        ['initializes duplicate checker failed', () => initializeDuplicateChecker(config)],
        ['initializes avatar provider failed', () => initializeAvatarProvider(config)],
        ['initializes mailer failed', () => initializeMailer(config)],
        ['initializes exchange rates data source failed', () => initializeExchangeRatesDataSource(config)],
    ];

    for (const [failedMessage, step] of steps) {
        try {
            await step();
        } catch (err) {
            bootError(`[initializer.initializeSystem] ${failedMessage}, because ${errMessage(err)}`);
            throw err;
        }
    }

    bootInfo(`[initializer.initializeSystem] has loaded configuration ${goJsonStringify(getConfigWithoutSensitiveData(config))}`);

    return config;
}

function getConfigWithoutSensitiveData(config: Config): Config {
    let clonedConfig: Config;

    try {
        clonedConfig = structuredClone(config);
    } catch {
        return config;
    }

    const mask = (value: string): string => (value !== '' ? '****' : value);

    clonedConfig.databaseConfig.databasePassword = mask(clonedConfig.databaseConfig.databasePassword);
    clonedConfig.smtpConfig.smtpPasswd = mask(clonedConfig.smtpConfig.smtpPasswd);
    clonedConfig.s3Config.secretAccessKey = mask(clonedConfig.s3Config.secretAccessKey);
    clonedConfig.s3Config.sessionToken = mask(clonedConfig.s3Config.sessionToken);
    clonedConfig.minIOConfig.secretAccessKey = mask(clonedConfig.minIOConfig.secretAccessKey);

    if (clonedConfig.webDAVConfig) {
        clonedConfig.webDAVConfig.password = mask(clonedConfig.webDAVConfig.password);
    }

    const removeSensitiveDataFromLLMConfig = (llmConfig: LLMConfig | null | undefined): void => {
        if (!llmConfig) {
            return;
        }

        llmConfig.openAIAPIKey = mask(llmConfig.openAIAPIKey);
        llmConfig.openAICompatibleAPIKey = mask(llmConfig.openAICompatibleAPIKey);
        llmConfig.anthropicCompatibleAPIKey = mask(llmConfig.anthropicCompatibleAPIKey);
        llmConfig.anthropicAPIKey = mask(llmConfig.anthropicAPIKey);
        llmConfig.openRouterAPIKey = mask(llmConfig.openRouterAPIKey);
        llmConfig.lmStudioToken = mask(llmConfig.lmStudioToken);
        llmConfig.googleAIAPIKey = mask(llmConfig.googleAIAPIKey);
    };

    removeSensitiveDataFromLLMConfig(clonedConfig.textRecognitionLLMConfig);
    removeSensitiveDataFromLLMConfig(clonedConfig.receiptImageRecognitionLLMConfig);

    clonedConfig.secretKey = mask(clonedConfig.secretKey);
    clonedConfig.oauth2ClientSecret = mask(clonedConfig.oauth2ClientSecret);
    clonedConfig.amapApplicationSecret = mask(clonedConfig.amapApplicationSecret);

    return clonedConfig;
}
