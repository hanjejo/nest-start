---
status: accepted
---

# Use rotating refresh sessions for authentication

Identity and Access uses email/password credentials, short-lived access tokens, and rotating refresh tokens backed by server-side refresh sessions. Logout revokes the refresh session; OAuth and social login are outside v1, keeping authentication self-contained for local development and end-to-end tests.
