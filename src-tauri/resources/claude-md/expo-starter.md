# CLAUDE.md — {{PROJECT_NAME}}

Scaffolded with Expo (React Native) on {{DATE}}.

## Architecture

- **Framework:** Expo with React Native
- **Language:** TypeScript
- **Routing:** Expo Router (file-based)

## Project Structure

- `app/` — Expo Router pages (file-based routing)
- `components/` — Reusable React Native components
- `constants/` — App constants (colors, config)
- `hooks/` — Custom React hooks
- `assets/` — Images, fonts, and other static assets

## Commands

- `npx expo start` — Start Expo dev server
- `npx expo start --ios` — Start on iOS simulator
- `npx expo start --android` — Start on Android emulator
- `npx expo start --web` — Start web version
- `npx expo install <package>` — Install Expo-compatible package
- `npx expo prebuild` — Generate native projects

## Conventions

- Screens/pages as files in `app/` directory (Expo Router)
- Use `expo install` instead of `npm install` for native packages (ensures compatibility)
- Styles: use React Native StyleSheet or NativeWind (Tailwind for RN)
- Test on both iOS and Android before committing
- No web-only CSS — all styling via React Native's style system
