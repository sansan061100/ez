import type { Context } from '../core/context';
import * as errs from '../errs/index';
import * as log from '../log/index';
import { createNewCustomCsvBasicDataTable } from './csv';
import type { BasicDataTable } from './datatable';

export interface ExtractorOptions {
    logPrefix: string;
    fileHeader: string;
    // returns whether the row is the line before the data header (skipped) or data header itself (included)
    isDataHeaderStart: (firstColumn: string) => boolean;
    includeDataHeaderStartLine: boolean;
    trimItem: (item: string) => string;
}

// extractDataTable extracts the data lines after file header and data header start line (used by wechat pay / jd.com finance importers)
export function extractDataTable(ctx: Context, originalDataTable: BasicDataTable, options: ExtractorOptions): BasicDataTable {
    const iterator = originalDataTable.dataRowIterator();
    const allOriginalLines: string[][] = [];
    let hasFileHeader = false;
    let foundDataHeader = false;

    while (iterator.hasNext()) {
        const row = iterator.next();

        if (!row) {
            break;
        }

        if (!hasFileHeader) {
            if (row.columnCount() <= 0) {
                continue;
            } else if (row.getData(0).indexOf(options.fileHeader) === 0) {
                hasFileHeader = true;
                continue;
            } else {
                log.warnf(ctx, `[${options.logPrefix}] read unexpected line in row "${iterator.currentRowId()}" before read file header`);
                continue;
            }
        }

        if (!foundDataHeader) {
            if (row.columnCount() > 0 && options.isDataHeaderStart(row.getData(0))) {
                foundDataHeader = true;

                if (!options.includeDataHeaderStartLine) {
                    continue;
                }
            } else {
                continue;
            }
        }

        if (row.columnCount() <= 0) {
            continue;
        }

        const items: string[] = [];

        for (let i = 0; i < row.columnCount(); i++) {
            items.push(options.trimItem(row.getData(i)));
        }

        if (allOriginalLines.length > 0 && items.length < (allOriginalLines[0] as string[]).length) {
            log.errorf(ctx, `[${options.logPrefix}] cannot parse row "${iterator.currentRowId()}", because may missing some columns (column count ${items.length} in data row is less than header column count ${(allOriginalLines[0] as string[]).length})`);
            throw errs.ErrFewerFieldsInDataRowThanInHeaderRow;
        }

        allOriginalLines.push(items);
    }

    if (!hasFileHeader || !foundDataHeader) {
        throw errs.ErrInvalidFileHeader;
    }

    if (allOriginalLines.length < 2) {
        log.errorf(ctx, `[${options.logPrefix}] cannot parse import data, because data table row count is less 1`);
        throw errs.ErrNotFoundTransactionDataInFile;
    }

    return createNewCustomCsvBasicDataTable(allOriginalLines, true);
}

// trimSpaces trims the leading and trailing spaces like go strings.Trim(s, " ")
export function trimSpaces(s: string): string {
    return s.replace(/^ +| +$/g, '');
}
