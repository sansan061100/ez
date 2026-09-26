// Go encoding/csv compatible reader (FieldsPerRecord = -1, LazyQuotes = false, TrimLeadingSpace = false)

export class GoCsvParseError extends Error {
    public constructor(line: number, column: number, message: string) {
        super(`parse error on line ${line}, column ${column}: ${message}`);
        this.name = 'GoCsvParseError';
    }
}

export interface GoCsvReaderOptions {
    comma?: string;
    lazyQuotes?: boolean;
    trimLeadingSpace?: boolean;
    comment?: string;
}

// readAllGoCsv reads all records like go csv.Reader.ReadAll
export function readAllGoCsv(content: string, options: GoCsvReaderOptions = {}): string[][] {
    const comma = options.comma ?? ',';
    const lazyQuotes = options.lazyQuotes ?? false;
    const trimLeadingSpace = options.trimLeadingSpace ?? false;
    const comment = options.comment ?? '';
    const records: string[][] = [];

    let pos = 0;
    let lineNum = 0;

    // readLine reads the next line including "\n", normalizing trailing "\r\n" to "\n"
    const readLine = (): string | null => {
        if (pos >= content.length) {
            return null;
        }

        const index = content.indexOf('\n', pos);
        let line: string;

        if (index < 0) {
            line = content.substring(pos);
            pos = content.length;

            // go adds a trailing newline when the last line has no newline
            if (line.length > 0 && line.endsWith('\r')) {
                line = line.substring(0, line.length - 1);
            }

            line += '\n';
        } else {
            line = content.substring(pos, index + 1);
            pos = index + 1;
        }

        lineNum++;

        if (line.length >= 2 && line[line.length - 2] === '\r' && line[line.length - 1] === '\n') {
            line = line.substring(0, line.length - 2) + '\n';
        }

        return line;
    };

    while (true) {
        let line = readLine();

        if (line === null) {
            break;
        }

        if (comment !== '' && line.startsWith(comment)) {
            continue;
        }

        // skip empty lines
        if (line === '\n') {
            continue;
        }

        const recordLine = lineNum;
        const fields: string[] = [];
        let fieldBuffer = '';
        let parseDone = false;

        while (!parseDone) {
            if (trimLeadingSpace) {
                line = line.replace(/^[\s]+/u, (match: string) => match.includes('\n') ? match.substring(match.indexOf('\n')) : '');
            }

            if (line.length === 0 || line[0] !== '"') {
                // non-quoted string field
                const index = line.indexOf(comma);
                let field: string;

                if (index >= 0) {
                    field = line.substring(0, index);
                } else {
                    field = line.substring(0, line.length - (line.endsWith('\n') ? 1 : 0));
                }

                if (!lazyQuotes) {
                    const quoteIndex = field.indexOf('"');

                    if (quoteIndex >= 0) {
                        throw new GoCsvParseError(recordLine, quoteIndex + 1, 'bare " in non-quoted-field');
                    }
                }

                fields.push(field);

                if (index >= 0) {
                    line = line.substring(index + comma.length);
                    continue;
                }

                parseDone = true;
            } else {
                // quoted string field
                const fieldStartLine = lineNum;
                line = line.substring(1);
                fieldBuffer = '';

                while (true) {
                    const quoteIndex = line.indexOf('"');

                    if (quoteIndex >= 0) {
                        fieldBuffer += line.substring(0, quoteIndex);
                        line = line.substring(quoteIndex + 1);
                        const next = line[0];

                        if (next === '"') {
                            // "" sequence (append quote)
                            fieldBuffer += '"';
                            line = line.substring(1);
                        } else if (line.startsWith(comma)) {
                            // " delimiter
                            line = line.substring(comma.length);
                            fields.push(fieldBuffer);
                            break;
                        } else if (line === '\n' || line.length === 0) {
                            // " newline
                            fields.push(fieldBuffer);
                            parseDone = true;
                            break;
                        } else if (lazyQuotes) {
                            fieldBuffer += '"';
                        } else {
                            throw new GoCsvParseError(lineNum, 0, 'extraneous or missing " in quoted-field');
                        }
                    } else if (line.length > 0) {
                        // hit end of line (copy all data so far)
                        fieldBuffer += line;
                        const nextLine = readLine();

                        if (nextLine === null) {
                            if (!lazyQuotes) {
                                throw new GoCsvParseError(fieldStartLine, 0, 'extraneous or missing " in quoted-field');
                            }

                            fields.push(fieldBuffer);
                            parseDone = true;
                            break;
                        }

                        line = nextLine;
                    } else {
                        // abrupt end of file
                        if (!lazyQuotes) {
                            throw new GoCsvParseError(fieldStartLine, 0, 'extraneous or missing " in quoted-field');
                        }

                        fields.push(fieldBuffer);
                        parseDone = true;
                        break;
                    }
                }
            }
        }

        records.push(fields);
    }

    return records;
}
