# UW Wildlife Backend API Documentation

This document describes how to interact with the main API features of the UW Wildlife backend: **Account**, **Discussion**, and **Reports**. All endpoints are prefixed by their respective route (e.g., `/auth`, `/discussion`, `/reports`).

---

## Base URL

```
https://api.uwwildlife.com
```

---

## General

### Endpoints

- `GET /docs` — Get API documentation
- `GET /status` — Check the status of the API

## Authentication (Account)

All account-related endpoints are under `/auth`.

### Endpoints

- `POST /auth/register` — Register a new user
- `POST /auth/login` — Log in a user
- `POST /auth/logout` — Log out the current user
- `POST /auth/status` — Check if the user is logged in
- `GET /auth/details` — Get the current authenticated user's info

**Note:**
- Authentication uses cookies: `authToken` and `userId`.

#### Example: Register
```http
POST /auth/register
Content-Type: application/json

{
  "username": "your_username",
  "password": "YourPassword123"
}
```

#### Example: Login
```http
POST /auth/login
Content-Type: application/json

{
  "username": "your_username",
  "password": "YourPassword123"
}
```

#### Example: Logout
```http
POST /auth/logout
(Cookies: authToken, userId required)
```

#### Example: Check Status
```http
POST /auth/status
(Cookies: authToken, userId required)
```

#### Example: Get User Details
```http
GET /auth/details
(Cookies: authToken, userId required)
```

---

## Reports

All report-related endpoints are under `/reports`.

### Endpoints

- `POST /reports/create` — Submit a new wildlife report (requires authentication)
- `GET /reports/get?report_id=...` — Get details for a specific report
- `GET /reports/page?page=...` — Get a paginated list of reports (10 per page)

#### Example: Submit a Report
```http
POST /reports/create
Content-Type: application/json
(Cookies: authToken, userId required)

{
  "reportData": {
    "location_lat": 47.655,
    "location_lon": -122.308,
    "severity": "moderate",
    "animal_type": "Raccoon",
    "description": "Seen near the fountain at night.",
    "date": "2025-06-02T21:15:00Z",
    "image": "data:image/jpeg;base64,..." // Optional
  }
}
```

#### Example Response
```json
{
  "message": "Report created successfully",
  "report_id": 12345678
}
```

#### Example: Get a Report
```http
GET /reports/get?report_id=12345678
```

#### Example: Get Multiple Reports (Paginated)
```http
GET /reports/page?page=1
```

#### Example Response
```json
{
  "reports": [
    {
      "user_id": "123456789012",
      "report_id": 12345678,
      "location_lat": 47.655,
      "location_lon": -122.308,
      "severity": 2,
      "animal_type": "Raccoon",
      "description": "Seen near the fountain at night.",
      "date_created": "2025-06-02T21:15:00Z",
      "imageExists": 1,
      "image": "data:image/jpeg;base64,..." // Only present if imageExists is 1
    },
    // ... up to 10 reports per page ...
  ],
  "hasMore": true // Indicates if there are more pages available
}
```

---

## Discussion

All discussion-related endpoints are under `/discussion`.

### Endpoints

- `POST /discussion/create` — Create a new discussion post (requires authentication)
- `GET /discussion/get?post_id=...` — Get a specific discussion post
- `GET /discussion/page?page=...` — Get a paginated list of discussion posts (10 per page)

#### Example: Create a Discussion Post
```http
POST /discussion/create
Content-Type: application/json
(Cookies: authToken, userId required)

{
  "postData": {
    "title": "Wildlife Sighting Near Suzzallo",
    "message": "Anyone else see the owl last night?"
  }
}
```

#### Example Response
```json
{
  "message": "Post created successfully",
  "post_id": 87654321
}
```

#### Example: Get a Discussion Post
```http
GET /discussion/get?post_id=87654321
```

#### Example: Get Discussion Page
```http
GET /discussion/page?page=1
```

---

## CORS and Credentials

- Only requests from the following origins are allowed:
  - `https://uwwildlife.com`
  - `https://www.uwwildlife.com`
- Credentials (cookies) are required for authentication-protected endpoints.

---

## General Notes

- All endpoints expect and return JSON unless otherwise specified.
- For protected endpoints, ensure you are authenticated (cookies/session).
- For more details on request/response formats, contact Wyatt Ford.

---

**Contact:** wjford@uw.edu
