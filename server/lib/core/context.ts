// Context is the base context of ezBookkeeping
export interface Context {
    clientIP(): string;
    getContextId(): string;
    getClientLocale(): string;
}

const nullContextId = '00000000-0000-0000-0000-00000000';

// NullContext represents the null context
export class NullContext implements Context {
    public clientIP(): string {
        return '127.0.0.1';
    }

    public getContextId(): string {
        return nullContextId;
    }

    public getClientLocale(): string {
        return '';
    }
}

export function newNullContext(): NullContext {
    return new NullContext();
}

// CronContext represents the cron job context
export class CronContext implements Context {
    private readonly contextId: string;
    private readonly cronJobInterval: number;

    public constructor(cronJobName: string, cronJobIntervalSeconds: number) {
        this.contextId = `cron-job-${cronJobName.toLowerCase()}-${Math.floor(Date.now() / 1000)}`;
        this.cronJobInterval = cronJobIntervalSeconds;
    }

    public clientIP(): string {
        return '127.0.0.1';
    }

    public getContextId(): string {
        return this.contextId;
    }

    public getClientLocale(): string {
        return '';
    }

    // getInterval returns the interval of the cron job in seconds
    public getInterval(): number {
        return this.cronJobInterval;
    }
}

export function newCronJobContext(cronJobName: string, cronJobIntervalSeconds: number): CronContext {
    return new CronContext(cronJobName, cronJobIntervalSeconds);
}

// BootContext represents the context of system booting
export class BootContext implements Context {
    public clientIP(): string {
        return '127.0.0.1';
    }

    public getContextId(): string {
        return '';
    }

    public getClientLocale(): string {
        return '';
    }
}

// RequestContext is the context of a web request which provides request user agent
export interface RequestContext extends Context {
    requestUserAgent(): string;
}
