import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { Transporter } from 'nodemailer';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: Transporter;

  constructor(private config: ConfigService) {
    this.transporter = nodemailer.createTransport({
      host:   this.config.get<string>('SMTP_HOST'),
      port:   this.config.get<number>('SMTP_PORT'),
      secure: this.config.get<string>('SMTP_SECURE') === 'true',
      auth: {
        user: this.config.get<string>('SMTP_USER'),
        pass: this.config.get<string>('SMTP_PASS'),
      },
    });
  }

  // ── Подтверждение email ────────────────────────────────────
  async sendConfirmationEmail(email: string, token: string): Promise<void> {
    const frontendUrl = this.config.get<string>('FRONTEND_URL');
    const backendUrl  = this.config.get<string>('BACKEND_URL');
    const confirmUrl  = `${backendUrl}/api/auth/confirm/${token}`;

    const html = this.buildEmailHtml({
      title: 'Подтвердите email',
      greeting: `Добро пожаловать в INDEXALL!`,
      body: `
        <p>Для завершения регистрации подтвердите ваш email-адрес,
        нажав на кнопку ниже.</p>
        <p style="color:#888;font-size:13px;">
          Ссылка действительна <strong>24 часа</strong>.
          Если вы не регистрировались — просто проигнорируйте это письмо.
        </p>
      `,
      buttonText: 'Подтвердить email',
      buttonUrl: confirmUrl,
    });

    await this.send({
      to: email,
      subject: 'INDEXALL — подтверждение email',
      html,
    });

    this.logger.log(`Confirmation email sent → ${email}`);
  }

  // ── Восстановление пароля ──────────────────────────────────
  async sendPasswordResetEmail(email: string, token: string): Promise<void> {
    const frontendUrl = this.config.get<string>('FRONTEND_URL');
    const resetUrl    = `${frontendUrl}/reset-password?token=${token}`;

    const html = this.buildEmailHtml({
      title: 'Сброс пароля',
      greeting: 'Запрос на сброс пароля',
      body: `
        <p>Мы получили запрос на сброс пароля для вашего аккаунта INDEXALL.</p>
        <p>Нажмите кнопку ниже, чтобы установить новый пароль.</p>
        <p style="color:#888;font-size:13px;">
          Ссылка действительна <strong>1 час</strong>.
          Если вы не запрашивали сброс — просто проигнорируйте письмо.
        </p>
      `,
      buttonText: 'Сбросить пароль',
      buttonUrl: resetUrl,
    });

    await this.send({
      to: email,
      subject: 'INDEXALL — сброс пароля',
      html,
    });

    this.logger.log(`Password reset email sent → ${email}`);
  }

  // ── Уведомление об успешном подтверждении ─────────────────
  async sendWelcomeEmail(email: string): Promise<void> {
    const frontendUrl = this.config.get<string>('FRONTEND_URL');

    const html = this.buildEmailHtml({
      title: 'Email подтверждён!',
      greeting: 'Ваш аккаунт активирован',
      body: `
        <p>Отлично! Ваш email успешно подтверждён.</p>
        <p>Теперь вы можете войти в INDEXALL и начать работу
        со спецификациями и каталогами оборудования.</p>
      `,
      buttonText: 'Войти в INDEXALL',
      buttonUrl: frontendUrl,
    });

    await this.send({
      to: email,
      subject: 'INDEXALL — добро пожаловать!',
      html,
    });
  }

  // ── Приватные методы ───────────────────────────────────────
  private async send(options: {
    to: string;
    subject: string;
    html: string;
  }): Promise<void> {
    const from = this.config.get<string>('MAIL_FROM');
    try {
      await this.transporter.sendMail({ from, ...options });
    } catch (err) {
      this.logger.error(`Failed to send email to ${options.to}`, err);
      throw err;
    }
  }

  private buildEmailHtml(opts: {
    title: string;
    greeting: string;
    body: string;
    buttonText: string;
    buttonUrl: string;
  }): string {
    return `
<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${opts.title}</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="520" cellpadding="0" cellspacing="0"
               style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">

          <!-- Header -->
          <tr>
            <td style="background:#1a1a1a;padding:24px 32px;text-align:center;">
              <table cellpadding="0" cellspacing="0" style="margin:0 auto;">
                <tr>
                  <td style="background:#f5c800;border-radius:50%;width:44px;height:44px;text-align:center;vertical-align:middle;">
                    <span style="font-size:22px;line-height:44px;">⚡</span>
                  </td>
                  <td style="padding-left:12px;">
                    <span style="color:#ffffff;font-size:20px;font-weight:800;letter-spacing:2px;">INDEXALL</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:32px 40px;">
              <h2 style="margin:0 0 16px;font-size:20px;color:#1a1a1a;">${opts.greeting}</h2>
              <div style="font-size:14px;line-height:1.7;color:#444;">
                ${opts.body}
              </div>

              <!-- Button -->
              <div style="text-align:center;margin:28px 0;">
                <a href="${opts.buttonUrl}"
                   style="display:inline-block;background:#f5c800;color:#1a1a1a;
                          text-decoration:none;font-weight:700;font-size:15px;
                          padding:14px 32px;border-radius:8px;letter-spacing:0.5px;">
                  ${opts.buttonText}
                </a>
              </div>

              <p style="font-size:12px;color:#aaa;margin-top:24px;word-break:break-all;">
                Если кнопка не работает, скопируйте эту ссылку в браузер:<br>
                <a href="${opts.buttonUrl}" style="color:#888;">${opts.buttonUrl}</a>
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#f9f9f9;padding:16px 40px;border-top:1px solid #eee;text-align:center;">
              <p style="margin:0;font-size:11px;color:#bbb;">
                © ${new Date().getFullYear()} INDEXALL. Это автоматическое письмо, не отвечайте на него.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
  }
}
