import * as errs from '../errs/index';
import { type XmlElement, xmlFind } from '../utils/xml';

// Schema based decoders emulating the go sgml decoder in ezbookkeeping and go encoding/xml unmarshalling

export type FieldSpec =
    | { kind: 'text' }
    | { kind: 'textSlice' }
    | { kind: 'struct'; schema: DecodeSchema }
    | { kind: 'slice'; schema: DecodeSchema };

// DecodeSchema maps the element name (or path like "A>B", "@attr", "#text" for xml) to the object key and field spec
export type DecodeSchema = Record<string, [string, FieldSpec]>;

export type DecodedObject = Record<string, unknown>;

export const textField: FieldSpec = { kind: 'text' };
export const textSliceField: FieldSpec = { kind: 'textSlice' };

export function structField(schema: DecodeSchema): FieldSpec {
    return { kind: 'struct', schema: schema };
}

export function sliceField(schema: DecodeSchema): FieldSpec {
    return { kind: 'slice', schema: schema };
}

type Token =
    | { type: 'start'; name: string }
    | { type: 'end'; name: string }
    | { type: 'text'; text: string };

class RawTokenizerError extends Error {
}

const xmlEntities: Record<string, string> = {
    lt: '<',
    gt: '>',
    amp: '&',
    apos: '\'',
    quot: '"',
};

function localName(name: string): string {
    const index = name.indexOf(':');
    return index >= 0 ? name.substring(index + 1) : name;
}

// RawTokenizer emulates go xml.Decoder.RawToken in strict mode (element matching is not checked)
class RawTokenizer {
    private pos = 0;
    private pendingEnd: string | null = null;

    public constructor(private readonly content: string) {
    }

    private decodeText(text: string): string {
        let normalized = text.replace(/\r\n?/g, '\n');

        if (!normalized.includes('&')) {
            return normalized;
        }

        normalized = normalized.replace(/&([^;]*);?/g, (match: string, entity: string) => {
            if (!match.endsWith(';') || entity === '') {
                throw new RawTokenizerError('invalid character entity ' + match);
            }

            if (entity.startsWith('#x')) {
                const code = parseInt(entity.substring(2), 16);

                if (isNaN(code)) {
                    throw new RawTokenizerError('invalid character entity ' + match);
                }

                return String.fromCodePoint(code);
            } else if (entity.startsWith('#')) {
                const code = parseInt(entity.substring(1), 10);

                if (isNaN(code)) {
                    throw new RawTokenizerError('invalid character entity ' + match);
                }

                return String.fromCodePoint(code);
            }

            const value = xmlEntities[entity];

            if (value === undefined) {
                throw new RawTokenizerError('invalid character entity ' + match);
            }

            return value;
        });

        return normalized;
    }

