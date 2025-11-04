// routes/tasks.js
import express from 'express';
import mongoose from 'mongoose';
import { Task } from '../models/task.js';
import { User } from '../models/user.js';
import { buildQueryParams } from '../utils/query.js';

const router = express.Router();

// GET /api/tasks
router.get('/', async (req, res, next) => {
  try {
    const { where, sort, select, skip, limit, count, invalid } = buildQueryParams('Task', req.query);
    if (invalid) return res.status(400).json({ message: 'Invalid JSON in query params', data: null });

    const q = Task.find(where || {});
    if (sort) q.sort(sort);
    if (select) q.select(select);
    if (skip != null && !Number.isNaN(skip)) q.skip(skip);
    if (limit != null && !Number.isNaN(limit)) q.limit(limit);

    if (count) {
      const c = await Task.countDocuments(where || {});
      return res.status(200).json({ message: 'OK', data: c });
    }

    const tasks = await q.lean();
    res.status(200).json({ message: 'OK', data: tasks });
  } catch (err) { next(err); }
});

// POST /api/tasks
router.post('/', async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const {
      name, description, deadline, completed = false,
      assignedUser = '', assignedUserName = 'unassigned'
    } = req.body || {};

    if (!name || !deadline) {
      await session.abortTransaction(); session.endSession();
      return res.status(400).json({ message: 'name and deadline are required', data: null });
    }

    const created = await Task.create([{
      name,
      description: description || '',
      deadline,
      completed: !!completed,
      assignedUser,
      assignedUserName
    }], { session });

    const task = created[0];

    if (assignedUser && !task.completed) {
      const user = await User.findById(assignedUser).session(session);
      if (user) {
        if (!user.pendingTasks.some(id => id.toString() === task._id.toString())) {
          user.pendingTasks.push(task._id);
          await user.save({ session });
        }
        if (task.assignedUserName !== user.name) {
          task.assignedUserName = user.name;
          await task.save({ session });
        }
      } else {
        task.assignedUser = '';
        task.assignedUserName = 'unassigned';
        await task.save({ session });
      }
    }

    await session.commitTransaction(); session.endSession();
    res.status(201).json({ message: 'Created', data: task });
  } catch (err) {
    await session.abortTransaction(); session.endSession();
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
    try {
      const { select, invalid } = buildQueryParams('Task', req.query);
      if (invalid) return res.status(400).json({ message: 'Invalid JSON in query params', data: null });
  
      const projection = select || undefined;
      const task = await Task.findById(req.params.id, projection).lean();  // <-- not .find()
      if (!task) return res.status(404).json({ message: 'Task not found', data: null });
  
      res.status(200).json({ message: 'OK', data: task }); // <-- object, not [task]
    } catch (err) { next(err); }
  });
  

router.put('/:id', async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const {
      name, description = '', deadline, completed = false,
      assignedUser = '', assignedUserName = 'unassigned'
    } = req.body || {};

    if (!name || !deadline) {
      await session.abortTransaction(); session.endSession();
      return res.status(400).json({ message: 'name and deadline are required', data: null });
    }

    const task = await Task.findById(req.params.id).session(session);
    if (!task) {
      await session.abortTransaction(); session.endSession();
      return res.status(404).json({ message: 'Task not found', data: null });
    }

    const prevAssignedUser = task.assignedUser;

    task.name = name;
    task.description = description;
    task.deadline = deadline;
    task.completed = !!completed;
    task.assignedUser = assignedUser || '';
    task.assignedUserName = assignedUser ? assignedUserName : 'unassigned';
    await task.save({ session });

    if (prevAssignedUser) {
      await User.updateOne(
        { _id: prevAssignedUser },
        { $pull: { pendingTasks: task._id } },
        { session }
      );
    }

    if (task.assignedUser && !task.completed) {
      const user = await User.findById(task.assignedUser).session(session);
      if (user) {
        if (!user.pendingTasks.some(id => id.toString() === task._id.toString())) {
          user.pendingTasks.push(task._id);
        }
        await user.save({ session });

        if (task.assignedUserName !== user.name) {
          task.assignedUserName = user.name;
          await task.save({ session });
        }
      } else {
        task.assignedUser = '';
        task.assignedUserName = 'unassigned';
        await task.save({ session });
      }
    }

    await session.commitTransaction(); session.endSession();
    res.status(200).json({ message: 'OK', data: task });
  } catch (err) {
    await session.abortTransaction(); session.endSession();
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const task = await Task.findById(req.params.id).session(session);
    if (!task) {
      await session.abortTransaction(); session.endSession();
      return res.status(404).json({ message: 'Task not found', data: null });
    }

    const assignedUser = task.assignedUser;
    await task.deleteOne({ session });

    if (assignedUser) {
      await User.updateOne(
        { _id: assignedUser },
        { $pull: { pendingTasks: task._id } },
        { session }
      );
    }

    await session.commitTransaction(); session.endSession();
    res.status(204).json({ message: 'No Content', data: null });
  } catch (err) {
    await session.abortTransaction(); session.endSession();
    next(err);
  }
});

export default router;
