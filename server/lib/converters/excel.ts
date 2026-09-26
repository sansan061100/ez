import * as XLSX from 'xlsx';

import * as errs from '../errs/index';
import type { BasicDataTable, BasicDataTableRow, BasicDataTableRowIterator } from './datatable';

// ExcelSheet represents the parsed sheet data, rows are null when not exists (only for xls file)
interface ExcelSheet {
    sheetName: string;
    rows: (string[] | null)[];
}

function getCellText(cell: XLSX.CellObject | undefined): string {
    if (!cell) {
        return '';
    }

    if (cell.w !== undefined) {
        return cell.w;
    }

    if (cell.v === undefined || cell.v === null) {
        return '';
    }

    if (cell.v instanceof Date) {
        return cell.v.toISOString();
    }

    return String(cell.v);
}

// readSheets reads all sheets of the workbook, trailing empty cells in each row are removed
function readSheets(data: Buffer, trimTrailingEmptyRows: boolean): ExcelSheet[] {
    const workbook = XLSX.read(data, { type: 'buffer', cellDates: false, sheetStubs: true, dense: false });
    const sheets: ExcelSheet[] = [];

    for (const sheetName of workbook.SheetNames) {
        const worksheet = workbook.Sheets[sheetName];
        const rows: (string[] | null)[] = [];

        if (worksheet && worksheet['!ref']) {
            const range = XLSX.utils.decode_range(worksheet['!ref']);

            for (let r = 0; r <= range.e.r; r++) {
                let rowExists = false;
                const row: string[] = [];

                for (let c = 0; c <= range.e.c; c++) {
                    const cell = worksheet[XLSX.utils.encode_cell({ r: r, c: c })] as XLSX.CellObject | undefined;

                    if (cell) {
                        rowExists = true;
                    }

                    row.push(getCellText(cell));
                }

                while (row.length > 0 && row[row.length - 1] === '') {
                    row.pop();
                }

                rows.push(rowExists ? row : null);
            }
        }

        if (trimTrailingEmptyRows) {
            while (rows.length > 0) {
                const last = rows[rows.length - 1];

                if (last && last.length > 0) {
                    break;
                }

                rows.pop();
            }
        }

        sheets.push({ sheetName: sheetName, rows: rows });
    }

    return sheets;
}

// the CFB container api of SheetJS (not detected as a named export of the commonjs build)
const CFB = ((XLSX as unknown as { CFB?: typeof XLSX.CFB; default?: { CFB: typeof XLSX.CFB } }).CFB ?? (XLSX as unknown as { default: { CFB: typeof XLSX.CFB } }).default.CFB);

const cfbFileSignature = Buffer.from([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]);
const zipFileSignature = Buffer.from([0x50, 0x4B, 0x03, 0x04]);

// BiffSheetStructure represents the row structure of a xls worksheet (same as the github.com/extrame/xls library)
interface BiffSheetStructure {
    maxRow: number;
    rowLastCols: Map<number, number>;
}

