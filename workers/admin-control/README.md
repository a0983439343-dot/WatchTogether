# WatchTogether Admin Control Worker

Endpoint used by Admin 2.0 for maintenance-mode control.

## Deploy
```
cd workers/admin-control
wrangler deploy
```

The worker needs access to the Firebase Realtime Database by forwarding the signed-in administrator's Firebase ID token to the database REST API. It does not store Firebase service-account credentials.

After deployment, put the Worker URL into:

`config/firebase-config.js`

as:

`adminControlUrl: "https://YOUR-WORKER.workers.dev"`

The maintenance password is stored as a salted PBKDF2 hash in Realtime Database and is verified server-side by this worker.
