import { Router } from 'express';
import { requireRole } from '../middleware/auth';
import { store } from '../store';

const router = Router();

// Bursar sets program quota
router.post('/quotas', requireRole(['bursar']), (req, res) => {
  const { programId, maxQuota } = req.body;
  if (!store.quotas) store.quotas = {};
  store.quotas[programId] = maxQuota;
  res.json({ message: 'Quota updated successfully', programId, maxQuota });
});

// Admissions Officer admits student subject to quota check
router.post('/students/admit', requireRole(['admissions_officer']), (req, res) => {
  const { programId, student } = req.body;
  const quota = store.quotas?.[programId];
  const currentCount = store.students.filter((s: any) => s.programId === programId).length;

  if (!quota || currentCount >= quota) {
    return res.status(403).json({ error: 'Cannot admit student: Program quota reached or not set by Bursar.' });
  }

  const newStudent = { id: `STU-${Date.now()}`, programId, ...student };
  store.students.push(newStudent);
  res.status(201).json(newStudent);
});

export default router;