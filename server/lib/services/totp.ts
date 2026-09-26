import { randomBytes } from 'node:crypto';

import { Secret, TOTP } from 'otpauth';
import QRCode from 'qrcode';

const twoFactorPeriod = 30; // seconds
const twoFactorSecretSize = 20; // bytes

// TotpKey represents a generated totp key (like pquerna/otp Key)
export class TotpKey {
    private readonly secretText: string;
    private readonly urlText: string;

    public constructor(secret: string, url: string) {
        this.secretText = secret;
        this.urlText = url;
    }

    public secret(): string {
        return this.secretText;
    }

    public url(): string {
        return this.urlText;
    }

    // image returns the png image of qr code
    public async image(width: number): Promise<Buffer> {
        return QRCode.toBuffer(this.urlText, { type: 'png', errorCorrectionLevel: 'M', margin: 0, width: width });
    }
}

// goPathEscape escapes path segment like go url.URL.String() does for path
function goPathEscape(path: string): string {
    return encodeURI(path).replace(/[?#]/g, ch => encodeURIComponent(ch));
}

// goQueryValueEscape escapes query value like go url.QueryEscape
function goQueryValueEscape(value: string): string {
    return encodeURIComponent(value).replace(/%20/g, '+').replace(/[!'()*]/g, ch => '%' + ch.charCodeAt(0).toString(16).toUpperCase());
}

// generateTotpKey generates a new totp key (same format as pquerna/otp totp.Generate)
export function generateTotpKey(issuer: string, accountName: string): TotpKey {
    const secret = new Secret({ buffer: randomBytes(twoFactorSecretSize).buffer }).base32.replace(/=+$/, '');
    const query = [
        ['algorithm', 'SHA1'],
        ['digits', '6'],
        ['issuer', issuer],
        ['period', String(twoFactorPeriod)],
        ['secret', secret],
    ].map(([key, value]) => `${key}=${goQueryValueEscape(value!)}`).join('&');

    const url = `otpauth://totp${goPathEscape('/' + issuer + ':' + accountName)}?${query}`;
    return new TotpKey(secret, url);
}

// validateTotp validates the passcode with the secret (allows one period skew, same as pquerna/otp totp.Validate)
export function validateTotp(passcode: string, secret: string): boolean {
    if (passcode.length !== 6) {
        return false;
    }

    let totp: TOTP;

    try {
        totp = new TOTP({
            secret: Secret.fromBase32(secret.toUpperCase().replace(/=+$/, '')),
            algorithm: 'SHA1',
            digits: 6,
            period: twoFactorPeriod,
        });
    } catch {
        return false;
    }

    return totp.validate({ token: passcode, window: 1 }) !== null;
}
