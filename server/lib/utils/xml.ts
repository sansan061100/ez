import iconv from 'iconv-lite';

// Minimal non-validating xml parser which builds an element tree, used to emulate go encoding/xml unmarshalling

export interface XmlElement {
    name: string; // local name without namespace prefix
    fullName: string;
    attrs: Record<string, string>; // key is local name
    children: XmlElement[];
    text: string; // direct character data (including CDATA)
    parent: XmlElement | null;
}

export class XmlSyntaxError extends Error {
    public constructor(message: string, line: number) {
        super(`XML syntax error on line ${line}: ${message}`);
        this.name = 'XmlSyntaxError';
    }
}

function localName(name: string): string {
    const index = name.indexOf(':');
    return index >= 0 ? name.substring(index + 1) : name;
}

const namedEntities: Record<string, string> = {
    lt: '<',
    gt: '>',
    amp: '&',
    quot: '"',
    apos: '\'',
};

function decodeEntities(text: string, lineOf: () => number): string {
    if (!text.includes('&')) {
        return text;
    }

    return text.replace(/&([^;&\s]*);?/g, (match: string, entity: string) => {
        if (!match.endsWith(';')) {
            throw new XmlSyntaxError('invalid character entity ' + match, lineOf());
        }

        if (entity.startsWith('#x') || entity.startsWith('#X')) {
            const code = parseInt(entity.substring(2), 16);

            if (isNaN(code)) {
                throw new XmlSyntaxError(`invalid character entity &${entity};`, lineOf());
            }

            return String.fromCodePoint(code);
        } else if (entity.startsWith('#')) {
            const code = parseInt(entity.substring(1), 10);

            if (isNaN(code)) {
                throw new XmlSyntaxError(`invalid character entity &${entity};`, lineOf());
            }

            return String.fromCodePoint(code);
        }

        const value = namedEntities[entity];

        if (value === undefined) {
            throw new XmlSyntaxError(`invalid character entity &${entity};`, lineOf());
        }

        return value;
    });
}

// decodeXmlContent decodes the xml content bytes according to the encoding declared in xml header
export function decodeXmlContent(content: Buffer | string): string {
    if (typeof content === 'string') {
        return content;
    }

    let text = content;

    if (text.length >= 3 && text[0] === 0xef && text[1] === 0xbb && text[2] === 0xbf) {
        text = text.subarray(3);
    }

    const head = text.subarray(0, 200).toString('latin1');
    const match = /^\s*<\?xml[^>]*encoding\s*=\s*["']([^"']+)["']/i.exec(head);

    if (match && match[1]) {
        const encoding = match[1].toLowerCase();

        if (encoding !== 'utf-8' && encoding !== 'utf8') {
            if (!iconv.encodingExists(encoding)) {
                throw new Error(`xml: encoding "${match[1]}" declared but Decoder.CharsetReader is nil`);
            }

            return iconv.decode(text, encoding);
        }
    }

    return text.toString('utf8');
}

