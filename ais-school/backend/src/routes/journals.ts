import { Router } from 'express';
import { requireRole } from '../middleware/auth';
import { store } from '../store';

const router = Router();

// Draft journal entry creation
router.post('/journals', requireRole(['accounts_officer', 'bursar']), (req, res) => {
  const isBursar = req.user.role === 'bursar';
  const journal = {
    id: `JNL-${Date.now()}`,
    ...req.body,
    status: isBursar ? 'POSTED' : 'PENDING_APPROVAL',
    createdBy: req.user.id,
    createdAt: new Date().toISOString()
  };
  store.journals.push(journal);
  res.status(201).json(journal);
});

// Bursar approval route
router.post('/journals/:id/approve', requireRole(['bursar']), (req, res) => {
  const journal = store.journals.find((j: any) => j.id === req.params.id);
  if (!journal) return res.status(404).json({ error: 'Journal entry not found' });
  
  journal.status = 'POSTED';
  journal.approvedBy = req.user.id;
  journal.approvedAt = new Date().toISOString();
  res.json(journal);
});

export default router;