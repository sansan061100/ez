import { initializeOAuth2Provider } from '../auth/oauth2/index';
import { BootContext } from '../core/context';
import { initializeCronJobSchedulerContainer } from '../cron/index';
import * as log from '../log/index';
import { initializeMCPHandlers } from '../mcp/index';
import { Container as RequestIdContainer, initializeRequestIdGenerator } from '../requestid/index';
import { InternalUuidGeneratorType } from '../settings/settings';
import { updateAllDatabaseTablesStructure } from './database';
import { initializeSystem } from './initializer';

// the environment variable of custom config file path (replaces the "--conf-path" flag of the original command line)
const configFilePathEnvName = 'EBK_CONF_PATH';
// the environment variable to disable boot log (replaces the "--no-boot-log" flag of the original command line)
const disableBootLogEnvName = 'EBK_NO_BOOT_LOG';

function errMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

// startSystem initializes the system and all the components required by the web server
export async function startSystem(): Promise<void> {
    const c = new BootContext();
    const disableBootLogValue = process.env[disableBootLogEnvName] ?? '';
    const config = await initializeSystem(c, {
        configFilePath: process.env[configFilePathEnvName] ?? '',
        isDisableBootLog: disableBootLogValue === 'true' || disableBootLogValue === '1',
    });

    if (config.autoUpdateDatabase) {
        try {
            await updateAllDatabaseTablesStructure(c);
        } catch (err) {
            log.bootErrorf(c, `[startup.startSystem] update database table structure failed, because ${errMessage(err)}`);
            throw err;
        }
    }

    const steps: [string, () => void][] = [
        ['initializes requestid generator failed', () => initializeRequestIdGenerator(c, config)],
        ['initializes mcp handlers failed', () => initializeMCPHandlers(config)],
        ['initializes oauth 2.0 provider failed', () => initializeOAuth2Provider(config)],
        ['initializes cron job scheduler failed', () => initializeCronJobSchedulerContainer(c, config, true)],
    ];

    for (const [failedMessage, step] of steps) {
        try {
            step();
        } catch (err) {
            log.bootErrorf(c, `[startup.startSystem] ${failedMessage}, because ${errMessage(err)}`);
            throw err;
        }
    }

    const serverInfo = `current server id is ${RequestIdContainer.getCurrentServerUniqId()}, current instance id is ${RequestIdContainer.getCurrentInstanceUniqId()}`;
    const uuidServerInfo = config.uuidGeneratorType === InternalUuidGeneratorType ? `, current uuid server id is ${config.uuidServerId}` : '';
    log.bootInfof(c, `[startup.startSystem] ${serverInfo}${uuidServerInfo}`);
}
