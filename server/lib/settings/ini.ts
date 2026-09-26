import { readFileSync } from 'node:fs';

// IniFile is a minimal ini parser compatible with the subset of go-ini used by ezBookkeeping (IgnoreInlineComment = true)
export class IniFile {
    private readonly sections = new Map<string, Map<string, string>>();

    public static load(filePath: string): IniFile {
        return IniFile.parse(readFileSync(filePath, 'utf8'));
    }

    public static parse(content: string): IniFile {
        const file = new IniFile();
        let currentSection = 'DEFAULT';
        const lines = content.replace(/^﻿/, '').split(/\r?\n/);

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i]!.trim();

            if (line === '' || line.startsWith(';') || line.startsWith('#')) {
                continue;
            }

            if (line.startsWith('[')) {
                const end = line.indexOf(']');

                if (end > 0) {
                    currentSection = line.substring(1, end).trim();
                    file.getOrCreateSection(currentSection);
                }

                continue;
            }

            const eqIndex = findKeyValueDelimiter(line);

            if (eqIndex < 0) {
                file.getOrCreateSection(currentSection).set(line, '');
                continue;
            }

            const key = line.substring(0, eqIndex).trim().replace(/^[`"]|[`"]$/g, '');
            let value = line.substring(eqIndex + 1).trim();

            if (value.startsWith('"""')) {
                // multi-line value
                let multiLine = value.substring(3);
                let closed = false;

                if (multiLine.endsWith('"""')) {
                    multiLine = multiLine.substring(0, multiLine.length - 3);
                    closed = true;
                }

                while (!closed && i + 1 < lines.length) {
                    i++;
                    const next = lines[i]!;

                    if (next.trimEnd().endsWith('"""')) {
                        multiLine += '\n' + next.trimEnd().substring(0, next.trimEnd().length - 3);
                        closed = true;
                    } else {
                        multiLine += '\n' + next;
                    }
                }

                value = multiLine;
            } else if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith('`') && value.endsWith('`')))) {
                value = value.substring(1, value.length - 1);
            } else if (value.endsWith('\\')) {
                // line continuation
                while (value.endsWith('\\') && i + 1 < lines.length) {
                    i++;
                    value = value.substring(0, value.length - 1) + lines[i]!.trim();
                }
            }

            file.getOrCreateSection(currentSection).set(key, value);
        }

        return file;
    }

    public hasKey(section: string, key: string): boolean {
        return this.sections.get(section)?.has(key) ?? false;
    }

    public getValue(section: string, key: string): string {
        return this.sections.get(section)?.get(key) ?? '';
    }

    private getOrCreateSection(name: string): Map<string, string> {
        let section = this.sections.get(name);

        if (!section) {
            section = new Map();
            this.sections.set(name, section);
        }

        return section;
    }
}

function findKeyValueDelimiter(line: string): number {
    const eq = line.indexOf('=');
    const colon = line.indexOf(':');

    if (eq < 0) {
        return colon;
    }

    if (colon < 0) {
        return eq;
    }

    return Math.min(eq, colon);
}
