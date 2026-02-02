import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { authRouter } from './routes/auth.js';
import { adminRouter } from './routes/admin.js';
import { paymentsRouter } from './routes/payments.js';
import { slotsRouter } from './routes/slots.js';
import { bookingsRouter } from './routes/bookings.js';
import { initRouter } from './routes/init.js';

const app = express();
const PORT = process.env.PORT || 4000;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

app.use(cors({ origin: FRONTEND_URL, credentials: true }));
app.use(express.json());

app.use('/api/auth', authRouter);
app.use('/api/admin', adminRouter);
app.use('/api/payments', paymentsRouter);
app.use('/api/slots', slotsRouter);
app.use('/api/bookings', bookingsRouter);
app.use('/api', initRouter);

app.get('/health', (_, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`RideRonin BE running at http://localhost:${PORT}`);
});
