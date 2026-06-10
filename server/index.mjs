import express from 'express';
const app = express();
app.use(express.json({ limit: '8mb' }));

app.get('/api/health', (_req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 8787;
app.listen(PORT, () => console.log(`hatch server on :${PORT}`));
