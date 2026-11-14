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
