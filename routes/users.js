// routes/users.js
import express from 'express';
import mongoose from 'mongoose';
import { User } from '../models/user.js';
import { Task } from '../models/task.js';
import { buildQueryParams } from '../utils/query.js';

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const { where, sort, select, skip, limit, count, invalid } = buildQueryParams('User', req.query);
    if (invalid) return res.status(400).json({ message: 'Invalid JSON in query params', data: null });

    const q = User.find(where || {});
    if (sort) q.sort(sort);
    if (select) q.select(select);
    if (skip != null && !Number.isNaN(skip)) q.skip(skip);
    if (limit != null && !Number.isNaN(limit)) q.limit(limit);

    if (count) {
      const c = await User.countDocuments(where || {});
      return res.status(200).json({ message: 'OK', data: c });
    }

    const users = await q.lean();
    res.status(200).json({ message: 'OK', data: users });
  } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  try {
    const { name, email, pendingTasks } = req.body || {};
    if (!name || !email) return res.status(400).json({ message: 'name and email are required', data: null });

    const user = await User.create({ name, email, pendingTasks: pendingTasks || [] });
    res.status(201).json({ message: 'Created', data: user });
  } catch (err) { next(err); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const { select, invalid } = buildQueryParams('User', req.query);
    if (invalid) return res.status(400).json({ message: 'Invalid JSON in query params', data: null });

    const projection = select || undefined;
    const user = await User.findById(req.params.id, projection).lean();
    if (!user) return res.status(404).json({ message: 'User not found', data: null });

    res.status(200).json({ message: 'OK', data: user });
  } catch (err) { next(err); }
});

router.put('/:id', async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { name, email, pendingTasks } = req.body || {};
    if (!name || !email) {
      await session.abortTransaction(); session.endSession();
      return res.status(400).json({ message: 'name and email are required', data: null });
    }

    const user = await User.findById(req.params.id).session(session);
    if (!user) {
      await session.abortTransaction(); session.endSession();
      return res.status(404).json({ message: 'User not found', data: null });
    }

    user.name = name;
    user.email = email;
    user.pendingTasks = Array.isArray(pendingTasks) ? pendingTasks : [];
    await user.save({ session });

    const userIdStr = user._id.toString();

    if (user.pendingTasks.length > 0) {
      const tasksToAssign = await Task.find({ _id: { $in: user.pendingTasks } }).session(session);
      for (const t of tasksToAssign) {
        t.assignedUser = userIdStr;
        t.assignedUserName = user.name;
        await t.save({ session });
      }
    }

    await Task.updateMany(
      { assignedUser: userIdStr, _id: { $nin: user.pendingTasks } },
      { $set: { assignedUser: '', assignedUserName: 'unassigned' } },
      { session }
    );

    await session.commitTransaction(); session.endSession();
    res.status(200).json({ message: 'OK', data: user });
  } catch (err) {
    await session.abortTransaction(); session.endSession();
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const user = await User.findById(req.params.id).session(session);
    if (!user) {
      await session.abortTransaction(); session.endSession();
      return res.status(404).json({ message: 'User not found', data: null });
    }

    await Task.updateMany(
      { assignedUser: user._id.toString() },
      { $set: { assignedUser: '', assignedUserName: 'unassigned' } },
      { session }
    );

    await user.deleteOne({ session });

    await session.commitTransaction(); session.endSession();
    res.status(204).json({ message: 'No Content', data: null });
  } catch (err) {
    await session.abortTransaction(); session.endSession();
    next(err);
  }
});

export default router;
