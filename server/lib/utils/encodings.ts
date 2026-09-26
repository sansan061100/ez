import iconv from 'iconv-lite';

// Decoders compatible with the golang.org/x/text encodings used by ezbookkeeping

// EBCDIC decode tables generated from golang.org/x/text/encoding/charmap
const ebcdicTables: Record<string, string> = {
    'cp037': '\u0000\u0001\u0002\u0003\u009c\u0009\u0086\u007f\u0097\u008d\u008e\u000b\u000c\u000d\u000e\u000f\u0010\u0011\u0012\u0013\u009d\u0085\u0008\u0087\u0018\u0019\u0092\u008f\u001c\u001d\u001e\u001f\u0080\u0081\u0082\u0083\u0084\u000a\u0017\u001b\u0088\u0089\u008a\u008b\u008c\u0005\u0006\u0007\u0090\u0091\u0016\u0093\u0094\u0095\u0096\u0004\u0098\u0099\u009a\u009b\u0014\u0015\u009e\u001a\u0020\u00a0\u00e2\u00e4\u00e0\u00e1\u00e3\u00e5\u00e7\u00f1\u00a2\u002e\u003c\u0028\u002b\u007c\u0026\u00e9\u00ea\u00eb\u00e8\u00ed\u00ee\u00ef\u00ec\u00df\u0021\u0024\u002a\u0029\u003b\u00ac\u002d\u002f\u00c2\u00c4\u00c0\u00c1\u00c3\u00c5\u00c7\u00d1\u00a6\u002c\u0025\u005f\u003e\u003f\u00f8\u00c9\u00ca\u00cb\u00c8\u00cd\u00ce\u00cf\u00cc\u0060\u003a\u0023\u0040\u0027\u003d\u0022\u00d8\u0061\u0062\u0063\u0064\u0065\u0066\u0067\u0068\u0069\u00ab\u00bb\u00f0\u00fd\u00fe\u00b1\u00b0\u006a\u006b\u006c\u006d\u006e\u006f\u0070\u0071\u0072\u00aa\u00ba\u00e6\u00b8\u00c6\u00a4\u00b5\u007e\u0073\u0074\u0075\u0076\u0077\u0078\u0079\u007a\u00a1\u00bf\u00d0\u00dd\u00de\u00ae\u005e\u00a3\u00a5\u00b7\u00a9\u00a7\u00b6\u00bc\u00bd\u00be\u005b\u005d\u00af\u00a8\u00b4\u00d7\u007b\u0041\u0042\u0043\u0044\u0045\u0046\u0047\u0048\u0049\u00ad\u00f4\u00f6\u00f2\u00f3\u00f5\u007d\u004a\u004b\u004c\u004d\u004e\u004f\u0050\u0051\u0052\u00b9\u00fb\u00fc\u00f9\u00fa\u00ff\u005c\u00f7\u0053\u0054\u0055\u0056\u0057\u0058\u0059\u005a\u00b2\u00d4\u00d6\u00d2\u00d3\u00d5\u0030\u0031\u0032\u0033\u0034\u0035\u0036\u0037\u0038\u0039\u00b3\u00db\u00dc\u00d9\u00da\u009f',
    'cp1047': '\u0000\u0001\u0002\u0003\u009c\u0009\u0086\u007f\u0097\u008d\u008e\u000b\u000c\u000d\u000e\u000f\u0010\u0011\u0012\u0013\u009d\u0085\u0008\u0087\u0018\u0019\u0092\u008f\u001c\u001d\u001e\u001f\u0080\u0081\u0082\u0083\u0084\u000a\u0017\u001b\u0088\u0089\u008a\u008b\u008c\u0005\u0006\u0007\u0090\u0091\u0016\u0093\u0094\u0095\u0096\u0004\u0098\u0099\u009a\u009b\u0014\u0015\u009e\u001a\u0020\u00a0\u00e2\u00e4\u00e0\u00e1\u00e3\u00e5\u00e7\u00f1\u00a2\u002e\u003c\u0028\u002b\u007c\u0026\u00e9\u00ea\u00eb\u00e8\u00ed\u00ee\u00ef\u00ec\u00df\u0021\u0024\u002a\u0029\u003b\u005e\u002d\u002f\u00c2\u00c4\u00c0\u00c1\u00c3\u00c5\u00c7\u00d1\u00a6\u002c\u0025\u005f\u003e\u003f\u00f8\u00c9\u00ca\u00cb\u00c8\u00cd\u00ce\u00cf\u00cc\u0060\u003a\u0023\u0040\u0027\u003d\u0022\u00d8\u0061\u0062\u0063\u0064\u0065\u0066\u0067\u0068\u0069\u00ab\u00bb\u00f0\u00fd\u00fe\u00b1\u00b0\u006a\u006b\u006c\u006d\u006e\u006f\u0070\u0071\u0072\u00aa\u00ba\u00e6\u00b8\u00c6\u00a4\u00b5\u007e\u0073\u0074\u0075\u0076\u0077\u0078\u0079\u007a\u00a1\u00bf\u00d0\u005b\u00de\u00ae\u00ac\u00a3\u00a5\u00b7\u00a9\u00a7\u00b6\u00bc\u00bd\u00be\u00dd\u00a8\u00af\u005d\u00b4\u00d7\u007b\u0041\u0042\u0043\u0044\u0045\u0046\u0047\u0048\u0049\u00ad\u00f4\u00f6\u00f2\u00f3\u00f5\u007d\u004a\u004b\u004c\u004d\u004e\u004f\u0050\u0051\u0052\u00b9\u00fb\u00fc\u00f9\u00fa\u00ff\u005c\u00f7\u0053\u0054\u0055\u0056\u0057\u0058\u0059\u005a\u00b2\u00d4\u00d6\u00d2\u00d3\u00d5\u0030\u0031\u0032\u0033\u0034\u0035\u0036\u0037\u0038\u0039\u00b3\u00db\u00dc\u00d9\u00da\u009f',
    'cp1140': '\u0000\u0001\u0002\u0003\u009c\u0009\u0086\u007f\u0097\u008d\u008e\u000b\u000c\u000d\u000e\u000f\u0010\u0011\u0012\u0013\u009d\u0085\u0008\u0087\u0018\u0019\u0092\u008f\u001c\u001d\u001e\u001f\u0080\u0081\u0082\u0083\u0084\u000a\u0017\u001b\u0088\u0089\u008a\u008b\u008c\u0005\u0006\u0007\u0090\u0091\u0016\u0093\u0094\u0095\u0096\u0004\u0098\u0099\u009a\u009b\u0014\u0015\u009e\u001a\u0020\u00a0\u00e2\u00e4\u00e0\u00e1\u00e3\u00e5\u00e7\u00f1\u00a2\u002e\u003c\u0028\u002b\u007c\u0026\u00e9\u00ea\u00eb\u00e8\u00ed\u00ee\u00ef\u00ec\u00df\u0021\u0024\u002a\u0029\u003b\u00ac\u002d\u002f\u00c2\u00c4\u00c0\u00c1\u00c3\u00c5\u00c7\u00d1\u00a6\u002c\u0025\u005f\u003e\u003f\u00f8\u00c9\u00ca\u00cb\u00c8\u00cd\u00ce\u00cf\u00cc\u0060\u003a\u0023\u0040\u0027\u003d\u0022\u00d8\u0061\u0062\u0063\u0064\u0065\u0066\u0067\u0068\u0069\u00ab\u00bb\u00f0\u00fd\u00fe\u00b1\u00b0\u006a\u006b\u006c\u006d\u006e\u006f\u0070\u0071\u0072\u00aa\u00ba\u00e6\u00b8\u00c6\u20ac\u00b5\u007e\u0073\u0074\u0075\u0076\u0077\u0078\u0079\u007a\u00a1\u00bf\u00d0\u00dd\u00de\u00ae\u005e\u00a3\u00a5\u00b7\u00a9\u00a7\u00b6\u00bc\u00bd\u00be\u005b\u005d\u00af\u00a8\u00b4\u00d7\u007b\u0041\u0042\u0043\u0044\u0045\u0046\u0047\u0048\u0049\u00ad\u00f4\u00f6\u00f2\u00f3\u00f5\u007d\u004a\u004b\u004c\u004d\u004e\u004f\u0050\u0051\u0052\u00b9\u00fb\u00fc\u00f9\u00fa\u00ff\u005c\u00f7\u0053\u0054\u0055\u0056\u0057\u0058\u0059\u005a\u00b2\u00d4\u00d6\u00d2\u00d3\u00d5\u0030\u0031\u0032\u0033\u0034\u0035\u0036\u0037\u0038\u0039\u00b3\u00db\u00dc\u00d9\u00da\u009f',
};

