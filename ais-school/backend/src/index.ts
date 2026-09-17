import journalsRouter from './routes/journals';
import budgetsRouter from './routes/budgets';
import admissionsRouter from './routes/admissions';

app.use('/api', journalsRouter);
app.use('/api', budgetsRouter);
app.use('/api', admissionsRouter);