    // next returns the next token, null means EOF
    public next(): Token | null {
        if (this.pendingEnd !== null) {
            const name = this.pendingEnd;
            this.pendingEnd = null;
            return { type: 'end', name: name };
        }

        const content = this.content;

        while (this.pos < content.length) {
            if (content[this.pos] !== '<') {
                const end = content.indexOf('<', this.pos);
                const text = content.substring(this.pos, end < 0 ? content.length : end);
                this.pos = end < 0 ? content.length : end;
                return { type: 'text', text: this.decodeText(text) };
            }

            if (content.startsWith('<!--', this.pos)) {
                const end = content.indexOf('-->', this.pos + 4);

                if (end < 0) {
                    throw new RawTokenizerError('unexpected EOF');
                }

                this.pos = end + 3;
                continue;
            }

            if (content.startsWith('<![CDATA[', this.pos)) {
                const end = content.indexOf(']]>', this.pos + 9);

                if (end < 0) {
                    throw new RawTokenizerError('unexpected EOF in CDATA section');
                }

                const text = content.substring(this.pos + 9, end);
                this.pos = end + 3;
                return { type: 'text', text: text };
            }

            if (content.startsWith('<?', this.pos)) {
                const end = content.indexOf('?>', this.pos + 2);

                if (end < 0) {
                    throw new RawTokenizerError('unexpected EOF');
                }

                this.pos = end + 2;
                continue;
            }

            if (content.startsWith('<!', this.pos)) {
                const end = content.indexOf('>', this.pos + 2);

                if (end < 0) {
                    throw new RawTokenizerError('unexpected EOF');
                }

                this.pos = end + 1;
                continue;
            }

            if (content.startsWith('</', this.pos)) {
                let i = this.pos + 2;

                while (i < content.length && !/[\s>]/.test(content[i] as string)) {
                    i++;
                }

                const name = content.substring(this.pos + 2, i);

                while (i < content.length && /\s/.test(content[i] as string)) {
                    i++;
                }

                if (name === '' || content[i] !== '>') {
                    throw new RawTokenizerError('invalid characters between </' + name + ' and >');
                }

                this.pos = i + 1;
                return { type: 'end', name: localName(name) };
            }

            // start element
            let i = this.pos + 1;

            while (i < content.length && !/[\s/>]/.test(content[i] as string)) {
                i++;
            }

            const name = content.substring(this.pos + 1, i);

            if (name === '') {
                throw new RawTokenizerError('expected element name after <');
            }

            while (true) {
                while (i < content.length && /\s/.test(content[i] as string)) {
                    i++;
                }

                if (i >= content.length) {
                    throw new RawTokenizerError('unexpected EOF');
                }

                if (content[i] === '>') {
                    i++;
                    break;
                }

                if (content[i] === '/' && content[i + 1] === '>') {
                    i += 2;
                    this.pendingEnd = localName(name);
                    break;
                }

                while (i < content.length && !/[\s=/>]/.test(content[i] as string)) {
                    i++;
                }

                while (i < content.length && /\s/.test(content[i] as string)) {
                    i++;
                }

                if (content[i] !== '=') {
                    throw new RawTokenizerError('attribute name without = in element');
                }

                i++;

                while (i < content.length && /\s/.test(content[i] as string)) {
                    i++;
                }

                const quote = content[i];

                if (quote !== '"' && quote !== '\'') {
                    throw new RawTokenizerError('unquoted or missing attribute value in element');
                }

                const valueEnd = content.indexOf(quote, i + 1);

                if (valueEnd < 0) {
                    throw new RawTokenizerError('unexpected EOF');
                }

                i = valueEnd + 1;
            }

            this.pos = i;
            return { type: 'start', name: localName(name) };
        }

        return null;
    }
}

function getActualFieldValue(fieldValue: string, hasNoEndElement: boolean): string {
    if (!hasNoEndElement) {
        return fieldValue;
    }

    for (let i = 0; i < fieldValue.length; i++) {
        if (fieldValue[i] === '\r' || fieldValue[i] === '\n') {
            return fieldValue.substring(0, i);
        }
    }

    return fieldValue;
}

