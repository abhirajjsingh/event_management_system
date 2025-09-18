# Event Management System

Simple events API + frontend using Express and SQLite.

## Setup
1. Install dependencies
```powershell
npm install
```

2. Run the API server
```powershell
npm run dev
```
The server runs at `http://localhost:3000`.

3. Open the frontend
- Open `index.html` in your browser (or use Live Server).

## API Overview
- Auth
  - POST `/api/auth/register` { email, name, password }
  - POST `/api/auth/login` { email, password } -> { token, userId }
- Events
  - POST `/api/events` (auth)
  - GET `/api/events`
  - GET `/api/events/:id`
  - PUT `/api/events/:id` (auth, creator only)
  - DELETE `/api/events/:id` (auth, creator only)
- Registrations
  - POST `/api/events/:id/register` (auth)
  - DELETE `/api/events/:id/register` (auth)
  - GET `/api/users/:id/registrations` (auth, same user only)

## Notes
- Capacity enforced; duplicate registrations prevented.
- Only creators can modify/delete their events.
- SQLite database file: `events.sqlite`.

- Configure `JWT_SECRET` via environment variable in production.