function decodeSingleByteTable(data: Buffer, table: string): string {
    let result = '';

    for (const byte of data) {
        result += table[byte] ?? '�';
    }

    return result;
}

function decodeUnicodeWithBOM(data: Buffer, defaultEncoding: 'utf16le' | 'utf16be' | 'utf32le' | 'utf32be'): string {
    let encoding: string = defaultEncoding;
    let body = data;

    if (defaultEncoding.startsWith('utf16') && data.length >= 2) {
        if (data[0] === 0xff && data[1] === 0xfe) {
            encoding = 'utf16le';
            body = data.subarray(2);
        } else if (data[0] === 0xfe && data[1] === 0xff) {
            encoding = 'utf16be';
            body = data.subarray(2);
        }
    } else if (defaultEncoding.startsWith('utf32') && data.length >= 4) {
        if (data[0] === 0xff && data[1] === 0xfe && data[2] === 0x00 && data[3] === 0x00) {
            encoding = 'utf32le';
            body = data.subarray(4);
        } else if (data[0] === 0x00 && data[1] === 0x00 && data[2] === 0xfe && data[3] === 0xff) {
            encoding = 'utf32be';
            body = data.subarray(4);
        }
    }

    return iconv.decode(body, encoding, { stripBOM: false });
}

// decodeISO2022JP decodes the ISO-2022-JP content (ASCII, JIS X 0201 Roman / Katakana, JIS X 0208)
function decodeISO2022JP(data: Buffer): string {
    const ASCII = 0;
    const JIS0201_ROMAN = 1;
    const JIS0201_KATAKANA = 2;
    const JIS0208 = 3;
    let state = ASCII;
    let result = '';
    let i = 0;

    while (i < data.length) {
        const byte = data[i] as number;

        if (byte === 0x1b) {
            const seq = data.subarray(i + 1, i + 3).toString('latin1');

            if (seq === '(B') {
                state = ASCII;
                i += 3;
                continue;
            } else if (seq === '(J') {
                state = JIS0201_ROMAN;
                i += 3;
                continue;
            } else if (seq === '(I') {
                state = JIS0201_KATAKANA;
                i += 3;
                continue;
            } else if (seq === '$@' || seq === '$B') {
                state = JIS0208;
                i += 3;
                continue;
            }

            result += '�';
            i++;
            continue;
        }

        if (byte === 0x0a || byte === 0x0d) {
            state = ASCII;
            result += String.fromCharCode(byte);
            i++;
            continue;
        }

        if (state === JIS0208) {
            if (i + 1 >= data.length) {
                result += '�';
                break;
            }

            const b1 = byte;
            const b2 = data[i + 1] as number;

            if (b1 < 0x21 || b1 > 0x7e || b2 < 0x21 || b2 > 0x7e) {
                result += '�';
                i++;
                continue;
            }

            result += iconv.decode(Buffer.from([b1 | 0x80, b2 | 0x80]), 'euc-jp');
            i += 2;
            continue;
        }

        if (state === JIS0201_KATAKANA && byte >= 0x21 && byte <= 0x5f) {
            result += String.fromCharCode(0xff61 + byte - 0x21);
        } else if (state === JIS0201_ROMAN && byte === 0x5c) {
            result += '¥';
        } else if (state === JIS0201_ROMAN && byte === 0x7e) {
            result += '‾';
        } else if (byte < 0x80) {
            result += String.fromCharCode(byte);
        } else {
            result += '�';
        }

        i++;
    }

    return result;
}

