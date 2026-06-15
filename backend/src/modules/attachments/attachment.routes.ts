import { Router, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { query } from '../../config/database';
import { authenticate, AuthRequest } from '../../middleware/auth';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const type = (req as any).params.reference_type || 'general';
    const refId = (req as any).params.reference_id || 'temp';
    const dir = path.join('uploads', 'attachments', type, refId);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, uuidv4() + ext);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowed = [
      'image/jpeg', 'image/png', 'image/gif',
      'application/pdf',
      'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/plain', 'text/csv',
    ];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('File type not allowed') as any);
  },
});

// Upload attachment
router.post('/upload/:reference_type/:reference_id', authenticate, upload.single('file'), async (req: AuthRequest, res: Response) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const id = uuidv4();
    await query(
      'INSERT INTO attachments (id, reference_type, reference_id, original_name, stored_name, mime_type, file_size, file_path, uploaded_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [id, req.params.reference_type, req.params.reference_id, req.file.originalname, req.file.filename, req.file.mimetype, req.file.size, req.file.path, req.user!.id]
    );

    res.status(201).json({ id, original_name: req.file.originalname, stored_name: req.file.filename, mime_type: req.file.mimetype, file_size: req.file.size, created_at: new Date().toISOString() });
  } catch (error: any) {
    if (req.file?.path) fs.unlinkSync(req.file.path);
    res.status(500).json({ error: error.message });
  }
});

// List attachments for a document
router.get('/list/:reference_type/:reference_id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const r = await query(
      'SELECT id, original_name, stored_name, mime_type, file_size, created_at FROM attachments WHERE reference_type = $1 AND reference_id = $2 ORDER BY created_at DESC',
      [req.params.reference_type, req.params.reference_id]
    );
    res.json(r.rows);
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

// Download / View attachment
router.get('/download/:id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const r = await query('SELECT * FROM attachments WHERE id = $1', [req.params.id]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const a = r.rows[0];
    if (!fs.existsSync(a.file_path)) return res.status(404).json({ error: 'File not found' });
    res.download(a.file_path, a.original_name);
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

// Preview (inline) attachment
router.get('/preview/:id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const r = await query('SELECT * FROM attachments WHERE id = $1', [req.params.id]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const a = r.rows[0];
    if (!fs.existsSync(a.file_path)) return res.status(404).json({ error: 'File not found' });
    res.setHeader('Content-Type', a.mime_type);
    res.sendFile(path.resolve(a.file_path));
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

// Delete attachment
router.delete('/:id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const r = await query('SELECT * FROM attachments WHERE id = $1', [req.params.id]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const a = r.rows[0];
    if (fs.existsSync(a.file_path)) fs.unlinkSync(a.file_path);
    await query('DELETE FROM attachments WHERE id = $1', [req.params.id]);
    res.json({ message: 'Deleted' });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

export default router;
