import type { Context } from '../core/context';
import * as errs from '../errs/index';
import * as log from '../log/index';
import { readAllGoCsv } from '../utils/gocsv';
import type { BasicDataTable, BasicDataTableRow, BasicDataTableRowIterator } from './datatable';

// CsvFileBasicDataTable defines the structure of csv data table
export class CsvFileBasicDataTable implements BasicDataTable {
    public constructor(private readonly allLines: string[][], private readonly hasTitleLine: boolean) {
    }

    public dataRowCount(): number {
        if (this.allLines.length < 1) {
            return 0;
        }

        return this.hasTitleLine ? this.allLines.length - 1 : this.allLines.length;
    }

    public headerColumnNames(): string[] {
        if (this.allLines.length < 1 || !this.hasTitleLine) {
            return [];
        }

        return this.allLines[0] as string[];
    }

    public dataRowIterator(): BasicDataTableRowIterator {
        let currentIndex = this.hasTitleLine ? 0 : -1;

        return {
            hasNext: () => currentIndex + 1 < this.allLines.length,
            currentRowId: () => `line#${currentIndex}`,
            next: (): BasicDataTableRow | null => {
                if (currentIndex + 1 >= this.allLines.length) {
                    return null;
                }

                currentIndex++;
                return newBasicDataTableRow(this.allLines[currentIndex] as string[]);
            },
        };
    }
}

// newBasicDataTableRow returns a basic data table row by items
export function newBasicDataTableRow(allItems: string[]): BasicDataTableRow {
    return {
        columnCount: () => allItems.length,
        getData: (columnIndex: number) => (columnIndex < allItems.length ? allItems[columnIndex] as string : ''),
    };
}

// createNewCsvBasicDataTable returns comma separated values data table by csv content
export function createNewCsvBasicDataTable(ctx: Context, content: string, hasTitleLine: boolean): BasicDataTable {
    return createNewCsvFileBasicDataTable(ctx, content, ',', hasTitleLine);
}

// createNewCustomCsvBasicDataTable returns data table by parsed lines
export function createNewCustomCsvBasicDataTable(allLines: string[][], hasTitleLine: boolean): BasicDataTable {
    return new CsvFileBasicDataTable(allLines, hasTitleLine);
}

// createNewCsvFileBasicDataTable parses the csv content by the separator
export function createNewCsvFileBasicDataTable(ctx: Context, content: string, separator: string, hasTitleLine: boolean): CsvFileBasicDataTable {
    let records: string[][];

    try {
        records = readAllGoCsv(content, { comma: separator });
    } catch (err) {
        log.errorf(ctx, `[csv_file_basic_data_table.createNewCsvFileDataTable] cannot parse csv data, because ${(err as Error).message}`);
        throw errs.ErrInvalidCSVFile;
    }

    const allLines = records.filter(items => !(items.length === 1 && items[0] === ''));
    return new CsvFileBasicDataTable(allLines, hasTitleLine);
}
