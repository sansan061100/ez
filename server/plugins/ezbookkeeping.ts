import { setSystemReadyPromise } from '~~/server/lib/boot/ready';
import { startSystem } from '~~/server/lib/boot/startup';
import { Container as CronContainer } from '~~/server/lib/cron/index';

// initializes ezBookkeeping (configuration, database, cron jobs, etc.) when the nitro server starts
export default defineNitroPlugin(nitroApp => {
    const readyPromise = startSystem();

    readyPromise.catch(err => {
        process.stderr.write(`Failed to start ezBookkeeping: ${err instanceof Error ? err.message : String(err)}\n`);

        if (!import.meta.dev) {
            process.exit(1);
        }
    });

    setSystemReadyPromise(readyPromise);

    // stops the cron jobs when the nitro server is closed (e.g. reloaded in development mode)
    nitroApp.hooks.hook('close', () => {
        CronContainer.stop();
    });
});
