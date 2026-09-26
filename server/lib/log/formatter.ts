import { formatUnixTimeToLongDateTimeInServerTimezone } from '../utils/datetimes';

export interface LogEntry {
    level: string;
    message: string;
    requestId?: string;
    extra?: string;
    prefix?: string;
    disableLevel?: boolean;
}

// formatLogLine formats a log entry like "2006-01-02 15:04:05 [PREFIX] [LEVEL] [request-id] message"
export function formatLogLine(entry: LogEntry): string {
    let b = formatUnixTimeToLongDateTimeInServerTimezone(Math.floor(Date.now() / 1000));
    b += ' ';

    if (entry.prefix) {
        b += entry.prefix + ' ';
    }

    if (!entry.disableLevel) {
        b += '[' + entry.level.toUpperCase() + '] ';
    }

    if (entry.requestId) {
        b += `[${entry.requestId}] `;
    }

    b += entry.message;
    b += '\n';

    if (entry.extra !== undefined) {
        b += entry.extra;
    }

    return b;
}