// readBiffSheetStructures scans the BIFF records of the workbook stream to get the rows and the last column of each row,
// the rules are the same as the github.com/extrame/xls library used by the original program
function readBiffSheetStructures(data: Buffer): BiffSheetStructure[] {
    const cfb = CFB.read(data, { type: 'buffer' });
    const entry = CFB.find(cfb, 'Book') ?? CFB.find(cfb, 'Workbook');

    if (!entry || !entry.content) {
        return [];
    }

    const stream = Buffer.from(entry.content as Uint8Array);
    const sheetPositions: number[] = [];
    let pos = 0;

    while (pos + 4 <= stream.length) {
        const id = stream.readUInt16LE(pos);
        const size = stream.readUInt16LE(pos + 2);
        const body = pos + 4;

        if (id === 0x85 && body + 4 <= stream.length) {
            sheetPositions.push(stream.readUInt32LE(body));
        } else if (id === 0x0A) {
            break;
        }

        pos = body + size;
    }

    const structures: BiffSheetStructure[] = [];

    for (const sheetPosition of sheetPositions) {
        const structure: BiffSheetStructure = { maxRow: 0, rowLastCols: new Map() };
        const addRow = (rowIndex: number, lastCol: number): void => {
            if (rowIndex > structure.maxRow) {
                structure.maxRow = rowIndex;
            }

            structure.rowLastCols.set(rowIndex, lastCol);
        };
        const addContent = (rowIndex: number, lastCol: number): void => {
            if (!structure.rowLastCols.has(rowIndex)) {
                addRow(rowIndex, 0);
            }

            if ((structure.rowLastCols.get(rowIndex) ?? 0) < lastCol) {
                structure.rowLastCols.set(rowIndex, lastCol);
            }
        };

        let previousFormula: [number, number] | null = null;
        pos = sheetPosition;

        while (pos + 4 <= stream.length) {
            const id = stream.readUInt16LE(pos);
            const size = stream.readUInt16LE(pos + 2);
            const body = pos + 4;
            const u16 = (offset: number): number => (body + offset + 2 <= stream.length ? stream.readUInt16LE(body + offset) : 0);
            let currentFormula: [number, number] | null = null;

            switch (id) {
                case 0x208: // ROW
                    addRow(u16(0), u16(4));
                    break;
                case 0x0BD: // MULRK
                case 0x0BE: // MULBLANK
                    addContent(u16(0), u16(size - 2));
                    break;
                case 0x06: // FORMULA
                    currentFormula = [u16(0), u16(2)];
                    addContent(u16(0), u16(2));
                    break;
                case 0x207: // STRING
                    if (previousFormula) {
                        addContent(previousFormula[0], previousFormula[1]);
                    }
                    break;
                case 0x203: // NUMBER
                case 0x27E: // RK
                case 0xFD: // LABELSST
                case 0x204: // LABEL
                case 0x201: // BLANK
                    addContent(u16(0), u16(2));
                    break;
                case 0x1B8: { // HYPERLINK
                    const firstRow = u16(0);
                    const lastRow = u16(2);
                    const lastCol = u16(6);

                    for (let row = firstRow; row <= lastRow; row++) {
                        addContent(row, lastCol);
                    }
                    break;
                }
                default:
                    break;
            }

            previousFormula = currentFormula;
            pos = body + size;

            if (id === 0x0A) {
                break;
            }
        }

        structures.push(structure);
    }

    return structures;
}

// readMSCFBSheets reads all sheets of the xls workbook with the same row structure as the original program
function readMSCFBSheets(data: Buffer): ExcelSheet[] {
    if (data.length < cfbFileSignature.length || !data.subarray(0, cfbFileSignature.length).equals(cfbFileSignature)) {
        throw new Error('not an excel file');
    }

    const workbook = XLSX.read(data, { type: 'buffer', cellDates: false, sheetStubs: true, dense: false });
    const structures = readBiffSheetStructures(data);
    const sheets: ExcelSheet[] = [];

    for (let i = 0; i < structures.length; i++) {
        const structure = structures[i] as BiffSheetStructure;
        const sheetName = workbook.SheetNames[i] ?? '';
        const worksheet = sheetName !== '' ? workbook.Sheets[sheetName] : undefined;
        const rows: (string[] | null)[] = [];

        for (let r = 0; r <= structure.maxRow; r++) {
            const lastCol = structure.rowLastCols.get(r);

            if (lastCol === undefined) {
                rows.push(null);
                continue;
            }

            const row: string[] = [];

            for (let c = 0; c < lastCol; c++) {
                const cell = worksheet ? worksheet[XLSX.utils.encode_cell({ r: r, c: c })] as XLSX.CellObject | undefined : undefined;
                row.push(getCellText(cell));
            }

            rows.push(row);
        }

        sheets.push({ sheetName: sheetName, rows: rows });
    }

    return sheets;
}

function newRow(rowData: string[]): BasicDataTableRow {
    return {
        columnCount: () => rowData.length,
        getData: (columnIndex: number) => (columnIndex >= 0 && columnIndex < rowData.length ? rowData[columnIndex] as string : ''),
    };
}

// ExcelOOXMLFileBasicDataTable defines the structure of excel (xlsx) file data table
class ExcelOOXMLFileBasicDataTable implements BasicDataTable {
    public constructor(private readonly sheets: string[][][], private readonly headerLineColumnNames: string[], private readonly hasTitleLine: boolean) {
    }

    public dataRowCount(): number {
        let total = 0;

        for (const sheet of this.sheets) {
            if (sheet.length < 1) {
                continue;
            }

            total += this.hasTitleLine ? sheet.length - 1 : sheet.length;
        }

        return total;
    }

    public headerColumnNames(): string[] {
        return this.hasTitleLine ? this.headerLineColumnNames : [];
    }

