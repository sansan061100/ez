import { Cron } from 'croner';

import { type Context, type CronContext, newCronJobContext, newNullContext } from '../core/context';
import { Container as DuplicateCheckerContainer } from '../duplicatechecker/index';
import * as errs from '../errs/index';
import * as log from '../log/index';
import { Tokens } from '../services/tokens';
import { Transactions } from '../services/transactions';
import type { Config } from '../settings/settings';
import { getLocalIPAddressesString } from '../utils/network';

// CronJobPeriod represents the cron job period
export interface CronJobPeriod {
    // getInterval returns the interval time of the period in seconds
    getInterval(): number;
    // toCronPattern returns the croner pattern (or the date of one time job)
    toCronPattern(): string | Date;
    // toIntervalSeconds returns the interval seconds of duration job
    toIntervalSeconds?(): number;
}

// CronJobIntervalPeriod represents the period of execution at intervals
export class CronJobIntervalPeriod implements CronJobPeriod {
    public constructor(public readonly intervalSeconds: number) {
    }

    public getInterval(): number {
        return this.intervalSeconds;
    }

    public toCronPattern(): string {
        return '* * * * * *';
    }

    public toIntervalSeconds(): number {
        return this.intervalSeconds;
    }
}

// CronJobFixedHourPeriod represents the period of execution at fixed hour
export class CronJobFixedHourPeriod implements CronJobPeriod {
    public constructor(public readonly hour: number) {
    }

    public getInterval(): number {
        return 24 * 60 * 60;
    }

    public toCronPattern(): string {
        return `0 0 ${this.hour} * * *`;
    }
}

// CronJobEvery15MinutesPeriod represents the period of execution at every 15 minutes
export class CronJobEvery15MinutesPeriod implements CronJobPeriod {
    public constructor(public readonly second: number) {
    }

    public getInterval(): number {
        return 15 * 60;
    }

    public toCronPattern(): string {
        return `${this.second} */15 * * * *`;
    }
}

// CronJobFixedTimePeriod represents the period of execution at fixed time
export class CronJobFixedTimePeriod implements CronJobPeriod {
    public constructor(public readonly time: Date) {
    }

    public getInterval(): number {
        return 0;
    }

    public toCronPattern(): Date {
        return this.time;
    }
}

// CronJob represents the cron job instance
export class CronJob {
    public constructor(
        public readonly name: string,
        public readonly description: string,
        public readonly period: CronJobPeriod,
        private readonly run: (c: CronContext) => Promise<void>,
    ) {
    }

    public async doRun(): Promise<void> {
        const start = Date.now();
        const c = newCronJobContext(this.name, this.period.getInterval());

        if (DuplicateCheckerContainer.isEnabled()) {
            let localAddr: string;

            try {
                localAddr = getLocalIPAddressesString();
            } catch (err) {
                log.warnf(c, `[cron_job.doRun] job "${this.name}" cannot get local ipv4 address, because ${(err as Error).message}`);
                return;
            }

            const currentInfo = `ip: ${localAddr}, startTime: ${Math.floor(Date.now() / 1000)}`;
            const [found, runningInfo] = DuplicateCheckerContainer.getOrSetCronJobRunningInfo(this.name, currentInfo, this.period.getInterval());

            if (found) {
                log.warnf(c, `[cron_job.doRun] job "${this.name}" is already running (${runningInfo})`);
                return;
            }
        }

        try {
            await this.run(c);
        } catch (err) {
            log.errorf(c, `[cron_job.doRun] failed to run job "${this.name}", because ${(err as Error).message}`);
            return;
        }

        log.infof(c, `[cron_job.doRun] run job "${this.name}" successfully, cost ${Date.now() - start}ms`);
    }
}

// RemoveExpiredTokensJob represents the cron job which periodically remove expired user tokens from the database
export const RemoveExpiredTokensJob = new CronJob(
    'RemoveExpiredTokens',
    'Periodically remove expired user tokens from the database.',
    new CronJobFixedHourPeriod(0),
    c => Tokens.deleteAllExpiredTokens(c),
);

// CreateScheduledTransactionJob represents the cron job which periodically create transaction by scheduled transaction template
export const CreateScheduledTransactionJob = new CronJob(
    'CreateScheduledTransaction',
    'Periodically create transaction by scheduled transaction template.',
    new CronJobEvery15MinutesPeriod(0),
    c => Transactions.createScheduledTransactions(c, Math.floor(Date.now() / 1000), c.getInterval()),
);

