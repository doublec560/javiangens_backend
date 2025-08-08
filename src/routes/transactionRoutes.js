const express = require('express');
const { executeQuery } = require('../config/database');
const { AppError } = require('../middleware/errorMiddleware');
const { verifyToken, requireAdminOrManager } = require('../middleware/authMiddleware');
const { validateTransaction, validateUUID, validateTransactionId, validatePagination } = require('../middleware/validationMiddleware');
const { generateNextTransactionId } = require('../utils/queryUtils');

const router = express.Router();

// All transaction routes require authentication
router.use(verifyToken);

// GET /api/transactions - List all transactions with filters
router.get('/', validatePagination, async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    
    // Filters
    const search = req.query.search || '';
    const type = req.query.type || '';
    const categoryId = req.query.category_id || '';
    const subcategoryId = req.query.subcategory_id || '';
    const startDate = req.query.start_date || '';
    const endDate = req.query.end_date || '';
    const minAmount = req.query.min_amount || '';
    const maxAmount = req.query.max_amount || '';

    let whereClause = 'WHERE 1=1';
    let queryParams = [];

    if (search) {
      whereClause += ' AND t.description LIKE ?';
      queryParams.push(`%${search}%`);
    }

    if (type) {
      whereClause += ' AND t.type = ?';
      queryParams.push(type);
    }

    if (categoryId) {
      whereClause += ' AND t.category_id = ?';
      queryParams.push(categoryId);
    }

    if (subcategoryId) {
      whereClause += ' AND t.subcategory_id = ?';
      queryParams.push(subcategoryId);
    }

    if (startDate) {
      whereClause += ' AND t.date >= ?';
      queryParams.push(startDate);
    }

    if (endDate) {
      whereClause += ' AND t.date <= ?';
      queryParams.push(endDate);
    }

    if (minAmount) {
      whereClause += ' AND t.amount >= ?';
      queryParams.push(parseFloat(minAmount));
    }

    if (maxAmount) {
      whereClause += ' AND t.amount <= ?';
      queryParams.push(parseFloat(maxAmount));
    }

    // Get total count
    const countQuery = `
      SELECT COUNT(*) as total 
      FROM transactions t 
      ${whereClause}
    `;
    const countResult = await executeQuery(countQuery, queryParams);
    const total = countResult[0].total;

    // Get transactions with related data
    const transactionsQuery = `
      SELECT
        t.id, t.amount, t.type, t.description, t.date, t.receipt_url as comprovativo_url,
        t.category_id, t.subcategory_id, t.created_at, t.updated_at,
        c.name as category_name,
        s.name as subcategory_name,
        p.name as created_by_name
      FROM transactions t
      LEFT JOIN categories c ON t.category_id = c.id
      LEFT JOIN subcategories s ON t.subcategory_id = s.id
      LEFT JOIN profiles p ON t.created_by = p.id
      ${whereClause}
      ORDER BY t.date DESC, t.created_at DESC
      LIMIT ? OFFSET ?
    `;
    const transactions = await executeQuery(transactionsQuery, [...queryParams, limit, offset]);

    const totalPages = Math.ceil(total / limit);

    res.json({
      success: true,
      data: transactions,
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

// GET /api/transactions/stats/summary - Get transaction statistics
router.get('/stats/summary', async (req, res, next) => {
  try {
    const startDate = req.query.start_date || '';
    const endDate = req.query.end_date || '';

    let whereClause = '';
    let queryParams = [];

    if (startDate && endDate) {
      whereClause = 'WHERE t.date BETWEEN ? AND ?';
      queryParams = [startDate, endDate];
    } else if (startDate) {
      whereClause = 'WHERE t.date >= ?';
      queryParams = [startDate];
    } else if (endDate) {
      whereClause = 'WHERE t.date <= ?';
      queryParams = [endDate];
    }

    // Get summary statistics
    const summaryQuery = `
      SELECT 
        COUNT(*) as total_transactions,
        SUM(CASE WHEN type = 'entrada' THEN amount ELSE 0 END) as total_income,
        SUM(CASE WHEN type = 'saida' THEN amount ELSE 0 END) as total_expenses,
        SUM(CASE WHEN type = 'entrada' THEN amount ELSE -amount END) as net_balance,
        COUNT(CASE WHEN type = 'entrada' THEN 1 END) as income_count,
        COUNT(CASE WHEN type = 'saida' THEN 1 END) as expense_count,
        AVG(CASE WHEN type = 'entrada' THEN amount END) as avg_income,
        AVG(CASE WHEN type = 'saida' THEN amount END) as avg_expense
      FROM transactions t 
      ${whereClause}
    `;
    const summary = await executeQuery(summaryQuery, queryParams);

    // Get monthly breakdown
    const monthlyQuery = `
      SELECT 
        DATE_FORMAT(t.date, '%Y-%m') as month,
        SUM(CASE WHEN type = 'entrada' THEN amount ELSE 0 END) as income,
        SUM(CASE WHEN type = 'saida' THEN amount ELSE 0 END) as expenses,
        COUNT(*) as transaction_count
      FROM transactions t 
      ${whereClause}
      GROUP BY DATE_FORMAT(t.date, '%Y-%m')
      ORDER BY month DESC
      LIMIT 12
    `;
    const monthlyBreakdown = await executeQuery(monthlyQuery, queryParams);

    // Get category breakdown
    const categoryQuery = `
      SELECT 
        c.name as category_name,
        t.type,
        SUM(t.amount) as total_amount,
        COUNT(*) as transaction_count
      FROM transactions t 
      LEFT JOIN categories c ON t.category_id = c.id
      ${whereClause}
      GROUP BY c.id, c.name, t.type
      ORDER BY total_amount DESC
    `;
    const categoryBreakdown = await executeQuery(categoryQuery, queryParams);

    res.json({
      success: true,
      data: {
        summary: summary[0],
        monthly_breakdown: monthlyBreakdown,
        category_breakdown: categoryBreakdown
      }
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/transactions/:id - Get specific transaction
router.get('/:id', validateTransactionId('id'), async (req, res, next) => {
  try {
    const { id } = req.params;

    const transactions = await executeQuery(
      `SELECT
        t.id, t.amount, t.type, t.description, t.date, t.receipt_url as comprovativo_url,
        t.category_id, t.subcategory_id, t.created_at, t.updated_at,
        c.name as category_name,
        s.name as subcategory_name,
        p.name as created_by_name
       FROM transactions t
       LEFT JOIN categories c ON t.category_id = c.id
       LEFT JOIN subcategories s ON t.subcategory_id = s.id
       LEFT JOIN profiles p ON t.created_by = p.id
       WHERE t.id = ?`,
      [id]
    );

    if (transactions.length === 0) {
      throw new AppError('Transaction not found', 404, 'TRANSACTION_NOT_FOUND');
    }

    res.json({
      success: true,
      data: transactions[0]
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/transactions - Create new transaction (admin/manager only)
router.post('/', requireAdminOrManager, validateTransaction, async (req, res, next) => {
  try {
    const { amount, type, description, date, category_id, subcategory_id, comprovativo_url } = req.body;

    // Validate category exists if provided
    if (category_id) {
      const categories = await executeQuery(
        'SELECT id FROM categories WHERE id = ?',
        [category_id]
      );
      if (categories.length === 0) {
        throw new AppError('Category not found', 404, 'CATEGORY_NOT_FOUND');
      }
    }

    // Validate subcategory exists and belongs to category if provided
    if (subcategory_id) {
      let subcategoryQuery = 'SELECT id, category_id FROM subcategories WHERE id = ?';
      let subcategoryParams = [subcategory_id];

      if (category_id) {
        subcategoryQuery += ' AND category_id = ?';
        subcategoryParams.push(category_id);
      }

      const subcategories = await executeQuery(subcategoryQuery, subcategoryParams);
      if (subcategories.length === 0) {
        throw new AppError('Subcategory not found or does not belong to the specified category', 404, 'SUBCATEGORY_NOT_FOUND');
      }
    }

    // Create transaction with sequential ID
    const transactionId = await generateNextTransactionId();
    await executeQuery(
      `INSERT INTO transactions
       (id, amount, type, description, date, category_id, subcategory_id, receipt_url, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [transactionId, amount, type, description, date, category_id || null, subcategory_id || null, comprovativo_url || null, req.user.id]
    );

    // Get created transaction
    const newTransaction = await executeQuery(
      `SELECT
        t.id, t.amount, t.type, t.description, t.date, t.receipt_url as comprovativo_url,
        t.category_id, t.subcategory_id, t.created_at, t.updated_at,
        c.name as category_name,
        s.name as subcategory_name,
        p.name as created_by_name
       FROM transactions t
       LEFT JOIN categories c ON t.category_id = c.id
       LEFT JOIN subcategories s ON t.subcategory_id = s.id
       LEFT JOIN profiles p ON t.created_by = p.id
       WHERE t.id = ?`,
      [transactionId]
    );

    res.status(201).json({
      success: true,
      message: 'Transaction created successfully',
      data: newTransaction[0]
    });
  } catch (error) {
    next(error);
  }
});

// PUT /api/transactions/:id - Update transaction (admin/manager only)
router.put('/:id', requireAdminOrManager, validateTransactionId('id'), validateTransaction, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { amount, type, description, date, category_id, subcategory_id, comprovativo_url } = req.body;

    // Check if transaction exists and get current receipt URL
    const existingTransactions = await executeQuery(
      'SELECT id, receipt_url FROM transactions WHERE id = ?',
      [id]
    );

    if (existingTransactions.length === 0) {
      throw new AppError('Transaction not found', 404, 'TRANSACTION_NOT_FOUND');
    }

    const currentTransaction = existingTransactions[0];

    // Validate category exists if provided
    if (category_id) {
      const categories = await executeQuery(
        'SELECT id FROM categories WHERE id = ?',
        [category_id]
      );
      if (categories.length === 0) {
        throw new AppError('Category not found', 404, 'CATEGORY_NOT_FOUND');
      }
    }

    // Validate subcategory exists and belongs to category if provided
    if (subcategory_id) {
      let subcategoryQuery = 'SELECT id, category_id FROM subcategories WHERE id = ?';
      let subcategoryParams = [subcategory_id];

      if (category_id) {
        subcategoryQuery += ' AND category_id = ?';
        subcategoryParams.push(category_id);
      }

      const subcategories = await executeQuery(subcategoryQuery, subcategoryParams);
      if (subcategories.length === 0) {
        throw new AppError('Subcategory not found or does not belong to the specified category', 404, 'SUBCATEGORY_NOT_FOUND');
      }
    }

    // Handle file replacement - delete old file if new one is provided
    if (comprovativo_url && currentTransaction.receipt_url && comprovativo_url !== currentTransaction.receipt_url) {
      try {
        const fs = require('fs');
        const path = require('path');

        // Extract filename from old URL
        const oldFilename = currentTransaction.receipt_url.split('/').pop();
        const oldFilePath = path.join(__dirname, '../../uploads', oldFilename);

        // Delete old file if it exists
        if (fs.existsSync(oldFilePath)) {
          fs.unlinkSync(oldFilePath);
          console.log(`Deleted old receipt file: ${oldFilename}`);
        }
      } catch (fileError) {
        console.error('Error deleting old receipt file:', fileError);
        // Continue with update even if file deletion fails
      }
    }

    // Handle file removal - delete file if comprovativo_url is explicitly set to null or empty
    if ((comprovativo_url === null || comprovativo_url === '') && currentTransaction.receipt_url) {
      try {
        const fs = require('fs');
        const path = require('path');

        // Extract filename from current URL
        const filename = currentTransaction.receipt_url.split('/').pop();
        const filePath = path.join(__dirname, '../../uploads', filename);

        // Delete file if it exists
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          console.log(`Deleted receipt file: ${filename}`);
        }
      } catch (fileError) {
        console.error('Error deleting receipt file:', fileError);
        // Continue with update even if file deletion fails
      }
    }

    // Update transaction
    await executeQuery(
      `UPDATE transactions
       SET amount = ?, type = ?, description = ?, date = ?,
           category_id = ?, subcategory_id = ?, receipt_url = ?, updated_at = NOW()
       WHERE id = ?`,
      [amount, type, description, date, category_id || null, subcategory_id || null, comprovativo_url || null, id]
    );

    // Get updated transaction
    const updatedTransaction = await executeQuery(
      `SELECT
        t.id, t.amount, t.type, t.description, t.date, t.receipt_url as comprovativo_url,
        t.category_id, t.subcategory_id, t.created_at, t.updated_at,
        c.name as category_name,
        s.name as subcategory_name,
        p.name as created_by_name
       FROM transactions t
       LEFT JOIN categories c ON t.category_id = c.id
       LEFT JOIN subcategories s ON t.subcategory_id = s.id
       LEFT JOIN profiles p ON t.created_by = p.id
       WHERE t.id = ?`,
      [id]
    );

    res.json({
      success: true,
      message: 'Transaction updated successfully',
      data: updatedTransaction[0]
    });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/transactions/:id/file - Remove file from transaction (admin/manager only)
router.delete('/:id/file', requireAdminOrManager, validateTransactionId('id'), async (req, res, next) => {
  try {
    const { id } = req.params;

    // Check if transaction exists and get receipt URL
    const existingTransactions = await executeQuery(
      'SELECT id, receipt_url FROM transactions WHERE id = ?',
      [id]
    );

    if (existingTransactions.length === 0) {
      throw new AppError('Transaction not found', 404, 'TRANSACTION_NOT_FOUND');
    }

    const transaction = existingTransactions[0];

    if (!transaction.receipt_url) {
      throw new AppError('Transaction has no attached file', 400, 'NO_FILE_ATTACHED');
    }

    // Delete the file
    try {
      const fs = require('fs');
      const path = require('path');

      // Extract filename from URL
      const filename = transaction.receipt_url.split('/').pop();
      const filePath = path.join(__dirname, '../../uploads', filename);

      // Delete file if it exists
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        console.log(`Deleted receipt file: ${filename}`);
      }
    } catch (fileError) {
      console.error('Error deleting receipt file:', fileError);
      throw new AppError('Failed to delete file', 500, 'FILE_DELETE_ERROR');
    }

    // Update transaction to remove receipt URL
    await executeQuery(
      'UPDATE transactions SET receipt_url = NULL, updated_at = NOW() WHERE id = ?',
      [id]
    );

    res.json({
      success: true,
      message: 'File removed successfully'
    });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/transactions/:id - Delete transaction (admin/manager only)
router.delete('/:id', requireAdminOrManager, validateTransactionId('id'), async (req, res, next) => {
  try {
    const { id } = req.params;

    // Check if transaction exists and get receipt URL
    const existingTransactions = await executeQuery(
      'SELECT id, receipt_url FROM transactions WHERE id = ?',
      [id]
    );

    if (existingTransactions.length === 0) {
      throw new AppError('Transaction not found', 404, 'TRANSACTION_NOT_FOUND');
    }

    const transaction = existingTransactions[0];

    // Delete associated receipt file if exists
    if (transaction.receipt_url) {
      try {
        const fs = require('fs');
        const path = require('path');

        // Extract filename from URL (assuming URL format: /uploads/filename)
        const filename = transaction.receipt_url.split('/').pop();
        const filePath = path.join(__dirname, '../../uploads', filename);

        // Delete file if it exists
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          console.log(`Deleted receipt file: ${filename}`);
        }
      } catch (fileError) {
        console.error('Error deleting receipt file:', fileError);
        // Continue with transaction deletion even if file deletion fails
      }
    }

    // Delete transaction
    await executeQuery('DELETE FROM transactions WHERE id = ?', [id]);

    res.json({
      success: true,
      message: 'Transaction and associated receipt deleted successfully'
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