    public dataRowIterator(): BasicDataTableRowIterator {
        let currentSheetIndex = 0;
        let currentRowIndexInSheet = this.hasTitleLine ? 0 : -1;
        const sheets = this.sheets;
        const hasTitleLine = this.hasTitleLine;

        return {
            hasNext: (): boolean => {
                if (currentSheetIndex >= sheets.length) {
                    return false;
                }

                if (currentRowIndexInSheet + 1 < (sheets[currentSheetIndex] as string[][]).length) {
                    return true;
                }

                for (let i = currentSheetIndex + 1; i < sheets.length; i++) {
                    const length = (sheets[i] as string[][]).length;

                    if (hasTitleLine ? length <= 1 : length <= 0) {
                        continue;
                    }

                    return true;
                }

                return false;
            },
            currentRowId: () => `sheet#${currentSheetIndex}-row#${currentRowIndexInSheet}`,
            next: (): BasicDataTableRow | null => {
                for (let i = currentSheetIndex; i < sheets.length; i++) {
                    if (currentRowIndexInSheet + 1 < (sheets[i] as string[][]).length) {
                        currentRowIndexInSheet++;
                        break;
                    }

                    currentSheetIndex++;
                    currentRowIndexInSheet = hasTitleLine ? 0 : -1;
                }

                if (currentSheetIndex >= sheets.length) {
                    return null;
                }

                const currentSheet = sheets[currentSheetIndex] as string[][];

                if (currentRowIndexInSheet >= currentSheet.length) {
                    return null;
                }

                return newRow(currentSheet[currentRowIndexInSheet] as string[]);
            },
        };
    }
}

function readHeaderItems(row: string[]): string[] {
    const items: string[] = [];

    for (const headerItem of row) {
        if (headerItem === '') {
            break;
        }

        items.push(headerItem);
    }

    return items;
}

// readOOXMLSheets reads all sheets of the xlsx workbook, the original program panics (system error) when the file cannot be opened
function readOOXMLSheets(data: Buffer): ExcelSheet[] {
    if (data.length < zipFileSignature.length || !data.subarray(0, zipFileSignature.length).equals(zipFileSignature)) {
        throw errs.ErrSystemError;
    }

    try {
        return readSheets(data, true);
    } catch (err) {
        throw err instanceof errs.AppError ? err : errs.ErrSystemError;
    }
}

// createNewExcelOOXMLFileBasicDataTable returns excel (xlsx) data table by file binary data, all sheets are merged
export function createNewExcelOOXMLFileBasicDataTable(data: Buffer, hasTitleLine: boolean): BasicDataTable {
    const allSheets = readOOXMLSheets(data);
    let firstRowItems: string[] = [];
    const sheets: string[][][] = [];

    for (let i = 0; i < allSheets.length; i++) {
        const allData = (allSheets[i] as ExcelSheet).rows.map(row => row ?? []);

        if (allData.length < 1) {
            continue;
        }

        const row = allData[0] as string[];

        if (hasTitleLine) {
            if (i === 0) {
                firstRowItems = readHeaderItems(row);
            } else {
                for (let j = 0; j < Math.min(row.length, firstRowItems.length); j++) {
                    if (row[j] !== firstRowItems[j]) {
                        throw errs.ErrFieldsInMultiTableAreDifferent;
                    }
                }
            }
        }

        sheets.push(allData);
    }

    return new ExcelOOXMLFileBasicDataTable(sheets, hasTitleLine ? firstRowItems : [], hasTitleLine);
}

// createNewExcelOOXMLFileBasicDataTables returns excel (xlsx) data tables by file binary data, one table for each sheet
export function createNewExcelOOXMLFileBasicDataTables(data: Buffer, hasTitleLine: boolean): BasicDataTable[] {
    const allSheets = readOOXMLSheets(data);
    const dataTables: BasicDataTable[] = [];

    for (const sheet of allSheets) {
        const allData = sheet.rows.map(row => row ?? []);

        if (allData.length < 1) {
            continue;
        }

        const headerLineColumnNames = hasTitleLine ? readHeaderItems(allData[0] as string[]) : [];
        dataTables.push(new ExcelOOXMLFileBasicDataTable([allData], headerLineColumnNames, hasTitleLine));
    }

    return dataTables;
}

// ExcelMSCFBFileBasicDataTable defines the structure of excel (xls) file data table
class ExcelMSCFBFileBasicDataTable implements BasicDataTable {
    public constructor(private readonly sheets: ExcelSheet[], private readonly headerLineColumnNames: string[], private readonly hasTitleLine: boolean) {
    }

    private static maxRow(sheet: ExcelSheet): number {
        return sheet.rows.length - 1;
    }

    private static row(sheet: ExcelSheet, index: number): string[] | null {
        return index >= 0 && index < sheet.rows.length ? sheet.rows[index] ?? null : null;
    }

    private static isEmptySheet(sheet: ExcelSheet, hasTitleLine: boolean): boolean {
        const maxRow = ExcelMSCFBFileBasicDataTable.maxRow(sheet);
        return hasTitleLine ? maxRow < 1 : (maxRow <= 0 && ExcelMSCFBFileBasicDataTable.row(sheet, 0) === null);
    }

