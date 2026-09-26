import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export type KnownTemplate = string;

export const TEMPLATE_VERIFY_EMAIL: KnownTemplate = 'email/verify_email';
export const TEMPLATE_PASSWORD_RESET: KnownTemplate = 'email/password_reset';
export const SYSTEM_PROMPT_TRANSACTION_TEXT_RECOGNITION: KnownTemplate = 'prompt/transaction_text_recognition';
export const SYSTEM_PROMPT_RECEIPT_IMAGE_RECOGNITION: KnownTemplate = 'prompt/receipt_image_recognition';
export const SYSTEM_PROMPT_BATCH_TRANSACTION_TEXT_RECOGNITION: KnownTemplate = 'prompt/batch_transaction_text_recognition';
export const SYSTEM_PROMPT_BATCH_RECEIPT_IMAGE_RECOGNITION: KnownTemplate = 'prompt/batch_receipt_image_recognition';

const templateBasePath = 'templates';
const templateFileExtension = 'tmpl';

const htmlReplacementTable: Record<string, string> = {
    '\0': '�',
    '"': '&#34;',
    '&': '&amp;',
    '\'': '&#39;',
    '+': '&#43;',
    '<': '&lt;',
    '>': '&gt;',
};

// htmlEscape escapes text like go html/template htmlEscaper
export function htmlEscape(text: string): string {
    return text.replace(/[\0"&'+<>]/g, ch => htmlReplacementTable[ch]!);
}

// urlNormalize normalizes url like go html/template urlNormalizer
function urlNormalize(text: string): string {
    let result = '';

    for (const byte of Buffer.from(text, 'utf8')) {
        const ch = String.fromCharCode(byte);

        if (/[A-Za-z0-9\-._~!#$&*+,/:;=?@[\]%]/.test(ch) && byte < 0x80) {
            result += ch;
        } else {
            result += '%' + byte.toString(16).toUpperCase().padStart(2, '0');
        }
    }

    return result;
}

function urlFilter(text: string): string {
    const colonIndex = text.indexOf(':');

    if (colonIndex >= 0 && !text.substring(0, colonIndex).includes('/')) {
        const scheme = text.substring(0, colonIndex).toLowerCase();

        if (scheme !== 'http' && scheme !== 'https' && scheme !== 'mailto') {
            return '#ZgotmplZ';
        }
    }

    return text;
}

function resolvePath(data: unknown, path: string[]): string {
    let current: unknown = data;

    for (const part of path) {
        if (current === null || current === undefined || typeof current !== 'object') {
            return '';
        }

        current = (current as Record<string, unknown>)[part];
    }

    if (current === null || current === undefined) {
        return '';
    }

    return String(current);
}

// CachedTemplate represents a parsed template which supports "{{.Field}}" and "{{.Field.SubField}}" actions
export class CachedTemplate {
    private readonly content: string;

    public constructor(content: string) {
        this.content = content;
    }

    public execute(data: unknown): string {
        return this.content.replace(/\{\{\s*\.([A-Za-z0-9_.]+)\s*\}\}/g, (_match: string, path: string, offset: number) => {
            const value = resolvePath(data, path.split('.'));
            const before = this.content.substring(Math.max(0, offset - 16), offset);

            if (/(href|src)\s*=\s*"$/i.test(before)) {
                return htmlEscape(urlNormalize(urlFilter(value)));
            }

            return htmlEscape(value);
        });
    }
}

const templateCache = new Map<KnownTemplate, CachedTemplate>();

// getTemplate returns a cached template instance according to the template name
export function getTemplate(templateName: KnownTemplate): CachedTemplate {
    const cachedTemplate = templateCache.get(templateName);

    if (cachedTemplate) {
        return cachedTemplate;
    }

    const fullPath = join(templateBasePath, `${templateName}.${templateFileExtension}`);
    const template = new CachedTemplate(readFileSync(fullPath, 'utf8'));
    templateCache.set(templateName, template);

    return template;
}