// parseXml parses the xml document and returns the root element
export function parseXml(content: Buffer | string): XmlElement {
    const xml = decodeXmlContent(content);
    let pos = 0;
    const stack: XmlElement[] = [];
    let root: XmlElement | null = null;

    const lineOf = (): number => {
        let line = 1;

        for (let i = 0; i < pos && i < xml.length; i++) {
            if (xml.charCodeAt(i) === 10) {
                line++;
            }
        }

        return line;
    };

    const appendText = (text: string): void => {
        const current = stack[stack.length - 1];

        if (current) {
            current.text += text;
        } else if (text.trim() !== '') {
            if (root) {
                // text after root element is ignored like go decoder after first element
                return;
            }

            throw new XmlSyntaxError('unexpected character data outside of root element', lineOf());
        }
    };

    while (pos < xml.length) {
        const lt = xml.indexOf('<', pos);

        if (lt < 0) {
            appendText(decodeEntities(xml.substring(pos), lineOf));
            break;
        }

        if (lt > pos) {
            appendText(decodeEntities(xml.substring(pos, lt), lineOf));
        }

        pos = lt;

        if (xml.startsWith('<!--', pos)) {
            const end = xml.indexOf('-->', pos + 4);

            if (end < 0) {
                throw new XmlSyntaxError('unexpected EOF in comment', lineOf());
            }

            pos = end + 3;
        } else if (xml.startsWith('<![CDATA[', pos)) {
            const end = xml.indexOf(']]>', pos + 9);

            if (end < 0) {
                throw new XmlSyntaxError('unexpected EOF in CDATA section', lineOf());
            }

            appendText(xml.substring(pos + 9, end));
            pos = end + 3;
        } else if (xml.startsWith('<?', pos)) {
            const end = xml.indexOf('?>', pos + 2);

            if (end < 0) {
                throw new XmlSyntaxError('unexpected EOF', lineOf());
            }

            pos = end + 2;
        } else if (xml.startsWith('<!', pos)) {
            // DOCTYPE or other declarations, skip with nested brackets
            let depth = 0;
            let i = pos;

            for (; i < xml.length; i++) {
                const ch = xml[i];

                if (ch === '<') {
                    depth++;
                } else if (ch === '>') {
                    depth--;

                    if (depth === 0) {
                        break;
                    }
                }
            }

            pos = i + 1;
        } else if (xml.startsWith('</', pos)) {
            const end = xml.indexOf('>', pos);

            if (end < 0) {
                throw new XmlSyntaxError('unexpected EOF', lineOf());
            }

            const name = xml.substring(pos + 2, end).trim();
            const current = stack.pop();

            if (!current) {
                throw new XmlSyntaxError(`unexpected end element </${name}>`, lineOf());
            }

            if (current.fullName !== name) {
                throw new XmlSyntaxError(`element <${current.fullName}> closed by </${name}>`, lineOf());
            }

            pos = end + 1;

            if (stack.length === 0 && root) {
                // go decoder stops after the first root element
                break;
            }
        } else {
            // start element
            let i = pos + 1;

            while (i < xml.length && !/[\s/>]/.test(xml[i] as string)) {
                i++;
            }

            const name = xml.substring(pos + 1, i);

            if (name === '') {
                throw new XmlSyntaxError('expected element name after <', lineOf());
            }

            const element: XmlElement = {
                name: localName(name),
                fullName: name,
                attrs: {},
                children: [],
                text: '',
                parent: stack[stack.length - 1] ?? null,
            };

            let selfClosing = false;

            while (true) {
                while (i < xml.length && /\s/.test(xml[i] as string)) {
                    i++;
                }

                if (i >= xml.length) {
                    throw new XmlSyntaxError('unexpected EOF', lineOf());
                }

                if (xml[i] === '>') {
                    i++;
                    break;
                }

                if (xml[i] === '/' && xml[i + 1] === '>') {
                    selfClosing = true;
                    i += 2;
                    break;
                }

                let nameEnd = i;

                while (nameEnd < xml.length && !/[\s=/>]/.test(xml[nameEnd] as string)) {
                    nameEnd++;
                }

                const attrName = xml.substring(i, nameEnd);
                i = nameEnd;

                while (i < xml.length && /\s/.test(xml[i] as string)) {
                    i++;
                }

                if (xml[i] !== '=') {
                    throw new XmlSyntaxError('attribute name without = in element', lineOf());
                }

                i++;

                while (i < xml.length && /\s/.test(xml[i] as string)) {
                    i++;
                }

                const quote = xml[i];

                if (quote !== '"' && quote !== '\'') {
                    throw new XmlSyntaxError('unquoted or missing attribute value in element', lineOf());
                }

                const valueEnd = xml.indexOf(quote, i + 1);

                if (valueEnd < 0) {
                    throw new XmlSyntaxError('unexpected EOF', lineOf());
                }

                const attrValue = decodeEntities(xml.substring(i + 1, valueEnd), lineOf);
                i = valueEnd + 1;

                if (!attrName.startsWith('xmlns')) {
                    const key = localName(attrName);

                    if (!(key in element.attrs)) {
                        element.attrs[key] = attrValue;
                    }
                }
            }

            const parent = stack[stack.length - 1];

            if (parent) {
                parent.children.push(element);
            } else if (!root) {
                root = element;
            } else {
                break;
            }

            pos = i;

            if (!selfClosing) {
                stack.push(element);
            } else if (stack.length === 0) {
                break;
            }
        }
    }

    if (!root) {
        throw new Error('EOF');
    }

    if (stack.length > 0) {
        throw new XmlSyntaxError('unexpected EOF', lineOf());
    }

    return root;
}

// xmlChildren returns the child elements with the specified local name
export function xmlChildren(element: XmlElement | null | undefined, name: string): XmlElement[] {
    if (!element) {
        return [];
    }

    return element.children.filter(child => child.name === name);
}

// xmlFind returns the elements by path like go xml struct tag "a>b>c" (relative to the element)
export function xmlFind(element: XmlElement | null | undefined, path: string): XmlElement[] {
    if (!element) {
        return [];
    }

    let current: XmlElement[] = [element];

    for (const part of path.split('>')) {
        const next: XmlElement[] = [];

        for (const item of current) {
            next.push(...xmlChildren(item, part));
        }

        current = next;
    }

    return current;
}

// xmlFirst returns the first element by path
export function xmlFirst(element: XmlElement | null | undefined, path: string): XmlElement | null {
    return xmlFind(element, path)[0] ?? null;
}

// xmlText returns the character data of the first element by path, or empty string if not exists
export function xmlText(element: XmlElement | null | undefined, path: string): string {
    const found = xmlFind(element, path);

    // go encoding/xml overwrites the field value by the last matched element for string field
    const last = found[found.length - 1];
    return last ? last.text : '';
}

// xmlAttr returns the attribute value of element, or empty string if not exists
export function xmlAttr(element: XmlElement | null | undefined, name: string): string {
    return element?.attrs[name] ?? '';
}
