import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private transporter: nodemailer.Transporter;

  constructor() {
    this.transporter = nodemailer.createTransport({
      host: 'smtp.yandex.ru',
      port: 465,
      secure: true,           // SSL on 465
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
      tls: { rejectUnauthorized: false },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
    });
    this.logger.log(`EmailService init: user=${process.env.SMTP_USER}, pass_len=${(process.env.SMTP_PASS || '').length}`);
  }

  async sendConfirmation(email: string, token: string): Promise<void> {
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const confirmUrl = `${frontendUrl}/auth/confirm?token=${token}`;

    try {
      await this.transporter.sendMail({
        from: `"INDEXALL" <${process.env.SMTP_USER}>`,
        to: email,
        subject: 'Подтверждение email — INDEXALL',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px; background: #f9f9f9; border-radius: 8px;">
            <h2 style="margin: 0 0 16px; font-size: 22px; color: #111;">Подтвердите ваш email</h2>
            <p style="color: #444; font-size: 15px; margin: 0 0 24px;">
              Для завершения регистрации в INDEXALL нажмите кнопку ниже.
              Ссылка действительна 24 часа.
            </p>
            <a href="${confirmUrl}"
              style="display: inline-block; padding: 12px 28px; background: #f5c518; color: #111;
                     font-weight: 700; font-size: 15px; border-radius: 6px; text-decoration: none;">
              Подтвердить email
            </a>
            <p style="margin: 24px 0 0; font-size: 12px; color: #999;">
              Если вы не регистрировались в INDEXALL — просто проигнорируйте это письмо.
            </p>
            <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 24px 0 16px;" />
            <p style="font-size: 12px; color: #bbb; margin: 0;">
              Ссылка: <a href="${confirmUrl}" style="color: #888;">${confirmUrl}</a>
            </p>
          </div>
        `,
      });
      this.logger.log(`Confirmation email sent to ${email}`);
    } catch (err) {
      this.logger.error(`Failed to send confirmation email to ${email}: ${err.message}`);
      throw err;
    }
  }
}
