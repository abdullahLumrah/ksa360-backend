# KSA Guide backend

Three APIs. Flutter reads these; nothing for Eat/Play is bundled in the app.

```
cd ~/Desktop/ksa-guide-backend
npm install
npm run seed
npm start
```

`http://127.0.0.1:4000`

## 1. Restaurants
Restaurant row includes its YouTube `video`.

- `GET /restaurants/nearby?lat=&lng=`
- `GET /restaurants/:id`
- `POST /restaurants`

## 2. Activities
Activity row includes its YouTube `video`.

- `GET /activities/nearby?lat=&lng=`
- `GET /activities/:id`
- `POST /activities`

## 3. Reels
Every reel in the app lives here (activity clips + restaurant clips).

- `GET /reels`
- `GET /reels/:id`
- `POST /reels` `{ youtubeId, source: "activity"|"restaurant", placeId, title, hook, city }`

## 4. Guides
Nested government/service categories and their posts. Each post field is a column.

- `GET /guides` bootstrap: categories + posts (no full body)
- `GET /guides/categories`
- `GET /guides/categories/:id` category, children, and posts
- `GET /guides/posts?category=&q=`
- `GET /guides/posts/:id` includes `body`
- `POST /guides/categories`
- `POST /guides/posts`

## 5. Auth
Users live in the `users` table. Email accounts store a password hash. Google accounts store `google_id`.

- `POST /auth/register` `{ name, email, password, confirmPassword, dateOfBirth, gender }`
- `POST /auth/login` `{ email, password }`
- `POST /auth/google` `{ idToken }`
- `POST /auth/logout` Bearer token (revokes that session)
- `GET /auth/me` Bearer token
- `PATCH /auth/me` `{ name, dateOfBirth, gender }`

Send `Authorization: Bearer <jwt>` on every request. No token = guest. Invalid/revoked token = 401. Auth routes are rate-limited.
