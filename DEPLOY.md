# Деплой INDEXALL на VPS (nkupro.ru)

## Требования к серверу
- Ubuntu 22.04 LTS (рекомендуется)
- 2 ГБ RAM минимум
- Docker + Docker Compose

---

## Шаг 1 — DNS записи (в панели регистратора домена)

Добавь A-записи, указывающие на IP вашего VPS:

```
nkupro.ru       →  A  →  ВАШ_IP_VPS
www.nkupro.ru   →  A  →  ВАШ_IP_VPS
api.nkupro.ru   →  A  →  ВАШ_IP_VPS
```

Дождись применения DNS (до 30 минут).

---

## Шаг 2 — Установка Docker на VPS

Подключись по SSH и выполни:

```bash
ssh root@ВАШ_IP_VPS

# Установка Docker
curl -fsSL https://get.docker.com | sh
systemctl enable docker
systemctl start docker

# Установка Docker Compose
curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" \
  -o /usr/local/bin/docker-compose
chmod +x /usr/local/bin/docker-compose

# Проверка
docker --version
docker-compose --version
```

---

## Шаг 3 — Клонирование репозитория

```bash
cd /opt
git clone https://github.com/sotnev2024-code/indexall.git
cd indexall
```

---

## Шаг 4 — Создание .env файлов

```bash
# Backend
cp backend/.env.production.example backend/.env.production
nano backend/.env.production
```

Заполни все значения:
- `DATABASE_PASSWORD` — придумай надёжный пароль
- `JWT_SECRET` — случайная строка 64 символа (можно сгенерировать: `openssl rand -hex 32`)
- `SMTP_PASS` — пароль приложения Яндекс
- `YUKASSA_SHOP_ID` / `YUKASSA_SECRET_KEY` — ключи ЮКасса

```bash
# Frontend
cp frontend/.env.production.example frontend/.env.production
# Значения уже правильные (https://api.nkupro.ru/api)
```

---

## Шаг 5 — Получение SSL сертификата (Let's Encrypt)

Сначала запустим только Nginx в HTTP-режиме для верификации домена:

```bash
cd /opt/indexall/docker

# Создаём папки для certbot
mkdir -p certbot/conf certbot/www

# Временный nginx только для certbot (HTTP)
docker run --rm -d --name nginx-temp \
  -p 80:80 \
  -v $(pwd)/certbot/www:/var/www/certbot \
  nginx:alpine

# Получаем сертификат
docker run --rm \
  -v $(pwd)/certbot/conf:/etc/letsencrypt \
  -v $(pwd)/certbot/www:/var/www/certbot \
  certbot/certbot certonly --webroot \
  --webroot-path=/var/www/certbot \
  --email sotnev.aleksei@yandex.ru \
  --agree-tos --no-eff-email \
  -d nkupro.ru -d www.nkupro.ru -d api.nkupro.ru

# Останавливаем временный nginx
docker stop nginx-temp
```

---

## Шаг 6 — Запуск проекта

```bash
cd /opt/indexall/docker

# Сборка и запуск всех сервисов
docker-compose -f docker-compose.prod.yml up -d --build

# Проверить логи
docker-compose -f docker-compose.prod.yml logs -f
```

---

## Шаг 7 — Проверка

- Сайт: https://nkupro.ru
- API:   https://api.nkupro.ru/api

---

## Полезные команды

```bash
# Посмотреть статус контейнеров
docker-compose -f docker/docker-compose.prod.yml ps

# Логи конкретного сервиса
docker-compose -f docker/docker-compose.prod.yml logs backend
docker-compose -f docker/docker-compose.prod.yml logs frontend

# Перезапустить после изменений
docker-compose -f docker/docker-compose.prod.yml up -d --build backend

# Остановить всё
docker-compose -f docker/docker-compose.prod.yml down

# Обновить проект (после git push)
git pull
docker-compose -f docker/docker-compose.prod.yml up -d --build
```

---

## Обновление проекта

После любых изменений в коде:

```bash
# На локальной машине (в Cursor):
git add .
git commit -m "описание"
git push

# На VPS:
cd /opt/indexall
git pull
docker-compose -f docker/docker-compose.prod.yml up -d --build
```