const iconvEncodingNames: Record<string, string> = {
    'cp437': 'cp437',
    'cp863': 'cp863',
    'iso-8859-1': 'iso-8859-1',
    'cp850': 'cp850',
    'cp858': 'cp858',
    'windows-1252': 'windows-1252',
    'iso-8859-15': 'iso-8859-15',
    'iso-8859-4': 'iso-8859-4',
    'iso-8859-10': 'iso-8859-10',
    'cp865': 'cp865',
    'iso-8859-2': 'iso-8859-2',
    'cp852': 'cp852',
    'windows-1250': 'windows-1250',
    'iso-8859-14': 'iso-8859-14',
    'iso-8859-3': 'iso-8859-3',
    'cp860': 'cp860',
    'iso-8859-7': 'iso-8859-7',
    'windows-1253': 'windows-1253',
    'iso-8859-9': 'iso-8859-9',
    'windows-1254': 'windows-1254',
    'iso-8859-13': 'iso-8859-13',
    'windows-1257': 'windows-1257',
    'iso-8859-16': 'iso-8859-16',
    'iso-8859-5': 'iso-8859-5',
    'cp855': 'cp855',
    'cp866': 'cp866',
    'windows-1251': 'windows-1251',
    'koi8r': 'koi8-r',
    'koi8u': 'koi8-u',
    'iso-8859-6': 'iso-8859-6',
    'windows-1256': 'windows-1256',
    'iso-8859-8': 'iso-8859-8',
    'cp862': 'cp862',
    'windows-1255': 'windows-1255',
    'windows-874': 'windows-874',
    'windows-1258': 'windows-1258',
    'gb18030': 'gb18030',
    'gbk': 'gbk',
    'big5': 'big5',
    'euc-kr': 'euc-kr',
    'euc-jp': 'euc-jp',
    'shift_jis': 'shift_jis',
};

