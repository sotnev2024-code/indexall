# INDEXALL — Полное руководство по запуску

## 📋 Предварительные требования

Убедитесь, что у вас установлены:

- **Node.js** >= 18.0.0 ([скачать](https://nodejs.org/))
- **npm** >= 9.0.0 (идёт в комплекте с Node.js)
- **Docker** и **Docker Desktop** ([скачать](https://www.docker.com/products/docker-desktop/))

## 🚀 Быстрый старт

### Шаг 1: Установка зависимостей

Откройте PowerShell в папке проекта и выполните:

```powershell
cd indexall-fullstack
npm install
```

### Шаг 2: Настройка переменных окружения

Скопируйте файлы окружения:

```powershell
Copy-Item backend\.env.example backend\.env
Copy-Item frontend\.env.example frontend\.env.local
```

### Шаг 3: Запуск базы данных

```powershell
npm run docker:up
```

Дождитесь сообщения "indexall-db is healthy".

### Шаг 4: Применение миграций

```powershell
npm run migrate
```

### Шаг 5: Запуск проекта

```powershell
npm run dev
```

Проект запущен! Откройте в браузере:
- **Frontend**: http://localhost:3000
- **Backend API**: http://localhost:4000
- **API Документация**: http://localhost:4000/docs

## 🔐 Демо доступ

```
Email: demo@indexall.com
Пароль: demo123
```

## 📦 Основные команды

### Разработка

```powershell
# Запуск backend + frontend
npm run dev

# Только backend
npm run dev:backend

# Только frontend
npm run dev:frontend
```

### Docker

```powershell
# Поднять контейнеры
npm run docker:up

# Остановить контейнеры
npm run docker:down

# Пересобрать контейнеры
npm run docker:build
```

### Миграции

```powershell
# Применить миграции
npm run migrate

# Создать новую миграцию
npm run migrate:generate --name=NewMigration
```

## 🏗️ Структура проекта

```
indexall-fullstack/
├── backend/              # NestJS API сервер
│   ├── src/
│   │   ├── auth/        # Аутентификация (JWT)
│   │   ├── users/       # Пользователи
│   │   ├── projects/    # Проекты
│   │   ├── sheets/      # Листы проектов
│   │   ├── equipment/   # Оборудование
│   │   ├── templates/   # Шаблоны
│   │   └── database/    # Миграции БД
│   ├── package.json
│   └── Dockerfile
│
├── frontend/             # Next.js клиент
│   ├── src/
│   │   └── app/
│   │       ├── auth/    # Страницы авторизации
│   │       └── page.tsx # Главная страница
│   ├── package.json
│   └── Dockerfile
│
├── shared/               # Общие типы TypeScript
│   └── src/index.ts
│
├── docker/               # Docker конфигурации
│   └── docker-compose.yml
│
├── package.json          # Корневой package.json
└── README.md
```

## 🗄️ База данных

### Подключение к PostgreSQL

```
Host: localhost
Port: 5432
Database: indexall
User: postgres
Password: postgres
```

### Таблицы

- **users** — пользователи (email, password, name, plan, status)
- **projects** — проекты (name, userId)
- **sheets** — листы проектов (name, projectId)
- **equipment_rows** — позиции оборудования (name, brand, article, qty, price, etc.)
- **templates** — шаблоны (name, meta, files)

## 🔧 API Endpoints

### Auth
- `POST /api/auth/login` — вход
- `POST /api/auth/register` — регистрация
- `POST /api/auth/logout` — выход

### Projects
- `GET /api/projects` — список проектов
- `POST /api/projects` — создать проект
- `GET /api/projects/:id` — проект по ID
- `PATCH /api/projects/:id` — обновить проект
- `DELETE /api/projects/:id` — удалить проект

### Sheets
- `GET /api/sheets` — список листов
- `POST /api/sheets` — создать лист
- `GET /api/sheets/:id` — лист по ID
- `PATCH /api/sheets/:id` — обновить лист
- `DELETE /api/sheets/:id` — удалить лист

### Equipment
- `GET /api/equipment` — список позиций
- `POST /api/equipment` — создать позицию
- `POST /api/equipment/bulk` — массовое создание
- `PATCH /api/equipment/:id` — обновить позицию
- `DELETE /api/equipment/:id` — удалить позицию

### Templates
- `GET /api/templates` — список шаблонов
- `POST /api/templates` — создать шаблон
- `PATCH /api/templates/:id` — обновить шаблон
- `DELETE /api/templates/:id` — удалить шаблон

Полная документация API: http://localhost:4000/docs

## 🛠️ Технологии

### Backend
- NestJS 10 — модульный фреймворк
- TypeORM — ORM для работы с БД
- PostgreSQL — реляционная БД
- JWT — аутентификация
- bcrypt — хеширование паролей
- class-validator — валидация данных
- Swagger — API документация

### Frontend
- Next.js 14 — React фреймворк
- React 18 — UI библиотека
- TypeScript — типизация
- Tailwind CSS — стилизация
- Axios — HTTP клиент
- Zustand — управление состоянием

### Infrastructure
- Docker — контейнеризация
- Docker Compose — оркестрация
- npm workspaces — монорепозиторий

## 🐛 Решение проблем

### Ошибка: "Port 5432 already in use"

Освободите порт или измените в `docker/docker-compose.yml`:
```yaml
ports:
  - "5433:5432"  # Используйте 5433 вместо 5432
```

### Ошибка: "Cannot find module"

Переустановите зависимости:
```powershell
Remove-Item -Recurse -Force node_modules
npm install
```

### Ошибка: "Connection refused"

Убедитесь, что Docker контейнеры запущены:
```powershell
docker ps
```

### Сброс базы данных

```powershell
npm run docker:down
docker volume rm indexall-fullstack_postgres_data
npm run docker:up
npm run migrate
```

## 📝 Лицензия

MIT

## 👥 Контакты

Для вопросов и предложений создавайте issues в репозитории проекта.
