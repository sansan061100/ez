import QRCode from 'qrcode';

import * as errs from '../errs/index';
import { encodeGrayPng } from '../utils/png';
import type { WebContext } from '../web/context';
import { currentConfig } from './base';

const qrCodeDefaultWidth = 320;
const qrCodeDefaultHeight = 320;

// generateUrlQrCode generates the qr code png image which is scaled like boombuler/barcode (no quiet zone, centered)
function generateUrlQrCode(url: string): Buffer {
    const qrCode = QRCode.create(url, { errorCorrectionLevel: 'M' });
    const size = qrCode.modules.size;
    const factor = Math.floor(Math.min(qrCodeDefaultWidth / size, qrCodeDefaultHeight / size));

    if (factor < 1) {
        throw errs.ErrOperationFailed;
    }

    const offsetX = Math.floor((qrCodeDefaultWidth - size * factor) / 2);
    const offsetY = Math.floor((qrCodeDefaultHeight - size * factor) / 2);
    const pixels = new Uint8Array(qrCodeDefaultWidth * qrCodeDefaultHeight).fill(255);

    for (let y = 0; y < size * factor; y++) {
        for (let x = 0; x < size * factor; x++) {
            if (qrCode.modules.get(Math.floor(y / factor), Math.floor(x / factor))) {
                pixels[(y + offsetY) * qrCodeDefaultWidth + x + offsetX] = 0;
            }
        }
    }

    return encodeGrayPng(qrCodeDefaultWidth, qrCodeDefaultHeight, pixels);
}

// mobileUrlQrCodeHandler returns a mobile url qr code image
export async function mobileUrlQrCodeHandler(_c: WebContext): Promise<[Buffer, string]> {
    const fullUrl = currentConfig().rootUrl + 'mobile';

    try {
        return [generateUrlQrCode(fullUrl), 'image/png'];
    } catch {
        throw errs.ErrOperationFailed;
    }
}
