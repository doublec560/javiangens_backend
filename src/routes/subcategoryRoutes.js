const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { executeQuery } = require('../config/database');
const { AppError } = require('../middleware/errorMiddleware');
const { verifyToken, requireAdminOrManager } = require('../middleware/authMiddleware');
const { validateSubcategory, validateUUID, validatePagination } = require('../middleware/validationMiddleware');

const router = express.Router();

// All subcategory routes require authentication
router.use(verifyToken);

// GET /api/subcategories - List all subcategories
router.get('/', validatePagination, async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50; // Higher default for subcategories
    const offset = (page - 1) * limit;
    const search = req.query.search || '';
    const categoryId = req.query.category_id || '';

    let whereClause = '';
    let queryParams = [];

    if (search && categoryId) {
      whereClause = 'WHERE s.name LIKE ? AND s.category_id = ?';
      queryParams = [`%${search}%`, categoryId];
    } else if (search) {
      whereClause = 'WHERE s.name LIKE ?';
      queryParams = [`%${search}%`];
    } else if (categoryId) {
      whereClause = 'WHERE s.category_id = ?';
      queryParams = [categoryId];
    }

    // Get total count
    const countQuery = `
      SELECT COUNT(*) as total 
      FROM subcategories s 
      ${whereClause}
    `;
    const countResult = await executeQuery(countQuery, queryParams);
    const total = countResult[0].total;

    // Get subcategories with category and creator info
    const subcategoriesQuery = `
      SELECT 
        s.id, s.name, s.category_id, s.created_at, s.updated_at,
        c.name as category_name,
        p.name as created_by_name
      FROM subcategories s 
      LEFT JOIN categories c ON s.category_id = c.id
      LEFT JOIN profiles p ON s.created_by = p.id
      ${whereClause}
      ORDER BY c.name ASC, s.name ASC 
      LIMIT ? OFFSET ?
    `;
    const subcategories = await executeQuery(subcategoriesQuery, [...queryParams, limit, offset]);

    const totalPages = Math.ceil(total / limit);

    res.json({
      success: true,
      data: subcategories,
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

// GET /api/subcategories/:id - Get specific subcategory
router.get('/:id', validateUUID('id'), async (req, res, next) => {
  try {
    const { id } = req.params;

    const subcategories = await executeQuery(
      `SELECT 
        s.id, s.name, s.category_id, s.created_at, s.updated_at,
        c.name as category_name,
        p.name as created_by_name
       FROM subcategories s 
       LEFT JOIN categories c ON s.category_id = c.id
       LEFT JOIN profiles p ON s.created_by = p.id
       WHERE s.id = ?`,
      [id]
    );

    if (subcategories.length === 0) {
      throw new AppError('Subcategory not found', 404, 'SUBCATEGORY_NOT_FOUND');
    }

    res.json({
      success: true,
      data: subcategories[0]
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/subcategories - Create new subcategory (admin/manager only)
router.post('/', requireAdminOrManager, validateSubcategory, async (req, res, next) => {
  try {
    const { name, category_id } = req.body;

    // Check if category exists
    const categories = await executeQuery(
      'SELECT id FROM categories WHERE id = ?',
      [category_id]
    );

    if (categories.length === 0) {
      throw new AppError('Category not found', 404, 'CATEGORY_NOT_FOUND');
    }

    // Check if subcategory name already exists in this category
    const existingSubcategories = await executeQuery(
      'SELECT id FROM subcategories WHERE name = ? AND category_id = ?',
      [name, category_id]
    );

    if (existingSubcategories.length > 0) {
      throw new AppError('Subcategory name already exists in this category', 409, 'SUBCATEGORY_EXISTS');
    }

    // Create subcategory
    const subcategoryId = uuidv4();
    await executeQuery(
      'INSERT INTO subcategories (id, name, category_id, created_by) VALUES (?, ?, ?, ?)',
      [subcategoryId, name, category_id, req.user.id]
    );

    // Get created subcategory
    const newSubcategory = await executeQuery(
      `SELECT 
        s.id, s.name, s.category_id, s.created_at, s.updated_at,
        c.name as category_name,
        p.name as created_by_name
       FROM subcategories s 
       LEFT JOIN categories c ON s.category_id = c.id
       LEFT JOIN profiles p ON s.created_by = p.id
       WHERE s.id = ?`,
      [subcategoryId]
    );

    res.status(201).json({
      success: true,
      message: 'Subcategory created successfully',
      data: newSubcategory[0]
    });
  } catch (error) {
    next(error);
  }
});

// PUT /api/subcategories/:id - Update subcategory (admin/manager only)
router.put('/:id', requireAdminOrManager, validateUUID('id'), validateSubcategory, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, category_id } = req.body;

    // Check if subcategory exists
    const existingSubcategories = await executeQuery(
      'SELECT id FROM subcategories WHERE id = ?',
      [id]
    );

    if (existingSubcategories.length === 0) {
      throw new AppError('Subcategory not found', 404, 'SUBCATEGORY_NOT_FOUND');
    }

    // Check if category exists
    const categories = await executeQuery(
      'SELECT id FROM categories WHERE id = ?',
      [category_id]
    );

    if (categories.length === 0) {
      throw new AppError('Category not found', 404, 'CATEGORY_NOT_FOUND');
    }

    // Check if new name already exists in the category (excluding current subcategory)
    const duplicateSubcategories = await executeQuery(
      'SELECT id FROM subcategories WHERE name = ? AND category_id = ? AND id != ?',
      [name, category_id, id]
    );

    if (duplicateSubcategories.length > 0) {
      throw new AppError('Subcategory name already exists in this category', 409, 'SUBCATEGORY_EXISTS');
    }

    // Update subcategory
    await executeQuery(
      'UPDATE subcategories SET name = ?, category_id = ?, updated_at = NOW() WHERE id = ?',
      [name, category_id, id]
    );

    // Get updated subcategory
    const updatedSubcategory = await executeQuery(
      `SELECT 
        s.id, s.name, s.category_id, s.created_at, s.updated_at,
        c.name as category_name,
        p.name as created_by_name
       FROM subcategories s 
       LEFT JOIN categories c ON s.category_id = c.id
       LEFT JOIN profiles p ON s.created_by = p.id
       WHERE s.id = ?`,
      [id]
    );

    res.json({
      success: true,
      message: 'Subcategory updated successfully',
      data: updatedSubcategory[0]
    });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/subcategories/:id - Delete subcategory (admin/manager only)
router.delete('/:id', requireAdminOrManager, validateUUID('id'), async (req, res, next) => {
  try {
    const { id } = req.params;

    // Check if subcategory exists
    const existingSubcategories = await executeQuery(
      'SELECT id FROM subcategories WHERE id = ?',
      [id]
    );

    if (existingSubcategories.length === 0) {
      throw new AppError('Subcategory not found', 404, 'SUBCATEGORY_NOT_FOUND');
    }

    // Check if subcategory is used in transactions
    const transactions = await executeQuery(
      'SELECT COUNT(*) as count FROM transactions WHERE subcategory_id = ?',
      [id]
    );

    if (transactions[0].count > 0) {
      throw new AppError('Cannot delete subcategory used in transactions', 400, 'SUBCATEGORY_IN_USE');
    }

    // Delete subcategory
    await executeQuery('DELETE FROM subcategories WHERE id = ?', [id]);

    res.json({
      success: true,
      message: 'Subcategory deleted successfully'
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
