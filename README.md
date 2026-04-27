# C Mediebevakning – Railway App

Webbapp som automatiskt genererar och mejlar en medierapport om Centerpartiet varje söndag kl 15:00.

## Driftsätt på Railway

### 1. Skapa projekt på Railway
- Gå till railway.app → New Project → Deploy from GitHub repo
- Ladda upp den här mappen som ett GitHub-repo (eller använd Railway CLI)

### 2. Sätt miljövariabler
I Railway → ditt projekt → Variables, lägg till:

| Variabel | Värde |
|---|---|
| `ANTHROPIC_API_KEY` | Din Anthropic API-nyckel |
| `GMAIL_USER` | dgedstrom@gmail.com |
| `GMAIL_APP_PASSWORD` | Ditt Gmail app-lösenord |
| `MOTTAGARE` | gustaf.arnander@riksdagen.se,dan.edstrom@centerpartiet.se |

### 3. Deploya
Railway bygger och startar appen automatiskt.
Du får en URL, t.ex. `medierapport.up.railway.app`.

## Användning

- Öppna URL:en i webbläsaren
- Klicka **"Gör rapport direkt"** för att trigga en körning nu
- Rapporten genereras och mejlas automatiskt
- Varje söndag kl 15:00 sker det automatiskt

## Lokalt test

```bash
npm install
export ANTHROPIC_API_KEY=sk-ant-...
export GMAIL_USER=dgedstrom@gmail.com
export GMAIL_APP_PASSWORD=xxxx xxxx xxxx xxxx
export MOTTAGARE=dan.edstrom@centerpartiet.se
node server.js
```
