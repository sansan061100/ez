import nodemailer, { type Transporter } from 'nodemailer';

import * as errs from '../errs/index';
import type { Config, SMTPConfig } from '../settings/settings';

export interface MailMessage {
    to: string;
    subject: string;
    body: string;
}

export interface Mailer {
    sendMail(message: MailMessage): Promise<void>;
}

// DefaultMailer represents default mailer which sends mails via smtp server
export class DefaultMailer implements Mailer {
    private readonly transporter: Transporter;
    private readonly fromAddress: string;

    public constructor(smtpConfig: SMTPConfig) {
        const index = smtpConfig.smtpHost.lastIndexOf(':');

        if (index < 0) {
            throw errs.ErrSMTPServerHostInvalid;
        }

        const host = smtpConfig.smtpHost.substring(0, index).replace(/^\[|\]$/g, '');
        const portText = smtpConfig.smtpHost.substring(index + 1);

        if (!/^\d+$/.test(portText)) {
            throw errs.ErrSMTPServerHostInvalid;
        }

        const port = parseInt(portText, 10);

        this.transporter = nodemailer.createTransport({
            host: host,
            port: port,
            secure: port === 465,
            auth: smtpConfig.smtpUser ? { user: smtpConfig.smtpUser, pass: smtpConfig.smtpPasswd } : undefined,
            tls: {
                servername: host,
                rejectUnauthorized: !smtpConfig.smtpSkipTLSVerify,
            },
        });
        this.fromAddress = smtpConfig.fromAddress;
    }

    public async sendMail(message: MailMessage): Promise<void> {
        await this.transporter.sendMail({
            from: this.fromAddress,
            to: message.to,
            subject: message.subject,
            html: message.body,
        });
    }
}

// MailerContainer contains the current mailer
class MailerContainer {
    public current: Mailer | null = null;

    public async sendMail(message: MailMessage): Promise<void> {
        if (!this.current) {
            throw errs.ErrSMTPServerNotEnabled;
        }

        await this.current.sendMail(message);
    }
}

export const Container = new MailerContainer();

export function initializeMailer(config: Config): void {
    if (!config.enableSMTP) {
        Container.current = null;
        return;
    }

    Container.current = new DefaultMailer(config.smtpConfig);
}
