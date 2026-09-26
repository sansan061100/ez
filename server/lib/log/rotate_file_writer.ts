import { closeSync, openSync, readdirSync, renameSync, rmSync, statSync, writeSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

import { DateTime } from 'luxon';

import { newLoggingError } from '../errs/index';
import { formatLogLine } from './formatter';

const logRotateSuffixDateFormat = 'yyyyMMddHHmmss';
const logRotateSuffixDateLength = 14;

function fallbackLog(level: string, message: string): void {
    process.stdout.write(formatLogLine({ level: level, message: message }));
}

// RotateFileWriter writes logs to file and rotates the file when its size exceeds the maximum size
export class RotateFileWriter {
    public readonly enableRotate: boolean;
    public readonly maxFileSize: number;
    public readonly maxFileDays: number;

    private readonly filePath: string;
    private fd: number | null = null;
    private totalSize: number = 0;
    private lastRemoveOldFilesDay: number = 0;

    public constructor(filePath: string, enableRotate: boolean, maxFileSize: number, maxFileDays: number) {
        this.filePath = filePath;
        this.enableRotate = enableRotate;
        this.maxFileSize = maxFileSize;
        this.maxFileDays = maxFileDays;
        this.openFile();
    }

    public write(data: string): void {
        const buffer = Buffer.from(data);

        if (this.enableRotate && this.totalSize > 0 && this.totalSize + buffer.length >= this.maxFileSize) {
            try {
                this.rotateFile();
            } catch (err) {
                fallbackLog('error', `[rotate_file_writer.Write] cannot rotate log file "${this.filePath}", because ${(err as Error).message}`);
                return;
            }
        }

        if (this.fd === null) {
            return;
        }

        const writeSize = writeSync(this.fd, buffer);
        this.totalSize += writeSize;

        if (this.enableRotate) {
            const today = new Date().getDate();

            if (today !== this.lastRemoveOldFilesDay && this.maxFileDays > 0) {
                this.lastRemoveOldFilesDay = today;
                setImmediate(() => this.removeOldFiles());
            }
        }
    }

    private rotateFile(): void {
        const currentFileName = this.filePath;

        try {
            if (this.fd !== null) {
                closeSync(this.fd);
            }
        } catch (err) {
            throw newLoggingError(`cannot close log file "${currentFileName}", because ${(err as Error).message}`, err);
        }

        this.fd = null;

        const archiveFileName = `${currentFileName}.${DateTime.now().toFormat(logRotateSuffixDateFormat)}`;

        try {
            renameSync(currentFileName, archiveFileName);
        } catch (err) {
            throw newLoggingError(`cannot rename log file "${currentFileName}" to "${archiveFileName}", because ${(err as Error).message}`, err);
        }

        this.openFile();
    }

    private openFile(): void {
        if (this.fd !== null) {
            fallbackLog('warning', `[rotate_file_writer.removeOldFiles] cannot reopen log file "${this.filePath}"`);
            return;
        }

        try {
            this.fd = openSync(this.filePath, 'a', 0o644);
            this.totalSize = 0;
        } catch (err) {
            throw newLoggingError(`cannot open log file "${this.filePath}", because ${(err as Error).message}`, err);
        }
    }

    private removeOldFiles(): void {
        const dir = dirname(this.filePath);
        const logBaseFileName = basename(this.filePath) + '.';
        let allLogFiles: string[];

        try {
            allLogFiles = readdirSync(dir);
        } catch {
            return;
        }

        let retainMinUnixTime = 0;

        if (this.maxFileDays > 0) {
            retainMinUnixTime = Math.floor(DateTime.now().minus({ days: this.maxFileDays }).toSeconds());
        }

        for (const logFileName of allLogFiles) {
            try {
                if (statSync(join(dir, logFileName)).isDirectory()) {
                    continue;
                }
            } catch {
                continue;
            }

            if (!logFileName.startsWith(logBaseFileName)) {
                continue;
            }

            let rotateDate = logFileName.substring(logBaseFileName.length);
            const dotIndex = rotateDate.indexOf('.');

            if (dotIndex > 0) {
                rotateDate = rotateDate.substring(0, dotIndex);
            }

            if (rotateDate.length !== logRotateSuffixDateLength) {
                fallbackLog('error', `[rotate_file_writer.removeOldFiles] date suffix of old log file "${logFileName}" is invalid`);
                continue;
            }

            const rotateDateTime = DateTime.fromFormat(rotateDate, logRotateSuffixDateFormat);

            if (!rotateDateTime.isValid) {
                fallbackLog('error', `[rotate_file_writer.removeOldFiles] cannot parse rotate date of old log file "${logFileName}", because ${rotateDateTime.invalidReason}`);
                continue;
            }

            if (Math.floor(rotateDateTime.toSeconds()) >= retainMinUnixTime) {
                continue;
            }

            try {
                rmSync(join(dir, logFileName));
            } catch (err) {
                fallbackLog('error', `[rotate_file_writer.removeOldFiles] cannot remove old log file "${logFileName}", because ${(err as Error).message}`);
            }
        }
    }
}
