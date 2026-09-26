import * as errs from '../errs/index';
import { type Config, InMemoryDuplicateCheckerType } from '../settings/settings';

export type DuplicateCheckerType = number;

export const DUPLICATE_CHECKER_TYPE_BACKGROUND_CRON_JOB = 0;
export const DUPLICATE_CHECKER_TYPE_NEW_ACCOUNT = 1;
export const DUPLICATE_CHECKER_TYPE_NEW_SUBACCOUNT = 2;
export const DUPLICATE_CHECKER_TYPE_NEW_CATEGORY = 3;
export const DUPLICATE_CHECKER_TYPE_NEW_TRANSACTION = 4;
export const DUPLICATE_CHECKER_TYPE_NEW_TEMPLATE = 5;
export const DUPLICATE_CHECKER_TYPE_NEW_PICTURE = 6;
export const DUPLICATE_CHECKER_TYPE_IMPORT_TRANSACTIONS = 7;
export const DUPLICATE_CHECKER_TYPE_OAUTH2_REDIRECT = 8;
export const DUPLICATE_CHECKER_TYPE_NEW_CUSTOM_ICON = 9;
export const DUPLICATE_CHECKER_TYPE_2FA_PASSCODE = 10;
export const DUPLICATE_CHECKER_TYPE_FAILURE_CHECK = 255;

// DuplicateChecker is common duplicate checker interface
export interface DuplicateChecker {
    getSubmissionRemark(checkerType: DuplicateCheckerType, uid: bigint, identification: string): [boolean, string];
    setSubmissionRemark(checkerType: DuplicateCheckerType, uid: bigint, identification: string, remark: string): void;
    setSubmissionRemarkWithCustomExpiration(checkerType: DuplicateCheckerType, uid: bigint, identification: string, remark: string, expirationSeconds: number): void;
    removeSubmissionRemark(checkerType: DuplicateCheckerType, uid: bigint, identification: string): void;
    getOrSetCronJobRunningInfo(jobName: string, runningInfo: string, runningIntervalSeconds: number): [boolean, string];
    removeCronJobRunningInfo(jobName: string): void;
    getFailureCount(failureKey: string): number;
    increaseFailureCount(failureKey: string): number;
}

interface CacheItem {
    value: unknown;
    expiration: number; // unix millis, 0 means never expire
}

// InMemoryDuplicateChecker represents in-memory duplicate checker
export class InMemoryDuplicateChecker implements DuplicateChecker {
    private readonly cache = new Map<string, CacheItem>();
    private readonly defaultExpirationMillis: number;

    public constructor(config: Config) {
        this.defaultExpirationMillis = config.duplicateSubmissionsInterval * 1000;

        const cleanupTimer = setInterval(() => this.deleteExpired(), config.inMemoryDuplicateCheckerCleanupInterval * 1000);
        cleanupTimer.unref();
    }

    public getSubmissionRemark(checkerType: DuplicateCheckerType, uid: bigint, identification: string): [boolean, string] {
        const existedRemark = this.get(this.getCacheKey(checkerType, uid, identification));

        if (existedRemark !== undefined) {
            return [true, existedRemark as string];
        }

        return [false, ''];
    }

    public setSubmissionRemark(checkerType: DuplicateCheckerType, uid: bigint, identification: string, remark: string): void {
        this.set(this.getCacheKey(checkerType, uid, identification), remark, this.defaultExpirationMillis);
    }

    public setSubmissionRemarkWithCustomExpiration(checkerType: DuplicateCheckerType, uid: bigint, identification: string, remark: string, expirationSeconds: number): void {
        this.set(this.getCacheKey(checkerType, uid, identification), remark, expirationSeconds * 1000);
    }

    public removeSubmissionRemark(checkerType: DuplicateCheckerType, uid: bigint, identification: string): void {
        this.cache.delete(this.getCacheKey(checkerType, uid, identification));
    }

    public getOrSetCronJobRunningInfo(jobName: string, runningInfo: string, runningIntervalSeconds: number): [boolean, string] {
        const cacheKey = this.getCacheKey(DUPLICATE_CHECKER_TYPE_BACKGROUND_CRON_JOB, 0n, jobName);
        const existedRunningInfo = this.get(cacheKey);

        if (existedRunningInfo !== undefined) {
            return [true, existedRunningInfo as string];
        }

        let expiration = runningIntervalSeconds * 1000;

        if (expiration > 1000) {
            expiration = expiration - 1000;
        }

        this.set(cacheKey, runningInfo, expiration);
        return [false, ''];
    }

