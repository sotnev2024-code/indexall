# INDEXALL Fullstack

Система учёта оборудования для электромонтажных проектов.

## 📋 Стек технологий

### Backend
- **NestJS** — модульная архитектура API
- **TypeScript** — типизация всего проекта
- **PostgreSQL** — основная база данных
- **TypeORM** — ORM для работы с БД
- **JWT** — аутентификация и авторизация
- **class-validator** — валидация данных

### Frontend
- **Next.js 14** — React-фреймворк с App Router
- **React 18** — UI библиотека
- **TypeScript** — типизация
- **Tailwind CSS** — стилизация
- **TanStack Table** — продвинутые таблицы
- **Zustand** — управление состоянием
- **React Hook Form** — формы

### Infrastructure
- **Docker** — контейнеризация
- **Docker Compose** — оркестрация
- **pnpm workspaces** — монорепозиторий

## 📁 Структура проекта

```
indexall-fullstack/
├── backend/           # NestJS API сервер
├── frontend/          # Next.js клиент
├── shared/            # Общие типы и утилиты
├── docker/            # Docker конфигурации
├── package.json       # Корневой package.json
└── README.md
```

## 🚀 Быстрый старт

### Требования
- Node.js >= 18.0.0
- npm >= 9.0.0
- Docker и Docker Compose

### Установка

1. **Установите зависимости**
```bash
npm install
```

2. **Настройте переменные окружения**

Скопируйте `.env.example` файлы в backend и frontend:
```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

3. **Запустите базу данных**
```bash
npm run docker:up
```

4. **Запустите миграции**
```bash
npm run migrate
```

5. **Запустите проект в режиме разработки**
```bash
npm run dev
```

Доступ:
- Frontend: http://localhost:3000
- Backend API: http://localhost:4000
- PostgreSQL: localhost:5432

## 📦 Основные команды

```bash
# Разработка
npm run dev                    # Запуск backend + frontend
npm run dev:backend            # Только backend
npm run dev:frontend           # Только frontend

# Сборка
npm run build                  # Сборка всего проекта
npm run build:backend          # Сборка backend
npm run build:frontend         # Сборка frontend

# Docker
npm run docker:up              # Поднять контейнеры
npm run docker:down            # Остановить контейнеры
npm run docker:build           # Пересобрать контейнеры

# Миграции
npm run migrate                # Применить миграции
npm run migrate:generate       # Создать новую миграцию
```

## 🔐 Переменные окружения

### Backend (.env)
```env
PORT=4000
DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_USER=postgres
DATABASE_PASSWORD=postgres
DATABASE_NAME=indexall
JWT_SECRET=your-secret-key
JWT_EXPIRES_IN=7d
```

### Frontend (.env)
```env
NEXT_PUBLIC_API_URL=http://localhost:4000
NEXT_PUBLIC_APP_NAME=INDEXALL
```

## 📊 Сущности

- **User** — пользователи (email, password, name, plan, status)
- **Project** — проекты (name, userId, createdAt)
- **Sheet** — листы проектов (name, projectId, createdAt)
- **Equipment** — оборудование (name, brand, article, qty, unit, price, coef, total)
- **Template** — шаблоны проектов (name, meta, files)

## 🏗️ Архитектура

### Backend модули
- **Auth** — регистрация, логин, JWT токены
- **Users** — CRUD пользователей
- **Projects** — CRUD проектов
- **Sheets** — CRUD листов
- **Equipment** — CRUD оборудования
- **Templates** — CRUD шаблонов
- **Admin** — административные функции

### Frontend страницы
- `/` — главная (список проектов)
- `/auth/login` — вход
- `/auth/register` — регистрация
- `/projects/:id` — проект с листами
- `/templates` — шаблоны
- `/admin` — админ-панель

## 📝 Лицензия

MIT
