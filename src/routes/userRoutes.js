const express = require('express');
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const { executeQuery, executeTransaction } = require('../config/database');
const { AppError } = require('../middleware/errorMiddleware');
const { verifyToken, requireAdmin } = require('../middleware/authMiddleware');
const { 
  validateCreateUser, 
  validateUpdateUser, 
  validateUUID, 
  validatePagination 
} = require('../middleware/validationMiddleware');

const router = express.Router();

// All user routes require authentication and admin role
router.use(verifyToken);
router.use(requireAdmin);

// GET /api/users - List all users with pagination
router.get('/', validatePagination, async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;
    const search = req.query.search || '';

    let whereClause = '';
    let queryParams = [];

    if (search) {
      whereClause = 'WHERE p.name LIKE ? OR u.email LIKE ?';
      queryParams = [`%${search}%`, `%${search}%`];
    }

    // Get total count
    const countQuery = `
      SELECT COUNT(*) as total 
      FROM users u 
      JOIN profiles p ON u.id = p.id 
      ${whereClause}
    `;
    const countResult = await executeQuery(countQuery, queryParams);
    const total = countResult[0].total;

    // Get users with pagination
    const usersQuery = `
      SELECT 
        u.id, u.email, u.created_at as user_created_at,
        p.name, p.phone, p.role, p.status, p.avatar, p.last_login, p.created_at
      FROM users u 
      JOIN profiles p ON u.id = p.id 
      ${whereClause}
      ORDER BY p.created_at DESC 
      LIMIT ? OFFSET ?
    `;
    const users = await executeQuery(usersQuery, [...queryParams, limit, offset]);

    const totalPages = Math.ceil(total / limit);

    res.json({
      success: true,
      data: users,
      pagination: {
        page,
        limit,
        total,
        totalPages
      }
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/users - Create new user
router.post('/', validateCreateUser, async (req, res, next) => {
  try {
    const { email, password, name, phone, role } = req.body;

    // Check if email already exists
    const existingUsers = await executeQuery(
      'SELECT id FROM users WHERE email = ?',
      [email]
    );

    if (existingUsers.length > 0) {
      throw new AppError('Email already exists', 409, 'EMAIL_EXISTS');
    }

    // Hash password
    const saltRounds = parseInt(process.env.BCRYPT_ROUNDS) || 12;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    // Generate UUID for new user
    const userId = uuidv4();

    // Create user and profile in transaction
    const queries = [
      {
        query: 'INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)',
        params: [userId, email, passwordHash]
      },
      {
        query: 'INSERT INTO profiles (id, name, email, phone, role) VALUES (?, ?, ?, ?, ?)',
        params: [userId, name, email, phone || null, role]
      }
    ];

    await executeTransaction(queries);

    // Get created user data
    const newUser = await executeQuery(
      `SELECT 
        u.id, u.email, u.created_at as user_created_at,
        p.name, p.phone, p.role, p.status, p.created_at
       FROM users u 
       JOIN profiles p ON u.id = p.id 
       WHERE u.id = ?`,
      [userId]
    );

    res.status(201).json({
      success: true,
      message: 'User created successfully',
      data: newUser[0]
    });
  } catch (error) {
    next(error);
  }
});

// PUT /api/users/:id - Update user
router.put('/:id', validateUUID('id'), validateUpdateUser, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, phone, role, status } = req.body;

    // Check if user exists
    const existingUsers = await executeQuery(
      'SELECT id FROM profiles WHERE id = ?',
      [id]
    );

    if (existingUsers.length === 0) {
      throw new AppError('User not found', 404, 'USER_NOT_FOUND');
    }

    // Build update query dynamically
    const updateFields = [];
    const updateValues = [];

    if (name !== undefined) {
      updateFields.push('name = ?');
      updateValues.push(name);
    }
    if (phone !== undefined) {
      updateFields.push('phone = ?');
      updateValues.push(phone);
    }
    if (role !== undefined) {
      updateFields.push('role = ?');
      updateValues.push(role);
    }
    if (status !== undefined) {
      updateFields.push('status = ?');
      updateValues.push(status ? 1 : 0);
    }

    if (updateFields.length === 0) {
      throw new AppError('No fields to update', 400, 'NO_UPDATE_FIELDS');
    }

    updateValues.push(id);

    const updateQuery = `
      UPDATE profiles 
      SET ${updateFields.join(', ')} 
      WHERE id = ?
    `;

    await executeQuery(updateQuery, updateValues);

    // Get updated user data
    const updatedUser = await executeQuery(
      `SELECT 
        u.id, u.email, u.created_at as user_created_at,
        p.name, p.phone, p.role, p.status, p.avatar, p.last_login, p.created_at
       FROM users u 
       JOIN profiles p ON u.id = p.id 
       WHERE u.id = ?`,
      [id]
    );

    res.json({
      success: true,
      message: 'User updated successfully',
      data: updatedUser[0]
    });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/users/:id/deactivate - Deactivate user (soft delete)
router.delete('/:id/deactivate', validateUUID('id'), async (req, res, next) => {
  try {
    const { id } = req.params;

    // Check if user exists
    const existingUsers = await executeQuery(
      'SELECT id, status FROM profiles WHERE id = ?',
      [id]
    );

    if (existingUsers.length === 0) {
      throw new AppError('User not found', 404, 'USER_NOT_FOUND');
    }

    // Prevent self-deactivation
    if (id === req.user.id) {
      throw new AppError('Cannot deactivate your own account', 400, 'CANNOT_DEACTIVATE_SELF');
    }

    // Soft delete by setting status to 0
    await executeQuery(
      'UPDATE profiles SET status = 0 WHERE id = ?',
      [id]
    );

    res.json({
      success: true,
      message: 'User deactivated successfully'
    });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/users/:id - Permanently delete user (hard delete)
router.delete('/:id', validateUUID('id'), async (req, res, next) => {
  try {
    const { id } = req.params;

    // Check if user exists
    const existingUsers = await executeQuery(
      'SELECT id, email FROM profiles WHERE id = ?',
      [id]
    );

    if (existingUsers.length === 0) {
      throw new AppError('User not found', 404, 'USER_NOT_FOUND');
    }

    // Prevent self-deletion
    if (id === req.user.id) {
      throw new AppError('Cannot delete your own account', 400, 'CANNOT_DELETE_SELF');
    }

    const userEmail = existingUsers[0].email;

    // Start transaction for permanent deletion
    await executeQuery('START TRANSACTION');

    try {
      // Delete from profiles table
      await executeQuery('DELETE FROM profiles WHERE id = ?', [id]);

      // Delete from users table
      await executeQuery('DELETE FROM users WHERE email = ?', [userEmail]);

      // Commit transaction
      await executeQuery('COMMIT');

      res.json({
        success: true,
        message: 'User permanently deleted successfully'
      });
    } catch (error) {
      // Rollback transaction on error
      await executeQuery('ROLLBACK');
      throw error;
    }
  } catch (error) {
    next(error);
  }
});

// PUT /api/users/:id/reset-password - Admin reset user password
router.put('/:id/reset-password', validateUUID('id'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const { newPassword } = req.body;

    // Validate new password
    if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 8) {
      throw new AppError('New password must be at least 8 characters long', 400, 'INVALID_PASSWORD');
    }

    // Check if user exists
    const existingUsers = await executeQuery(
      'SELECT id FROM users WHERE id = ?',
      [id]
    );

    if (existingUsers.length === 0) {
      throw new AppError('User not found', 404, 'USER_NOT_FOUND');
    }

    // Prevent admin from resetting their own password (should use change-password instead)
    if (id === req.user.id) {
      throw new AppError('Use change-password endpoint to update your own password', 400, 'CANNOT_RESET_OWN_PASSWORD');
    }

    // Hash new password
    const saltRounds = parseInt(process.env.BCRYPT_ROUNDS) || 12;
    const passwordHash = await bcrypt.hash(newPassword, saltRounds);

    // Update password
    await executeQuery(
      'UPDATE users SET password_hash = ?, updated_at = NOW() WHERE id = ?',
      [passwordHash, id]
    );

    res.json({
      success: true,
      message: 'User password reset successfully'
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
