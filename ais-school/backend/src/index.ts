import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

import journalsRouter from './routes/journals.js';
import budgetsRouter from './routes/budgets.js';
import admissionsRouter from './routes/admissions.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Core Middleware
app.use(cors());
app.use(express.json());

// Health Check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Phase 2 Workflow Routers
app.use('/api', journalsRouter);
app.use('/api', budgetsRouter);
app.use('/api', admissionsRouter);

// Start Server
app.listen(PORT, () => {
  console.log(`AIS Backend running on port ${PORT}`);
});

export default app;
