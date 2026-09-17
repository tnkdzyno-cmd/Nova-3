import { Router } from 'express';
import { requireRole } from '../middleware/auth';
import { store } from '../store';

const router = Router();

// Accounts Officer creates draft budget
router.post('/budgets', requireRole(['accounts_officer']), (req, res) => {
  const budget = {
    id: `BGT-${Date.now()}`,
    ...req.body,
    status: 'DRAFT',
    createdBy: req.user.id
  };
  store.budgets.push(budget);
  res.status(201).json(budget);
});

// Bursar authorizes draft budget
router.post('/budgets/:id/authorize', requireRole(['bursar']), (req, res) => {
  const budget = store.budgets.find((b: any) => b.id === req.params.id);
  if (!budget) return res.status(404).json({ error: 'Budget not found' });

  budget.status = 'AUTHORIZED';
  budget.authorizedBy = req.user.id;
  res.json(budget);
});

export default router;