// SupportedFileEncodings is the list of file encodings supported by custom file importer
export const SupportedFileEncodings: string[] = ['utf-8', 'utf-16le', 'utf-16be', 'utf-32le', 'utf-32be', ...Object.keys(ebcdicTables), 'iso-2022-jp', ...Object.keys(iconvEncodingNames)];

// isSupportedFileEncoding returns whether the file encoding is supported
export function isSupportedFileEncoding(encoding: string): boolean {
    return SupportedFileEncodings.includes(encoding);
}

// decodeWithFileEncoding decodes the content bytes by the file encoding name
export function decodeWithFileEncoding(data: Buffer, encoding: string): string {
    switch (encoding) {
        case 'utf-8': {
            const body = data.length >= 3 && data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf ? data.subarray(3) : data;
            return body.toString('utf8');
        }
        case 'utf-16le':
            return decodeUnicodeWithBOM(data, 'utf16le');
        case 'utf-16be':
            return decodeUnicodeWithBOM(data, 'utf16be');
        case 'utf-32le':
            return decodeUnicodeWithBOM(data, 'utf32le');
        case 'utf-32be':
            return decodeUnicodeWithBOM(data, 'utf32be');
        case 'iso-2022-jp':
            return decodeISO2022JP(data);
    }

    const ebcdicTable = ebcdicTables[encoding];

    if (ebcdicTable) {
        return decodeSingleByteTable(data, ebcdicTable);
    }

    const iconvName = iconvEncodingNames[encoding];

    if (iconvName) {
        return iconv.decode(data, iconvName, { stripBOM: false });
    }

    throw new Error(`unsupported encoding "${encoding}"`);
}

// decodeWithBOMOverride decodes the content by BOM (utf-8, utf-16le, utf-16be) and fallback to utf-8 (same as go unicode.BOMOverride)
export function decodeWithBOMOverride(data: Buffer): string {
    if (data.length >= 3 && data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf) {
        return data.subarray(3).toString('utf8');
    }

    if (data.length >= 2 && data[0] === 0xff && data[1] === 0xfe) {
        return iconv.decode(data.subarray(2), 'utf16le', { stripBOM: false });
    }

    if (data.length >= 2 && data[0] === 0xfe && data[1] === 0xff) {
        return iconv.decode(data.subarray(2), 'utf16be', { stripBOM: false });
    }

    return data.toString('utf8');
}
