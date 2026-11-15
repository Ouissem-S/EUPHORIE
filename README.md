# EUPHORIE
A live concert, brought home. Phones become synced wristband lights and the crowd around you.


## Run locally

Recommended — starts the server and the web app together (Ctrl+C stops both):

```sh
./dev.sh
```

Or run them manually in two terminals. uvicorn must be run from `/server`, npm from `/web`.

```sh
# server (from /server, with .venv activated)
EUPHORIE_KEY="pick-a-secret" uvicorn app.main:app --reload --reload-dir app --port 8000

# web (from /web)
npm run dev
```

Then open `/tv` on the TV and `/control?key=YOUR_KEY` on your phone.

## Host voice (ElevenLabs, optional)

The host voice speaks lines on the TV (from the control page's **Host** card) and on the
phones. Without a key everything still works; the TV just types the line silently.

Put your key and voice in `server/.env` (git-ignored):

```sh
ELEVENLABS_API_KEY=your-key            # elevenlabs.io → profile → API Keys
ELEVENLABS_VOICE_ID=your-voice-id      # Voices → your voice → copy ID
# ELEVENLABS_MODEL_ID=eleven_multilingual_v2   # optional
```

…or export them in your shell before `./dev.sh`, which passes them through. Restart the
server after changing them. Generated audio is cached in `server/app/voice_cache/`.
