import { ErrInvalidIpAddressPattern } from '../errs/index';

// IPPattern represents an ip address pattern which supports wildcard (*)
export class IPPattern {
    public readonly pattern: string;
    private readonly regex: RegExp | null;

    public constructor(pattern: string, regex: RegExp | null) {
        this.pattern = pattern;
        this.regex = regex;
    }

    public match(ip: string): boolean {
        if (!this.regex) {
            return false;
        }

        return this.regex.test(ip);
    }

    public toJSON(): string {
        return this.pattern;
    }
}

function isDecimalInteger(s: string): boolean {
    return /^[+-]?\d+$/.test(s);
}

export function parseIPPattern(ipPattern: string): IPPattern | null {
    if (ipPattern === '') {
        return null;
    }

    let hasDot = false;
    let hasSemicolon = false;

    for (const ch of ipPattern) {
        if (ch === '.') { // may be IPv4
            if (hasSemicolon) {
                throw ErrInvalidIpAddressPattern;
            }

            hasDot = true;
        } else if (ch === ':') { // may be IPv6
            if (hasDot) {
                throw ErrInvalidIpAddressPattern;
            }

            hasSemicolon = true;
        }
    }

    if (hasDot) {
        return parseIPv4Pattern(ipPattern);
    } else if (hasSemicolon) {
        return parseIPv6Pattern(ipPattern);
    }

    throw ErrInvalidIpAddressPattern;
}

export function parseIPv4Pattern(ipPattern: string): IPPattern {
    const items = ipPattern.split('.');

    if (items.length !== 4) {
        throw ErrInvalidIpAddressPattern;
    }

    let regex = '^';

    for (let i = 0; i < items.length; i++) {
        const item = items[i]!.trim();

        if (item === '*') {
            regex += '[0-9]{1,3}';
        } else if (item === '') {
            throw ErrInvalidIpAddressPattern;
        } else {
            const num = parseInt(item, 10);

            if (!isDecimalInteger(item) || num < 0 || num > 255) {
                throw ErrInvalidIpAddressPattern;
            }

            regex += item;
        }

        if (i < items.length - 1) {
            regex += '\\.';
        }
    }

    regex += '$';

    return new IPPattern(ipPattern, new RegExp(regex));
}

export function parseIPv6Pattern(ipPattern: string): IPPattern {
    const items = ipPattern.split(':');

    if (items.length < 2 || items.length > 8) {
        throw ErrInvalidIpAddressPattern;
    }

    let regex = '^';

    for (let i = 0; i < items.length; i++) {
        const item = items[i]!.trim();

        if (item === '*') {
            regex += '[0-9a-fA-F]{1,4}';
        } else if (i < items.length - 1 && item === '') {
            // empty group, e.g. "::"
        } else {
            const num = parseInt(item, 16);

            if (!/^[+-]?[0-9a-fA-F]+$/.test(item) || num < 0 || num > 0xFFFF) {
                throw ErrInvalidIpAddressPattern;
            }

            regex += item;
        }

        if (i < items.length - 1) {
            regex += ':';
        }
    }

    regex += '$';

    return new IPPattern(ipPattern, new RegExp(regex));
}
