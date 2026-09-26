import type { Config } from '../settings/settings';
import { formatLogLine } from './formatter';
import { RotateFileWriter } from './rotate_file_writer';

// LogContext is the minimal context used for logging
export interface LogContext {
    getContextId(): string;
}

type Writer = (data: string) => void;

const stdoutWriter: Writer = data => {
    process.stdout.write(data);
};

const levelValues: Record<string, number> = {
    debug: 5,
    info: 4,
    warning: 3,
    error: 2,
};

class Logger {
    public writers: Writer[] = [stdoutWriter];
    public level: number = levelValues['info']!;
    public readonly prefix?: string;
    public readonly disableLevel?: boolean;

    public constructor(prefix?: string, disableLevel?: boolean) {
        this.prefix = prefix;
        this.disableLevel = disableLevel;
    }

    public log(level: string, message: string, requestId?: string, extra?: string): void {
        if ((levelValues[level] ?? 0) > this.level) {
            return;
        }

        const line = formatLogLine({
            level: level,
            message: message,
            requestId: requestId,
            extra: extra,
            prefix: this.prefix,
            disableLevel: this.disableLevel,
        });

        for (const writer of this.writers) {
            writer(line);
        }
    }
}

const bootLogger = new Logger();
const cliLogger = new Logger();
const defaultLogger = new Logger();
let requestLogger: Logger | null = new Logger('[REQUEST]', true);
let sqlQueryLogger: Logger | null = new Logger('[SQLQUERY]', true);

const fileWriters = new Map<string, RotateFileWriter>();

function getFileWriter(filePath: string, config: Config): Writer {
    let writer = fileWriters.get(filePath);

    if (!writer) {
        writer = new RotateFileWriter(filePath, config.logFileRotate, config.logFileMaxSize, config.logFileMaxDays);
        fileWriters.set(filePath, writer);
    }

    const w = writer;
    return data => w.write(data);
}

export function setLoggerConfiguration(config: Config, isDisableBootLog: boolean): void {
    const bootWriters: Writer[] = [];
    const defaultWriters: Writer[] = [];
    const requestWriters: Writer[] = [];
    const queryWriters: Writer[] = [];

    if (!isDisableBootLog) {
        bootWriters.push(stdoutWriter);
    }

    if (config.enableConsoleLog) {
        defaultWriters.push(stdoutWriter);
        requestWriters.push(stdoutWriter);
        queryWriters.push(stdoutWriter);
    }

    if (config.enableFileLog) {
        const defaultWriter = getFileWriter(config.fileLogPath, config);

        if (!isDisableBootLog) {
            bootWriters.push(defaultWriter);
        }

        defaultWriters.push(defaultWriter);

        if (config.enableRequestLog) {
            if (config.requestFileLogPath !== '' && config.requestFileLogPath !== config.fileLogPath) {
                requestWriters.push(getFileWriter(config.requestFileLogPath, config));
            } else {
                requestWriters.push(defaultWriter);
            }
        }

        if (config.enableQueryLog) {
            if (config.queryFileLogPath !== '' && config.queryFileLogPath !== config.fileLogPath) {
                queryWriters.push(getFileWriter(config.queryFileLogPath, config));
            } else {
                queryWriters.push(defaultWriter);
            }
        }
    }

    bootLogger.writers = bootWriters;
    defaultLogger.writers = defaultWriters;

    const level = config.logLevel === 'warn' ? levelValues['warning']! : levelValues[config.logLevel]!;
    cliLogger.level = level;
    bootLogger.level = level;
    defaultLogger.level = level;

    if (requestLogger) {
        requestLogger.writers = requestWriters;
    }

    if (sqlQueryLogger) {
        sqlQueryLogger.writers = queryWriters;
    }

    if (!config.enableRequestLog) {
        requestLogger = null;
    }

    if (!config.enableQueryLog) {
        sqlQueryLogger = null;
    }
}

function getFinalLog(message: string): string {
    return message.replaceAll('\n', ' ');
}

function contextId(c: LogContext | null | undefined): string | undefined {
    return c ? c.getContextId() : undefined;
}

export function debugf(c: LogContext | null | undefined, message: string): void {
    defaultLogger.log('debug', getFinalLog(message), contextId(c));
}

export function infof(c: LogContext | null | undefined, message: string): void {
    defaultLogger.log('info', getFinalLog(message), contextId(c));
}

export function warnf(c: LogContext | null | undefined, message: string): void {
    defaultLogger.log('warning', getFinalLog(message), contextId(c));
}

export function errorf(c: LogContext | null | undefined, message: string): void {
    defaultLogger.log('error', getFinalLog(message), contextId(c));
}

export function errorfWithExtra(c: LogContext | null | undefined, extraString: string, message: string): void {
    defaultLogger.log('error', getFinalLog(message), contextId(c), extraString);
}

export function bootInfof(c: LogContext | null | undefined, message: string): void {
    bootLogger.log('info', getFinalLog(message), contextId(c));
}

export function bootWarnf(c: LogContext | null | undefined, message: string): void {
    bootLogger.log('warning', getFinalLog(message), contextId(c));
}

export function bootErrorf(c: LogContext | null | undefined, message: string): void {
    bootLogger.log('error', getFinalLog(message), contextId(c));
}

export function cliInfof(c: LogContext | null | undefined, message: string): void {
    cliLogger.log('info', getFinalLog(message), contextId(c));
}

export function cliWarnf(c: LogContext | null | undefined, message: string): void {
    cliLogger.log('warning', getFinalLog(message), contextId(c));
}

export function cliErrorf(c: LogContext | null | undefined, message: string): void {
    cliLogger.log('error', getFinalLog(message), contextId(c));
}

export function requestf(c: LogContext, message: string): void {
    requestLogger?.log('info', getFinalLog(message), c.getContextId());
}

export function isSqlQueryLogEnabled(): boolean {
    return sqlQueryLogger !== null;
}

export function sqlQuery(message: string): void {
    sqlQueryLogger?.log('info', message);
}

export function sqlQueryf(message: string): void {
    sqlQueryLogger?.log('info', getFinalLog(message));
}

export function errorText(err: unknown): string {
    if (err instanceof Error) {
        return err.message;
    }

    return String(err);
}