function unmarshalSgml(tokenizer: RawTokenizer, schema: DecodeSchema, elementName: string): DecodedObject {
    const result: DecodedObject = {};
    const textualFieldWithoutEndElementNames = new Set<string>();
    const textualFieldValues = new Map<string, string>();
    let hasEndElement = false;
    let currentFieldName = '';

    while (true) {
        const token = tokenizer.next();

        if (token === null) {
            break;
        }

        if (token.type === 'start') {
            const field = schema[token.name];

            if (field) {
                const [key, spec] = field;

                if (spec.kind === 'textSlice') {
                    continue;
                }

                if (spec.kind === 'struct' || spec.kind === 'slice') {
                    const child = unmarshalSgml(tokenizer, spec.schema, token.name);

                    if (spec.kind === 'struct') {
                        result[key] = child;
                    } else {
                        const list = (result[key] as DecodedObject[] | undefined) ?? [];
                        list.push(child);
                        result[key] = list;
                    }
                } else {
                    currentFieldName = token.name;
                    textualFieldWithoutEndElementNames.add(token.name);
                }
            }
        } else if (token.type === 'end') {
            const field = schema[token.name];

            if (field) {
                if (field[1].kind === 'text') {
                    textualFieldWithoutEndElementNames.delete(token.name);
                }
            } else if (token.name === elementName) {
                hasEndElement = true;
            }
        } else {
            if (currentFieldName !== '') {
                const field = schema[currentFieldName];

                if (field && field[1].kind === 'text') {
                    textualFieldValues.set(currentFieldName, token.text);
                }
            }

            currentFieldName = '';
        }

        if (hasEndElement) {
            break;
        }
    }

    if (!hasEndElement) {
        throw errs.ErrInvalidSGMLFile;
    }

    for (const [fieldName, fieldValue] of textualFieldValues) {
        const field = schema[fieldName];

        if (field) {
            result[field[0]] = getActualFieldValue(fieldValue, textualFieldWithoutEndElementNames.has(fieldName));
        }
    }

    return result;
}

// decodeSgml decodes the sgml content by the schema, returns null if the root element is not found
export function decodeSgml(content: string, rootElementName: string, schema: DecodeSchema): DecodedObject | null {
    const tokenizer = new RawTokenizer(content);

    try {
        while (true) {
            const token = tokenizer.next();

            if (token === null) {
                return null;
            }

            if (token.type === 'start' && token.name === rootElementName) {
                return unmarshalSgml(tokenizer, schema, rootElementName);
            }
        }
    } catch (err) {
        if (err instanceof RawTokenizerError) {
            throw errs.ErrInvalidSGMLFile;
        }

        throw err;
    }
}

// decodeXmlElement decodes the xml element by the schema like go encoding/xml (field keys can be path like "A>B")
export function decodeXmlElement(element: XmlElement, schema: DecodeSchema, target: DecodedObject = {}): DecodedObject {
    for (const [path, [key, spec]] of Object.entries(schema)) {
        if (path === '#text') {
            target[key] = element.text;
            continue;
        }

        if (path.startsWith('@')) {
            const attrName = path.substring(1);

            if (Object.hasOwn(element.attrs, attrName)) {
                target[key] = element.attrs[attrName];
            }

            continue;
        }

        const matched = xmlFind(element, path);

        if (matched.length < 1) {
            continue;
        }

        if (spec.kind === 'text') {
            target[key] = (matched[matched.length - 1] as XmlElement).text;
        } else if (spec.kind === 'textSlice') {
            const values = (target[key] as string[] | undefined) ?? [];
            values.push(...matched.map(item => item.text));
            target[key] = values;
        } else if (spec.kind === 'struct') {
            let value = (target[key] as DecodedObject | undefined) ?? {};

            for (const item of matched) {
                value = decodeXmlElement(item, spec.schema, value);
            }

            target[key] = value;
        } else {
            const list = (target[key] as DecodedObject[] | undefined) ?? [];

            for (const item of matched) {
                list.push(decodeXmlElement(item, spec.schema, {}));
            }

            target[key] = list;
        }
    }

    return target;
}

// str returns the string field of decoded object
export function str(obj: DecodedObject | null | undefined, key: string): string {
    const value = obj?.[key];
    return typeof value === 'string' ? value : '';
}

// obj returns the struct field of decoded object
export function obj(o: DecodedObject | null | undefined, key: string): DecodedObject | null {
    const value = o?.[key];
    return value && typeof value === 'object' && !Array.isArray(value) ? value as DecodedObject : null;
}

// list returns the slice field of decoded object
export function list(o: DecodedObject | null | undefined, key: string): DecodedObject[] {
    const value = o?.[key];
    return Array.isArray(value) ? value as DecodedObject[] : [];
}
