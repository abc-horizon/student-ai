# Assignment Review Tool

A tool for uploading assignments and generating AI-assisted review reports against a set of criteria.

## Running the project

### Frontend

```
cd frontend
npm install
npm run dev
```

### Backend

```
cd backend
npm install
cp .env.example .env   # then fill in DEEPSEEK_API_KEY
npm run dev
```

The backend listens on `http://localhost:4000` by default (`PORT` in `.env`).

## Project Status

Standalone app complete (Steps 1–9) — full pipeline working: upload, validation, extraction, usage-limit policy, RAG-grounded AI review via DeepSeek, and a fully Arabic report UI. Next phase: Moodle LTI 1.3 integration.

## Known limitations

- The one-time-use policy is only enforced via a client-supplied `assignmentId` and is trivially bypassable until real Moodle/LTI identity is wired in.
- The RAG knowledge base is currently specific to the Sustainable Energy (Unit 28) rubric/brief and would need new knowledge files for other units.
- The provider behind `DEEPSEEK_API_KEY`/`DEEPSEEK_BASE_URL` is DeepSeek's Anthropic-compatible endpoint, not a real Anthropic account.
