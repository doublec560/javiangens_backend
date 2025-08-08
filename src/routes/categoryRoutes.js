const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { executeQuery } = require('../config/database');
const { AppError } = require('../middleware/errorMiddleware');
const { verifyToken, requireAdminOrManager } = require('../middleware/authMiddleware');
const { validateCategory, validateUUID, validatePagination } = require('../middleware/validationMiddleware');

const router = express.Router();

// All category routes require authentication
router.use(verifyToken);

// GET /api/categories - List all categories
router.get('/', validatePagination, async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50; // Higher default for categories
    const offset = (page - 1) * limit;
    const search = req.query.search || '';

    let whereClause = '';
    let queryParams = [];

    if (search) {
      whereClause = 'WHERE c.name LIKE ?';
      queryParams = [`%${search}%`];
    }

    // Get total count
    const countQuery = `
      SELECT COUNT(*) as total 
      FROM categories c 
      ${whereClause}
    `;
    const countResult = await executeQuery(countQuery, queryParams);
    const total = countResult[0].total;

    // Get categories with creator info
    const categoriesQuery = `
      SELECT 
        c.id, c.name, c.created_at, c.updated_at,
        p.name as created_by_name
      FROM categories c 
      LEFT JOIN profiles p ON c.created_by = p.id
      ${whereClause}
      ORDER BY c.name ASC 
      LIMIT ? OFFSET ?
    `;
    const categories = await executeQuery(categoriesQuery, [...queryParams, limit, offset]);

    const totalPages = Math.ceil(total / limit);

    res.json({
      success: true,
      data: categories,
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

// GET /api/categories/:id - Get specific category
router.get('/:id', validateUUID('id'), async (req, res, next) => {
  try {
    const { id } = req.params;

    const categories = await executeQuery(
      `SELECT 
        c.id, c.name, c.created_at, c.updated_at,
        p.name as created_by_name
       FROM categories c 
       LEFT JOIN profiles p ON c.created_by = p.id
       WHERE c.id = ?`,
      [id]
    );

    if (categories.length === 0) {
      throw new AppError('Category not found', 404, 'CATEGORY_NOT_FOUND');
    }

    // Get subcategories count
    const subcategoriesCount = await executeQuery(
      'SELECT COUNT(*) as count FROM subcategories WHERE category_id = ?',
      [id]
    );

    const category = {
      ...categories[0],
      subcategories_count: subcategoriesCount[0].count
    };

    res.json({
      success: true,
      data: category
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/categories - Create new category (admin/manager only)
router.post('/', requireAdminOrManager, validateCategory, async (req, res, next) => {
  try {
    const { name } = req.body;

    // Check if category name already exists
    const existingCategories = await executeQuery(
      'SELECT id FROM categories WHERE name = ?',
      [name]
    );

    if (existingCategories.length > 0) {
      throw new AppError('Category name already exists', 409, 'CATEGORY_EXISTS');
    }

    // Create category
    const categoryId = uuidv4();
    await executeQuery(
      'INSERT INTO categories (id, name, created_by) VALUES (?, ?, ?)',
      [categoryId, name, req.user.id]
    );

    // Get created category
    const newCategory = await executeQuery(
      `SELECT 
        c.id, c.name, c.created_at, c.updated_at,
        p.name as created_by_name
       FROM categories c 
       LEFT JOIN profiles p ON c.created_by = p.id
       WHERE c.id = ?`,
      [categoryId]
    );

    res.status(201).json({
      success: true,
      message: 'Category created successfully',
      data: newCategory[0]
    });
  } catch (error) {
    next(error);
  }
});

// PUT /api/categories/:id - Update category (admin/manager only)
router.put('/:id', requireAdminOrManager, validateUUID('id'), validateCategory, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name } = req.body;

    // Check if category exists
    const existingCategories = await executeQuery(
      'SELECT id FROM categories WHERE id = ?',
      [id]
    );

    if (existingCategories.length === 0) {
      throw new AppError('Category not found', 404, 'CATEGORY_NOT_FOUND');
    }

    // Check if new name already exists (excluding current category)
    const duplicateCategories = await executeQuery(
      'SELECT id FROM categories WHERE name = ? AND id != ?',
      [name, id]
    );

    if (duplicateCategories.length > 0) {
      throw new AppError('Category name already exists', 409, 'CATEGORY_EXISTS');
    }

    // Update category
    await executeQuery(
      'UPDATE categories SET name = ?, updated_at = NOW() WHERE id = ?',
      [name, id]
    );

    // Get updated category
    const updatedCategory = await executeQuery(
      `SELECT 
        c.id, c.name, c.created_at, c.updated_at,
        p.name as created_by_name
       FROM categories c 
       LEFT JOIN profiles p ON c.created_by = p.id
       WHERE c.id = ?`,
      [id]
    );

    res.json({
      success: true,
      message: 'Category updated successfully',
      data: updatedCategory[0]
    });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/categories/:id - Delete category (admin/manager only)
router.delete('/:id', requireAdminOrManager, validateUUID('id'), async (req, res, next) => {
  try {
    const { id } = req.params;

    // Check if category exists
    const existingCategories = await executeQuery(
      'SELECT id FROM categories WHERE id = ?',
      [id]
    );

    if (existingCategories.length === 0) {
      throw new AppError('Category not found', 404, 'CATEGORY_NOT_FOUND');
    }

    // Check if category has subcategories
    const subcategories = await executeQuery(
      'SELECT COUNT(*) as count FROM subcategories WHERE category_id = ?',
      [id]
    );

    if (subcategories[0].count > 0) {
      throw new AppError('Cannot delete category with subcategories', 400, 'CATEGORY_HAS_SUBCATEGORIES');
    }

    // Check if category is used in transactions
    const transactions = await executeQuery(
      'SELECT COUNT(*) as count FROM transactions WHERE category_id = ?',
      [id]
    );

    if (transactions[0].count > 0) {
      throw new AppError('Cannot delete category used in transactions', 400, 'CATEGORY_IN_USE');
    }

    // Delete category
    await executeQuery('DELETE FROM categories WHERE id = ?', [id]);

    res.json({
      success: true,
      message: 'Category deleted successfully'
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