    public removeCronJobRunningInfo(jobName: string): void {
        this.cache.delete(this.getCacheKey(DUPLICATE_CHECKER_TYPE_BACKGROUND_CRON_JOB, 0n, jobName));
    }

    public getFailureCount(failureKey: string): number {
        const existedFailureCount = this.get(this.getCacheKey(DUPLICATE_CHECKER_TYPE_FAILURE_CHECK, 0n, failureKey));
        return existedFailureCount !== undefined ? (existedFailureCount as number) : 0;
    }

    public increaseFailureCount(failureKey: string): number {
        const cacheKey = this.getCacheKey(DUPLICATE_CHECKER_TYPE_FAILURE_CHECK, 0n, failureKey);
        const item = this.cache.get(cacheKey);

        if (item && (item.expiration === 0 || item.expiration > Date.now())) {
            item.value = (item.value as number) + 1;
            return item.value as number;
        }

        this.set(cacheKey, 1, 60 * 1000);
        return 1;
    }

    private get(key: string): unknown {
        const item = this.cache.get(key);

        if (!item) {
            return undefined;
        }

        if (item.expiration > 0 && item.expiration <= Date.now()) {
            return undefined;
        }

        return item.value;
    }

    private set(key: string, value: unknown, expirationMillis: number): void {
        this.cache.set(key, { value: value, expiration: expirationMillis > 0 ? Date.now() + expirationMillis : 0 });
    }

    private deleteExpired(): void {
        const now = Date.now();

        for (const [key, item] of this.cache) {
            if (item.expiration > 0 && item.expiration <= now) {
                this.cache.delete(key);
            }
        }
    }

    private getCacheKey(checkerType: DuplicateCheckerType, uid: bigint, identification: string): string {
        return `${checkerType}|${uid}|${identification}`;
    }
}

// DuplicateCheckerContainer contains the current duplicate checker
class DuplicateCheckerContainer {
    public current: DuplicateChecker | null = null;

    public isEnabled(): boolean {
        return this.current !== null;
    }

    public getSubmissionRemark(checkerType: DuplicateCheckerType, uid: bigint, identification: string): [boolean, string] {
        return this.current ? this.current.getSubmissionRemark(checkerType, uid, identification) : [false, ''];
    }

    public setSubmissionRemark(checkerType: DuplicateCheckerType, uid: bigint, identification: string, remark: string): void {
        this.current?.setSubmissionRemark(checkerType, uid, identification, remark);
    }

    public setSubmissionRemarkWithCustomExpiration(checkerType: DuplicateCheckerType, uid: bigint, identification: string, remark: string, expirationSeconds: number): void {
        this.current?.setSubmissionRemarkWithCustomExpiration(checkerType, uid, identification, remark, expirationSeconds);
    }

    public removeSubmissionRemark(checkerType: DuplicateCheckerType, uid: bigint, identification: string): void {
        this.current?.removeSubmissionRemark(checkerType, uid, identification);
    }

    public getOrSetCronJobRunningInfo(jobName: string, runningInfo: string, runningIntervalSeconds: number): [boolean, string] {
        return this.current ? this.current.getOrSetCronJobRunningInfo(jobName, runningInfo, runningIntervalSeconds) : [false, ''];
    }

    public removeCronJobRunningInfo(jobName: string): void {
        this.current?.removeCronJobRunningInfo(jobName);
    }

    public getFailureCount(failureKey: string): number {
        return this.current ? this.current.getFailureCount(failureKey) : 0;
    }

    public increaseFailureCount(failureKey: string): number {
        return this.current ? this.current.increaseFailureCount(failureKey) : 0;
    }
}

export const Container = new DuplicateCheckerContainer();

export function initializeDuplicateChecker(config: Config): void {
    if (config.duplicateCheckerType === InMemoryDuplicateCheckerType) {
        Container.current = new InMemoryDuplicateChecker(config);
        return;
    }

    throw errs.ErrInvalidDuplicateCheckerType;
}

export function setDuplicateChecker(checker: DuplicateChecker | null): void {
    Container.current = checker;
}