// scheduledTransactionCatchUpSeconds is how far back the external scheduler re-checks the scheduled transaction windows,
// it is longer than one day because Vercel Cron runs at most once a day (at any time in the hour) on the Hobby plan
const scheduledTransactionCatchUpSeconds = 26 * 60 * 60;

// CatchUpScheduledTransactionJob creates the transactions of all the windows in the catch-up period,
// the transactions which have been created are skipped by createScheduledTransactions
export const CatchUpScheduledTransactionJob = new CronJob(
    'CatchUpScheduledTransaction',
    'Create the transactions of the scheduled transaction templates in the past 26 hours which have not been created.',
    new CronJobEvery15MinutesPeriod(0),
    async c => {
        const now = Math.floor(Date.now() / 1000);

        for (let t = now - scheduledTransactionCatchUpSeconds; t <= now; t += c.getInterval()) {
            await Transactions.createScheduledTransactions(c, t, c.getInterval());
        }
    },
);

// CronJobSchedulerContainer contains the current cron job scheduler
export class CronJobSchedulerContainer {
    private readonly allJobs: CronJob[] = [];
    private readonly allJobsMap = new Map<string, CronJob>();
    private readonly allCronerJobsMap = new Map<string, Cron>();
    private started = false;

    // getAllJobs returns all the cron jobs
    public getAllJobs(): CronJob[] {
        return this.allJobs;
    }

    // syncRunJobNow runs the specified cron job synchronously now
    public async syncRunJobNow(jobName: string): Promise<void> {
        if (jobName === '') {
            throw errs.ErrCronJobNameIsEmpty;
        }

        const job = this.allJobsMap.get(jobName);

        if (!job || !this.allCronerJobsMap.has(jobName)) {
            throw errs.ErrCronJobNotExistsOrNotEnabled;
        }

        await job.doRun();
    }

    // runAllJobsByExternalScheduler runs all the enabled cron jobs once, it is used when the server does not keep running
    // between requests (e.g. Vercel), the scheduled transactions job catches up all the missed windows instead
    public async runAllJobsByExternalScheduler(): Promise<void> {
        for (const job of this.allJobs) {
            await (job === CreateScheduledTransactionJob ? CatchUpScheduledTransactionJob : job).doRun();
        }
    }

    public registerAllJobs(ctx: Context, config: Config): void {
        if (config.enableRemoveExpiredTokens) {
            this.registerJob(ctx, RemoveExpiredTokensJob);
        }

        if (config.enableCreateScheduledTransaction) {
            this.registerJob(ctx, CreateScheduledTransactionJob);
        }
    }

    public start(): void {
        if (this.started) {
            return;
        }

        this.started = true;

        for (const cronerJob of this.allCronerJobsMap.values()) {
            cronerJob.resume();
        }
    }

    public stop(): void {
        for (const cronerJob of this.allCronerJobsMap.values()) {
            cronerJob.stop();
        }
    }

    private registerJob(ctx: Context, job: CronJob): void {
        try {
            const intervalSeconds = job.period.toIntervalSeconds?.();
            let cronerJob: Cron;

            if (intervalSeconds !== undefined) {
                cronerJob = new Cron('* * * * * *', { name: job.name, paused: true, protect: true, interval: intervalSeconds }, () => job.doRun());
            } else {
                cronerJob = new Cron(job.period.toCronPattern(), { name: job.name, paused: true, protect: true }, () => job.doRun());
            }

            this.allJobs.push(job);
            this.allJobsMap.set(job.name, job);
            this.allCronerJobsMap.set(job.name, cronerJob);
            log.infof(ctx, `[cron_container.registerJob] job "${job.name}" has been registered`);
        } catch (err) {
            log.errorf(ctx, `[cron_container.registerJob] job "${job.name}" cannot be been registered, because ${(err as Error).message}`);
        }
    }
}

// Container is the cron job scheduler container singleton instance
export const Container = new CronJobSchedulerContainer();

// initializeCronJobSchedulerContainer initializes the cron job scheduler according to the config
export function initializeCronJobSchedulerContainer(ctx: Context, config: Config, startScheduler: boolean): void {
    log.infof(newNullContext(), 'gocron: new scheduler created');
    Container.registerAllJobs(ctx, config);

    if (startScheduler) {
        Container.start();
        log.infof(newNullContext(), 'gocron: scheduler started');
    }
}
