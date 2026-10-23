# Mercedes-Benz Luxury Marketplace

A self-contained luxury car marketplace with a Node.js backend (no third-party packages required). Vehicle inventory is served by the API; account credentials and enquiries are stored locally in JSON files under `data/`.

## Run it

Requires Node.js 18 or later.

```sh
npm start
```

Open <http://127.0.0.1:3000>. For automatic server restarts during development, run `npm run dev`.

## API

- `GET /api/health` — service health check
- `GET /api/cars` — inventory; optional `type` and `q` query parameters
- `POST /api/auth/register` — create an account (`name`, `email`, `password`)
- `POST /api/auth/login` — sign in (`email`, `password`)
- `GET /api/auth/me` — current account (requires `Authorization: Bearer <token>`)
- `POST /api/auth/logout` — end the current session
- `POST /api/inquiries` — submit a vehicle enquiry (`name`, `email`, `carId`)
- `POST /api/sell` — submit a valuation request (`name`, `email`, `vehicle`, optional `year`, `mileage`, `phone`, `notes`)

This is a local starter backend, not production hosting. Sessions are held in memory and expire after seven days; user and enquiry records persist in `data/`. Before deploying publicly, add HTTPS, rate limiting, a production database, email verification/password reset, and operational monitoring.
