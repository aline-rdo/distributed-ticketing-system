# Ticket checkout frontend

Next.js booking page for the HTTP microservices teaching project.
See the [root README](../README.md) to start the complete application with
`docker compose up --build`.

For frontend development with Node.js 24 or newer:

```sh
npm ci
npm run dev
```

The Axios checkout request uses `NEXT_PUBLIC_PAYMENT_URL`, defaulting to
`http://localhost:8000`. Start all four backends to complete checkout.
Backend calls use Node's native fetch.

```sh
npm run lint
npm run build
npm start
```

`NEXT_PUBLIC_PAYMENT_URL` is embedded during the production build.
