# Consisto – Habit Tracker

Consisto is a habit-tracking app that helps you build consistent habits without the pressure of keeping a perfect daily streak.

Most habit trackers make you feel like you failed after one missed day. Consisto is different. It is built for flexible habit building, so you can plan rest days, set weekly goals that fit your life, and keep going at your own pace.

This repository contains **Consisto Web**.

## Features

- **Manage habits:** create, edit, delete and archive habits.
- **Flexible weekly goals:** choose how many days a week you want to do a habit.
- **Planned rest days:** schedule days off so they do not count against you.
- **Streaks:** see your current streak and your best streak.
- **Calendar view:** see your progress for each habit by month.
- **Notes:** add a note to a completed or missed day.
- **Streak freeze:** protect your streak when you miss a day.
- **Coins and wallet:** earn coins as rewards and keep track of them in your wallet.
- **Daily and milestone rewards:** get rewarded for daily progress and for reaching milestones.
- **Dark and light themes.**
- **Guest mode:** try the app without creating an account.
- **Email and password sign-in.**
- **Password reset** by email.
- **Account deletion** from the settings screen.
- **Cloud sync:** your data stays in sync across devices when you sign in.

> Reminders are not available on the web yet. They are shown as "Not available on the web yet" in the app.

## Technologies Used

- React Native Web
- Expo and Expo Router
- TypeScript
- Firebase Authentication
- Cloud Firestore
- Vercel (hosting)

## Installation and Setup

You need [Node.js](https://nodejs.org/) version 22 and npm.

1. Clone the repository:

   ```bash
   git clone https://github.com/Pulkitk1/consisto_web.git
   ```

2. Go into the project folder:

   ```bash
   cd consisto_web
   ```

3. Install the dependencies:

   ```bash
   npm install
   ```

4. Create your environment file by copying the example:

   ```bash
   cp .env.example .env.local
   ```

   On Windows PowerShell, use `Copy-Item .env.example .env.local` instead.

5. Open `.env.local` and add your Firebase Web configuration (see the next section).

6. Run the app locally:

   ```bash
   npm run web
   ```

   Then open http://localhost:8081 in your browser.

7. Create a production build:

   ```bash
   npm run build:web
   ```

   The finished site is written to the `dist` folder.

### Other useful commands

| Command | What it does |
| --- | --- |
| `npm run typecheck` | Checks the TypeScript code for errors |
| `npm test` | Runs the unit tests |
| `npm run verify:build` | Checks the production build |

## Firebase Configuration

Consisto uses **Firebase Authentication** for sign-in and **Cloud Firestore** to store your data.

To set it up, create a Firebase project, add a Web app, and copy its configuration values into `.env.local`. These are the variables that must be filled in:

```
EXPO_PUBLIC_FIREBASE_API_KEY=
EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN=
EXPO_PUBLIC_FIREBASE_PROJECT_ID=
EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET=
EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
EXPO_PUBLIC_FIREBASE_APP_ID=
```

Keep guest import turned off:

```
EXPO_PUBLIC_GUEST_IMPORT_ENABLED=false
```

`.env.example` also lists optional settings for App Check and a support email address. You can leave them empty.

**Keep your secrets safe.** Never commit `.env.local`. It is already ignored by Git. Never put a service account, private key or password in any variable that starts with `EXPO_PUBLIC_`, because those values are copied into the public website.

## Android and Web

Consisto also has an Android app built with Kotlin. The Android app and this web app use the same Firebase backend, so you can sign in on either platform and see the same account data.

## Project Goal

Consisto is built around the idea that consistency matters more than perfection. It encourages users to build sustainable habits at their own pace.
