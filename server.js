// server.js (root)
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import mongoose from 'mongoose';

import usersRouter from './routes/users.js';
import tasksRouter from './routes/tasks.js';

dotenv.config();

const app = express();
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

const uri = process.env.MONGODB_URI;
await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
console.log('Connected to MongoDB');

app.get('/api/health', (_req, res) => {
  res.status(200).json({ message: 'OK', data: { service: 'llama.io', status: 'healthy' } });
});

app.use('/api/users', usersRouter);
app.use('/api/tasks', tasksRouter);

// 404
app.use((req, res) => res.status(404).json({ message: 'Not Found', data: null }));

app.use((err, _req, res, _next) => {
  console.error(err);

  if (err?.code === 11000 && err?.keyPattern?.email) {
    return res.status(400).json({ message: 'A user with that email already exists.', data: null });
  }
  if (err?.name === 'ValidationError') {
    const msg = Object.values(err.errors)[0]?.message || 'Validation error';
    return res.status(400).json({ message: msg, data: null });
  }
  if (err?.name === 'CastError') {
    return res.status(400).json({ message: 'Invalid identifier', data: null });
  }

  res.status(500).json({ message: 'Server error', data: null });
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`API listening on :${port}`));