    public dataRowCount(): number {
        let total = 0;

        for (const sheet of this.sheets) {
            if (ExcelMSCFBFileBasicDataTable.isEmptySheet(sheet, this.hasTitleLine)) {
                continue;
            }

            const maxRow = ExcelMSCFBFileBasicDataTable.maxRow(sheet);
            total += this.hasTitleLine ? maxRow : maxRow + 1;
        }

        return total;
    }

    public headerColumnNames(): string[] {
        return this.hasTitleLine ? this.headerLineColumnNames : [];
    }

    public dataRowIterator(): BasicDataTableRowIterator {
        let currentSheetIndex = 0;
        let currentRowIndexInSheet = this.hasTitleLine ? 0 : -1;
        const sheets = this.sheets;
        const hasTitleLine = this.hasTitleLine;
        const maxRow = ExcelMSCFBFileBasicDataTable.maxRow;
        const rowOf = ExcelMSCFBFileBasicDataTable.row;

        return {
            hasNext: (): boolean => {
                if (currentSheetIndex >= sheets.length) {
                    return false;
                }

                const currentSheet = sheets[currentSheetIndex] as ExcelSheet;

                if (currentRowIndexInSheet + 1 <= maxRow(currentSheet) && rowOf(currentSheet, currentRowIndexInSheet + 1) !== null) {
                    return true;
                }

                for (let i = currentSheetIndex + 1; i < sheets.length; i++) {
                    if (ExcelMSCFBFileBasicDataTable.isEmptySheet(sheets[i] as ExcelSheet, hasTitleLine)) {
                        continue;
                    }

                    return true;
                }

                return false;
            },
            currentRowId: () => `sheet#${currentSheetIndex}-row#${currentRowIndexInSheet}`,
            next: (): BasicDataTableRow | null => {
                for (let i = currentSheetIndex; i < sheets.length; i++) {
                    const sheet = sheets[i] as ExcelSheet;

                    if (currentRowIndexInSheet + 1 <= maxRow(sheet) && rowOf(sheet, currentRowIndexInSheet + 1) !== null) {
                        currentRowIndexInSheet++;
                        break;
                    }

                    currentSheetIndex++;
                    currentRowIndexInSheet = hasTitleLine ? 0 : -1;
                }

                if (currentSheetIndex >= sheets.length) {
                    return null;
                }

                const currentSheet = sheets[currentSheetIndex] as ExcelSheet;
                const row = rowOf(currentSheet, currentRowIndexInSheet);

                if (currentRowIndexInSheet > maxRow(currentSheet) || row === null) {
                    return null;
                }

                return newRow(row);
            },
        };
    }
}

// createNewExcelMSCFBFileBasicDataTable returns excel (xls) data table by file binary data, all sheets are merged
export function createNewExcelMSCFBFileBasicDataTable(data: Buffer, hasTitleLine: boolean): BasicDataTable {
    const allSheets = readMSCFBSheets(data);
    let firstRowItems: string[] = [];
    const sheets: ExcelSheet[] = [];

    for (let i = 0; i < allSheets.length; i++) {
        const sheet = allSheets[i] as ExcelSheet;
        const row = sheet.rows[0] ?? null;

        if (row === null) {
            continue;
        }

        if (hasTitleLine) {
            if (i === 0) {
                firstRowItems = readHeaderItems(row);
            } else {
                for (let j = 0; j < Math.min(row.length, firstRowItems.length); j++) {
                    if (row[j] !== firstRowItems[j]) {
                        throw errs.ErrFieldsInMultiTableAreDifferent;
                    }
                }
            }
        }

        sheets.push(sheet);
    }

    return new ExcelMSCFBFileBasicDataTable(sheets, hasTitleLine ? firstRowItems : [], hasTitleLine);
}

// createNewExcelMSCFBFileBasicDataTables returns excel (xls) data tables by file binary data, one table for each sheet
export function createNewExcelMSCFBFileBasicDataTables(data: Buffer, hasTitleLine: boolean): BasicDataTable[] {
    const allSheets = readMSCFBSheets(data);
    const dataTables: BasicDataTable[] = [];

    for (const sheet of allSheets) {
        const row = sheet.rows[0] ?? null;

        if (row === null) {
            continue;
        }

        const headerLineColumnNames = hasTitleLine ? readHeaderItems(row) : [];
        dataTables.push(new ExcelMSCFBFileBasicDataTable([sheet], headerLineColumnNames, hasTitleLine));
    }

    return dataTables;
}
