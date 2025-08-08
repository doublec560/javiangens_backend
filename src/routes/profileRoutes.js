const express = require('express');
const { executeQuery } = require('../config/database');
const { AppError } = require('../middleware/errorMiddleware');
const { verifyToken, requireAdminOrManager } = require('../middleware/authMiddleware');
const { validateUpdateProfile, validateUUID, validatePagination } = require('../middleware/validationMiddleware');

const router = express.Router();

// All profile routes require authentication
router.use(verifyToken);

// GET /api/profiles - List all profiles (admin/manager only)
router.get('/', requireAdminOrManager, validatePagination, async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;
    const search = req.query.search || '';
    const role = req.query.role || '';
    const status = req.query.status || '';

    let whereClause = 'WHERE 1=1';
    let queryParams = [];

    if (search) {
      whereClause += ' AND (p.name LIKE ? OR p.email LIKE ?)';
      queryParams.push(`%${search}%`, `%${search}%`);
    }

    if (role) {
      whereClause += ' AND p.role = ?';
      queryParams.push(role);
    }

    if (status !== '') {
      whereClause += ' AND p.status = ?';
      queryParams.push(status === 'true' ? 1 : 0);
    }

    // Get total count
    const countQuery = `
      SELECT COUNT(*) as total 
      FROM profiles p 
      ${whereClause}
    `;
    const countResult = await executeQuery(countQuery, queryParams);
    const total = countResult[0].total;

    // Get profiles with pagination
    const profilesQuery = `
      SELECT 
        p.id, p.name, p.email, p.phone, p.role, p.status, 
        p.avatar, p.last_login, p.created_at
      FROM profiles p 
      ${whereClause}
      ORDER BY p.created_at DESC 
      LIMIT ? OFFSET ?
    `;
    const profiles = await executeQuery(profilesQuery, [...queryParams, limit, offset]);

    const totalPages = Math.ceil(total / limit);

    res.json({
      success: true,
      data: profiles,
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

// GET /api/profiles/:id - Get specific profile
router.get('/:id', validateUUID('id'), async (req, res, next) => {
  try {
    const { id } = req.params;

    // Users can only view their own profile unless they're admin/manager
    if (req.user.id !== id && !['administrador', 'gerente'].includes(req.user.role)) {
      throw new AppError('Access denied', 403, 'ACCESS_DENIED');
    }

    const profiles = await executeQuery(
      `SELECT 
        p.id, p.name, p.email, p.phone, p.role, p.status, 
        p.avatar, p.last_login, p.created_at
       FROM profiles p 
       WHERE p.id = ?`,
      [id]
    );

    if (profiles.length === 0) {
      throw new AppError('Profile not found', 404, 'PROFILE_NOT_FOUND');
    }

    res.json({
      success: true,
      data: profiles[0]
    });
  } catch (error) {
    next(error);
  }
});

// PUT /api/profiles/:id - Update profile
router.put('/:id', validateUUID('id'), validateUpdateProfile, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, phone } = req.body;

    // Users can only update their own profile unless they're admin
    if (req.user.id !== id && req.user.role !== 'administrador') {
      throw new AppError('Access denied', 403, 'ACCESS_DENIED');
    }

    // Check if profile exists
    const existingProfiles = await executeQuery(
      'SELECT id FROM profiles WHERE id = ?',
      [id]
    );

    if (existingProfiles.length === 0) {
      throw new AppError('Profile not found', 404, 'PROFILE_NOT_FOUND');
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

    // Get updated profile data
    const updatedProfile = await executeQuery(
      `SELECT 
        p.id, p.name, p.email, p.phone, p.role, p.status, 
        p.avatar, p.last_login, p.created_at
       FROM profiles p 
       WHERE p.id = ?`,
      [id]
    );

    res.json({
      success: true,
      message: 'Profile updated successfully',
      data: updatedProfile[0]
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/profiles/stats/summary - Get profile statistics (admin/manager only)
router.get('/stats/summary', requireAdminOrManager, async (req, res, next) => {
  try {
    // Get user statistics
    const stats = await executeQuery(`
      SELECT 
        COUNT(*) as total_users,
        SUM(CASE WHEN status = 1 THEN 1 ELSE 0 END) as active_users,
        SUM(CASE WHEN status = 0 THEN 1 ELSE 0 END) as inactive_users,
        SUM(CASE WHEN role = 'administrador' THEN 1 ELSE 0 END) as admin_users,
        SUM(CASE WHEN role = 'gerente' THEN 1 ELSE 0 END) as manager_users,
        SUM(CASE WHEN last_login >= DATE_SUB(NOW(), INTERVAL 30 DAY) THEN 1 ELSE 0 END) as recent_logins
      FROM profiles
    `);

    // Get recent registrations
    const recentRegistrations = await executeQuery(`
      SELECT DATE(created_at) as date, COUNT(*) as count
      FROM profiles 
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
      GROUP BY DATE(created_at)
      ORDER BY date DESC
    `);

    res.json({
      success: true,
      data: {
        summary: stats[0],
        recent_registrations: recentRegistrations
      }
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
