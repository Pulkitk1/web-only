# services/

Future backend integration (data and auth layers) goes here. Nothing is connected: no database, Firebase or
authentication.

`devicePrefs.ts` is the one exception and is **not** a backend: it stores a few small per-device flags in the browser's
localStorage (saved theme, "notification permission asked", rest-day celebrations already shown, pending milestone
celebrations), the web equivalent of Android's DevicePrefs / DataStore.
